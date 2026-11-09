// Loads a meeting the Logic App saved to blob storage and turns it into what the
// meeting details page shows. No dependencies, so it can be tested on its own.
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

// Fireflies' transcript file: a "# title" line, a "**Meeting Date:**" line, then one
// "**Speaker** *[mm:ss]*: text" line per utterance (hh:mm:ss in long meetings).
const UTTERANCE = /^\*\*(.+?)\*\*\s*\*\[(\d{1,2}(?::\d{2}){1,2})\]\*:?\s*(.*)$/;

function parseTranscript(markdown) {
  const lines = [];
  for (const raw of String(markdown ?? "").split(/\r?\n/)) {
    const match = raw.match(UTTERANCE);
    if (match) {
      lines.push({ speaker: match[1].trim(), time: match[2], text: match[3].trim() });
    } else if (lines.length && raw.trim()) {
      // An utterance that runs onto the next line.
      lines[lines.length - 1].text += ` ${raw.trim()}`;
    }
  }
  return lines;
}

// Handles GET /api/meetings/{id}. Returns the HTTP status and JSON body. A wrong hash
// gets the same 404 as a missing meeting, so the response doesn't reveal which meetings exist.
async function getMeeting(id, hash, settings, fetchImpl = fetch) {
  const { MEETING_LINK_SECRET, MEETINGS_CONTAINER_URL, MEETINGS_READ_SAS } = settings;
  if (!MEETING_LINK_SECRET || !MEETINGS_CONTAINER_URL || !MEETINGS_READ_SAS) {
    return { status: 500, body: { error: "not_configured" } };
  }
  if (!isValidLink(id, hash, MEETING_LINK_SECRET)) return { status: 404, body: { error: "not_found" } };

  const response = await fetchImpl(`${MEETINGS_CONTAINER_URL}/${id}.json?${MEETINGS_READ_SAS}`);
  if (response.status === 404) return { status: 404, body: { error: "not_found" } };
  if (!response.ok) return { status: 502, body: { error: "storage_error" } };

  const saved = await response.json();
  const { overview, keyPoints, actionItems } = parseSummary(saved.summaryMarkdown);
  return {
    status: 200,
    body: {
      id,
      title: saved.title ?? "",
      date: saved.date ?? null,
      participants: Array.isArray(saved.participants) ? saved.participants : [],
      summary: { overview, keyPoints },
      actionItems,
      transcript: parseTranscript(saved.transcriptMarkdown),
    },
  };
}

module.exports = { isValidLink, parseSummary, parseTranscript, getMeeting };
