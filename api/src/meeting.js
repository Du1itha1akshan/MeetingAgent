// Loads a meeting the Logic App saved to blob storage and turns it into what the
// meeting details page shows, and saves action item statuses. No dependencies, so it
// can be tested on its own.
const crypto = require("crypto");

const ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;
const HASH_PATTERN = /^[0-9A-Fa-f]{64}$/;

// A link is genuine when its hash is SHA-256(meeting ID + secret), the value the
// Logic App's Generate meeting hash step puts in the email (as uppercase hex).
function isValidLink(id, hash, secret) {
  if (!ID_PATTERN.test(id ?? "") || !HASH_PATTERN.test(hash ?? "")) return false;
  const expected = crypto.createHash("sha256").update(id + secret, "utf8").digest();
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), expected);
}

// Claude's summary has three sections: "## Overview", "## Key points" and
// "## Action items" (a table with Owner | Action item | Due date, or the sentence
// "No action items were identified.").
function parseSummary(markdown) {
  const sections = {};
  let current = null;
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].toLowerCase();
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }

  // If Claude didn't use the expected headings, show the whole reply as the overview.
  const overviewText = sections.overview ? sections.overview.join("\n") : String(markdown ?? "");
  return {
    overview: paragraphs(overviewText),
    keyPoints: (sections["key points"] ?? []).map((line) => line.match(/^\s*[-*]\s+(.*\S)/)?.[1]).filter(Boolean),
    actionItems: parseActionItems(sections["action items"] ?? []),
  };
}

function paragraphs(text) {
  return text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
}

