// Loads a meeting the Logic App saved to blob storage and turns it into what the
// meeting details page shows, saves action item statuses, and sends follow-up emails
// through the follow-up Logic App. No dependencies, so it can be tested on its own.
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

// ---- Action item statuses and follow-ups ----
// Saved in a separate container ("meeting-status"), one <meeting_id>.json per meeting:
//   { "items":     [ { "index": 2, "task": "…", "status": "done" } ],
//     "followUps": [ { "index": 2, "task": "…", "sentAt": "2026-11-10T08:20:21.000Z" } ],
//     "updatedAt": "…" }
// "items" holds only the items whose status someone has changed, and "followUps" the time of
// the last follow-up email sent for an item. Items have no ID, so an entry applies only when
// both its row number and its task text still match. The meeting files themselves are never
// written.
const STATUS_IDS = ["open", "in_progress", "qa", "blocked", "done"];
const STATUS_LABELS = { open: "Open", in_progress: "In progress", qa: "QA", blocked: "Blocked", done: "Done" };

// The SAS's own version (sv) decides how storage handles the request; this matches it.
const STORAGE_VERSION = "2015-04-05";

class StorageError extends Error {}

const entryFor = (entries, index, task) => entries.find((e) => e && e.index === index && e.task === task);

function savedStatus(entries, index, task) {
  const entry = entryFor(entries, index, task);
  return STATUS_IDS.includes(entry?.status) ? entry.status : "open";
}

function lastFollowUp(followUps, index, task) {
  const sentAt = entryFor(followUps, index, task)?.sentAt;
  return typeof sentAt === "string" && !Number.isNaN(Date.parse(sentAt)) ? sentAt : null;
}

// Puts one entry for a row in place of any earlier one, keeping row order.
function upsert(entries, entry) {
  return [...entries.filter((e) => e && e.index !== entry.index), entry].sort((a, b) => a.index - b.index);
}

const statusFileUrl = (id, settings) => `${settings.MEETING_STATUS_CONTAINER_URL}/${id}.json?${settings.MEETING_STATUS_SAS}`;

// Reads a meeting's status file. Returns { items, followUps, etag }, with no etag if there's no file yet.
async function readStatusFile(id, settings, fetchImpl) {
  const response = await fetchImpl(statusFileUrl(id, settings));
  if (response.status === 404) return { items: [], followUps: [], etag: null };
  if (!response.ok) throw new StorageError(`status file read returned ${response.status}`);
  const saved = await response.json().catch(() => null);
  return {
    items: Array.isArray(saved?.items) ? saved.items : [],
    followUps: Array.isArray(saved?.followUps) ? saved.followUps : [],
    etag: response.headers.get("etag"),
  };
}

// Changes the status file: reads it, applies change({ items, followUps }), and writes the result
// back only if nobody else saved in between (If-Match with the file's ETag, or If-None-Match: *
// when creating it). Storage answers 412 when someone did, and then this starts again from a
// fresh read. Both parts are always written, so saving a status keeps the follow-up times and
// the other way round. Returns "saved", "busy" (gave up after 3 tries) or "storage_error".
async function updateStatusFile(id, settings, fetchImpl, change) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { items, followUps, etag } = await readStatusFile(id, settings, fetchImpl);
    const next = change({ items, followUps });
    const response = await fetchImpl(statusFileUrl(id, settings), {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-version": STORAGE_VERSION,
        "Content-Type": "application/json",
        ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }),
      },
      body: JSON.stringify({ items: next.items, followUps: next.followUps, updatedAt: new Date().toISOString() }),
    });
    if (response.status === 201) return "saved";
    // 412: changed since it was read. 409: the file was created since it was read.
    if (response.status !== 412 && response.status !== 409) return "storage_error";
  }
  return "busy";
}