function parseActionItems(lines) {
  const rows = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
  // Data rows follow the |---|---|---| row under the header.
  const separator = rows.findIndex((cells) => cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
  return rows
    .slice(separator + 1)
    .filter((cells) => cells.length >= 3 && cells[1])
    .map(([owner, task, due]) => ({ owner, task, due }));
}

// Fireflies' transcript file: a "# title" line, a "**Meeting Date:**" line, then one line
// per utterance. Two layouts have been seen in real files:
//   "**Speaker** *[mm:ss]*: text"     (hh:mm:ss in long meetings)
//   "[hh:mm:ss.mmm] Speaker: text"    (e.g. an uploaded Teams recording)
const UTTERANCE = /^\*\*(.+?)\*\*\s*\*\[(\d{1,2}(?::\d{2}){1,2})\]\*:?\s*(.*)$/;
const TIMESTAMP_FIRST = /^\[(\d{1,2}(?::\d{2}){1,2})(?:\.\d+)?\]\s+([^:]+?):\s*(.*)$/;

function matchUtterance(raw) {
  const bold = raw.match(UTTERANCE);
  if (bold) return { speaker: bold[1].trim(), time: bold[2], text: bold[3].trim() };
  // The fraction of a second is dropped, so times read like the other layout.
  const stamped = raw.match(TIMESTAMP_FIRST);
  if (stamped) return { speaker: stamped[2].trim(), time: stamped[1], text: stamped[3].trim() };
  return null;
}

function parseTranscript(markdown) {
  const lines = [];
  for (const raw of String(markdown ?? "").split(/\r?\n/)) {
    const utterance = matchUtterance(raw);
    if (utterance) {
      lines.push(utterance);
    } else if (lines.length && raw.trim()) {
      // An utterance that runs onto the next line.
      lines[lines.length - 1].text += ` ${raw.trim()}`;
    }
  }
  return lines;
}

// ---- Action item statuses ----
// Saved in a separate container ("meeting-status"), one <meeting_id>.json per meeting,
// holding only the items whose status someone has changed:
//   { "items": [ { "index": 2, "task": "…", "status": "done" } ], "updatedAt": "…" }
// Items have no ID, so an entry applies only when both its row number and its task text
// still match; anything else shows as open. The meeting files themselves are never written.
const STATUS_IDS = ["open", "in_progress", "qa", "blocked", "done"];

// The SAS's own version (sv) decides how storage handles the request; this matches it.
const STORAGE_VERSION = "2015-04-05";

function savedStatus(entries, index, task) {
  const entry = entries.find((e) => e && e.index === index && e.task === task);
  return STATUS_IDS.includes(entry?.status) ? entry.status : "open";
}

// Reads a meeting's status file. Returns { entries, etag }, with no etag if there's no file yet.
async function readStatuses(id, settings, fetchImpl) {
  const response = await fetchImpl(`${settings.MEETING_STATUS_CONTAINER_URL}/${id}.json?${settings.MEETING_STATUS_SAS}`);
  if (response.status === 404) return { entries: [], etag: null };
  if (!response.ok) throw new StorageError(`status file read returned ${response.status}`);
  const saved = await response.json().catch(() => null);
  return { entries: Array.isArray(saved?.items) ? saved.items : [], etag: response.headers.get("etag") };
}

class StorageError extends Error {}

async function readMeetingFile(id, settings, fetchImpl) {
  const response = await fetchImpl(`${settings.MEETINGS_CONTAINER_URL}/${id}.json?${settings.MEETINGS_READ_SAS}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageError(`meeting file read returned ${response.status}`);
  return response.json();
}

const hasMeetingSettings = (s) => Boolean(s.MEETING_LINK_SECRET && s.MEETINGS_CONTAINER_URL && s.MEETINGS_READ_SAS);
const hasStatusSettings = (s) => Boolean(s.MEETING_STATUS_CONTAINER_URL && s.MEETING_STATUS_SAS);

// Handles GET /api/meetings/{id}. Returns the HTTP status and JSON body. A wrong hash
// gets the same 404 as a missing meeting, so the response doesn't reveal which meetings exist.
async function getMeeting(id, hash, settings, fetchImpl = fetch) {
  if (!hasMeetingSettings(settings)) return { status: 500, body: { error: "not_configured" } };
  if (!isValidLink(id, hash, settings.MEETING_LINK_SECRET)) return { status: 404, body: { error: "not_found" } };

  let saved, statuses;
  try {
    // Until the status settings exist (before the template is redeployed), every item shows as open.
    [saved, statuses] = await Promise.all([
      readMeetingFile(id, settings, fetchImpl),
      hasStatusSettings(settings) ? readStatuses(id, settings, fetchImpl) : { entries: [] },
    ]);
  } catch (error) {
    if (error instanceof StorageError) return { status: 502, body: { error: "storage_error" } };
    throw error;
  }
  if (!saved) return { status: 404, body: { error: "not_found" } };

  const { overview, keyPoints, actionItems } = parseSummary(saved.summaryMarkdown);
  return {
    status: 200,
    body: {
      id,
      title: saved.title ?? "",
      date: saved.date ?? null,
      participants: Array.isArray(saved.participants) ? saved.participants : [],
      summary: { overview, keyPoints },
      actionItems: actionItems.map((item, index) => ({ ...item, status: savedStatus(statuses.entries, index, item.task) })),
      transcript: parseTranscript(saved.transcriptMarkdown),
    },
  };
}

// Handles PUT /api/meetings/{id}/action-items/{index}/status with body { status, task }.
// `task` is the item's text as the page shows it; if the meeting has changed since the
// page loaded and that row now holds a different task, nothing is saved (409).
async function setActionItemStatus(id, hash, indexText, body, settings, fetchImpl = fetch) {
  if (!hasMeetingSettings(settings) || !hasStatusSettings(settings)) return { status: 500, body: { error: "not_configured" } };
  if (!isValidLink(id, hash, settings.MEETING_LINK_SECRET)) return { status: 404, body: { error: "not_found" } };
  if (!/^\d{1,4}$/.test(indexText ?? "")) return { status: 400, body: { error: "invalid_index" } };
  if (!STATUS_IDS.includes(body?.status)) return { status: 400, body: { error: "invalid_status" } };
  const index = Number(indexText);

  try {
    const saved = await readMeetingFile(id, settings, fetchImpl);
    if (!saved) return { status: 404, body: { error: "not_found" } };
    const item = parseSummary(saved.summaryMarkdown).actionItems[index];
    if (!item) return { status: 404, body: { error: "not_found" } };
    if (body.task !== item.task) return { status: 409, body: { error: "item_changed" } };

    // Read, change one entry, and write back only if nobody else saved in between
    // (If-Match with the file's ETag, or If-None-Match: * when creating it). Storage
    // answers 412 when someone did, and then this starts again from a fresh read.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { entries, etag } = await readStatuses(id, settings, fetchImpl);
      const items = entries.filter((e) => e && e.index !== index);
      items.push({ index, task: item.task, status: body.status });
      items.sort((a, b) => a.index - b.index);

      const response = await fetchImpl(`${settings.MEETING_STATUS_CONTAINER_URL}/${id}.json?${settings.MEETING_STATUS_SAS}`, {
        method: "PUT",
        headers: {
          "x-ms-blob-type": "BlockBlob",
          "x-ms-version": STORAGE_VERSION,
          "Content-Type": "application/json",
          ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }),
        },
        body: JSON.stringify({ items, updatedAt: new Date().toISOString() }),
      });
      if (response.status === 201) return { status: 200, body: { status: body.status } };
      // 412: changed since it was read. 409: the file was created since it was read.
      if (response.status !== 412 && response.status !== 409) {
        return { status: 502, body: { error: "storage_error" } };
      }
    }
    return { status: 409, body: { error: "busy" } };
  } catch (error) {
    if (error instanceof StorageError) return { status: 502, body: { error: "storage_error" } };
    throw error;
  }
}

module.exports = { isValidLink, parseSummary, parseTranscript, getMeeting, setActionItemStatus, STATUS_IDS };