async function readMeetingFile(id, settings, fetchImpl) {
  const response = await fetchImpl(`${settings.MEETINGS_CONTAINER_URL}/${id}.json?${settings.MEETINGS_READ_SAS}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageError(`meeting file read returned ${response.status}`);
  return response.json();
}

const hasMeetingSettings = (s) => Boolean(s.MEETING_LINK_SECRET && s.MEETINGS_CONTAINER_URL && s.MEETINGS_READ_SAS);
const hasStatusSettings = (s) => Boolean(s.MEETING_STATUS_CONTAINER_URL && s.MEETING_STATUS_SAS);
const hasFollowUpSettings = (s) => Boolean(s.FOLLOWUP_TRIGGER_URL);

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
      hasStatusSettings(settings) ? readStatusFile(id, settings, fetchImpl) : { items: [], followUps: [] },
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
      actionItems: actionItems.map((item, index) => ({
        ...item,
        status: savedStatus(statuses.items, index, item.task),
        lastFollowUpAt: lastFollowUp(statuses.followUps, index, item.task),
      })),
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

    const result = await updateStatusFile(id, settings, fetchImpl, ({ items, followUps }) => ({
      items: upsert(items, { index, task: item.task, status: body.status }),
      followUps,
    }));
    if (result === "saved") return { status: 200, body: { status: body.status } };
    if (result === "busy") return { status: 409, body: { error: "busy" } };
    return { status: 502, body: { error: "storage_error" } };
  } catch (error) {
    if (error instanceof StorageError) return { status: 502, body: { error: "storage_error" } };
    throw error;
  }
}

// ---- Follow-up emails ----
// Sent by the Logic App meetingagent-followup-logic-app, called at FOLLOWUP_TRIGGER_URL with
// { ownerName, subject, html }. It looks the owner up in the Microsoft 365 directory by name
// (full name, then first name), keeps only @jrcsoftware.com addresses, and sends from
// meetingassistant@jrcsoftware.com. It answers 200 when the email was sent and 404 when no
// single person matched.

// The team works in Sri Lanka time, as in the prompt that writes the due dates.
const TIME_ZONE = "Asia/Colombo";
const NO_OWNER = /^(|—|-|unassigned)$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DUE_DATE = /^(before\s+|by\s+)?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(\d{1,2})\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?$/i;

function localDate(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month - 1, day: parts.day };
}

const validDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

// Same rule as the page: "Thu 5 Nov" is overdue from the day after, "Before 20 Nov" from the
// 20th itself, and due dates in any other form are never overdue.
function isOverdue(due, status, meetingDate, now = new Date()) {
  if (status === "done") return false;
  const match = DUE_DATE.exec(String(due ?? "").trim());
  if (!match) return false;
  const month = MONTHS.indexOf(match[3].toLowerCase());
  if (month < 0) return false;
  const year = match[4] ? Number(match[4]) : localDate(validDate(meetingDate) ?? now).year;
  const dueDay = new Date(Date.UTC(year, month, Number(match[2])));
  if (dueDay.getUTCMonth() !== month) return false; // e.g. "31 Nov"
  const t = localDate(now);
  const today = Date.UTC(t.year, t.month, t.day);
  return /^before/i.test(match[1] ?? "") ? today >= dueDay.getTime() : today > dueDay.getTime();
}

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The follow-up email. Everything from the meeting is escaped, so a task can't add markup.
// The View Details button matches the one in the summary email.
function buildFollowUpEmail({ owner, task, due, status, overdue, meetingTitle, meetingDate, detailsUrl }) {
  const firstName = owner.trim().split(/\s+/)[0];
  const date = validDate(meetingDate);
  const when = date
    ? ` on ${new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(date)}`
    : "";
  const label = 'style="padding:6px 16px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap;"';
  const value = 'style="padding:6px 0;vertical-align:top;"';
  const overdueTag = overdue ? ' &middot; <span style="color:#b4540a;font-weight:600;">Overdue</span>' : "";
  const button = detailsUrl
    ? `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding-top:20px;">` +
      `<table role="presentation" align="center" width="374" border="0" cellspacing="0" cellpadding="0" style="width:374px;max-width:100%;"><tr>` +
      `<td align="center" bgcolor="#2B4ACB" style="background-color:#2B4ACB;border-radius:8px;padding:10px 16px;">` +
      `<a href="${escapeHtml(detailsUrl)}" style="display:block;font-family:Segoe UI,Arial,sans-serif;font-size:18px;font-weight:700;line-height:24px;mso-line-height-rule:exactly;color:#ffffff;text-align:center;text-decoration:none;">View Details&nbsp;&nbsp;&rarr;</a>` +
      `</td></tr></table></td></tr></table>`
    : "";

  const html =
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:22px;color:#111827;">` +
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>` +
    `<p style="margin:0 0 16px;">This is a reminder about an action item assigned to you in <strong>${escapeHtml(meetingTitle || "a meeting")}</strong>${escapeHtml(when)}.</p>` +
    `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 16px;">` +
    `<tr><td ${label}>Task</td><td ${value}><strong>${escapeHtml(task)}</strong></td></tr>` +
    `<tr><td ${label}>Due</td><td ${value}>${escapeHtml(due && due !== "—" ? due : "No due date")}${overdueTag}</td></tr>` +
    `<tr><td ${label}>Status</td><td ${value}>${escapeHtml(STATUS_LABELS[status] ?? status)}</td></tr>` +
    `</table>` +
    `<p style="margin:0;">Please update its status on the meeting page as it moves forward.</p>` +
    button +
    `<p style="margin:24px 0 0;font-size:13px;color:#6b7280;">This reminder was sent from the meeting details page.</p>` +
    `</div>`;
  return { subject: `Follow-up: ${task}`.replace(/\s+/g, " ").trim(), html };
}

const linkHash = (id, secret) => crypto.createHash("sha256").update(id + secret, "utf8").digest("hex").toUpperCase();

// Handles POST /api/meetings/{id}/action-items/{index}/follow-up with body { task }.
// The page only says which item; the recipient, subject and body are all decided here, so
// a visitor can't change who is emailed or what the email says. The time is recorded, and
// shown on the page as "Last follow-up", only when the Logic App confirms the email was sent.
async function sendFollowUp(id, hash, indexText, body, settings, fetchImpl = fetch, now = () => new Date()) {
  if (!hasMeetingSettings(settings) || !hasStatusSettings(settings) || !hasFollowUpSettings(settings)) {
    return { status: 500, body: { error: "not_configured" } };
  }
  if (!isValidLink(id, hash, settings.MEETING_LINK_SECRET)) return { status: 404, body: { error: "not_found" } };
  if (!/^\d{1,4}$/.test(indexText ?? "")) return { status: 400, body: { error: "invalid_index" } };
  if (typeof body?.task !== "string") return { status: 400, body: { error: "invalid_task" } };
  const index = Number(indexText);

  let saved, statusFile;
  try {
    [saved, statusFile] = await Promise.all([readMeetingFile(id, settings, fetchImpl), readStatusFile(id, settings, fetchImpl)]);
  } catch (error) {
    if (error instanceof StorageError) return { status: 502, body: { error: "storage_error" } };
    throw error;
  }
  if (!saved) return { status: 404, body: { error: "not_found" } };
  const item = parseSummary(saved.summaryMarkdown).actionItems[index];
  if (!item) return { status: 404, body: { error: "not_found" } };
  if (body.task !== item.task) return { status: 409, body: { error: "item_changed" } };
  const status = savedStatus(statusFile.items, index, item.task);
  if (status === "done") return { status: 409, body: { error: "done" } };
  const owner = String(item.owner ?? "").trim();
  if (NO_OWNER.test(owner)) return { status: 422, body: { error: "no_owner" } };

  const detailsUrl = settings.VIEW_DETAILS_BASE_URL
    ? `${settings.VIEW_DETAILS_BASE_URL}${id}/${linkHash(id, settings.MEETING_LINK_SECRET)}`
    : null;
  const { subject, html } = buildFollowUpEmail({
    owner,
    task: item.task,
    due: item.due,
    status,
    overdue: isOverdue(item.due, status, saved.date, now()),
    meetingTitle: saved.title,
    meetingDate: saved.date,
    detailsUrl,
  });

  let response;
  try {
    response = await fetchImpl(settings.FOLLOWUP_TRIGGER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerName: owner, subject, html }),
    });
  } catch {
    return { status: 502, body: { error: "send_failed" } };
  }
  if (response.status === 404) return { status: 404, body: { error: "no_email" } };
  if (response.status !== 200) return { status: 502, body: { error: "send_failed" } };

  // Sent. Record when, so the page can show it; if recording fails the email still went.
  const sentAt = now().toISOString();
  let recorded = false;
  try {
    recorded = (await updateStatusFile(id, settings, fetchImpl, ({ items, followUps }) => ({
      items,
      followUps: upsert(followUps, { index, task: item.task, sentAt }),
    }))) === "saved";
  } catch (error) {
    if (!(error instanceof StorageError)) throw error;
  }
  return { status: 200, body: { sentAt, recorded } };
}

module.exports = {
  isValidLink, parseSummary, parseTranscript, getMeeting, setActionItemStatus, sendFollowUp,
  buildFollowUpEmail, isOverdue, STATUS_IDS,
};
