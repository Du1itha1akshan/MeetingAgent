import { getConfig, AppConfig } from "./config";
import { listRecentChatMessages, postChatMessage } from "./graph/chat";
import { joinMeetingCall, startTranscription, leaveCall, getCallState } from "./graph/calls";
import { listQuestions, updateQuestion, TranscriptionQuestion } from "./state/tableStore";

/**
 * After the greeting asks "Shall I start transcription?" (src/greeting.ts), each
 * poll run checks the meeting chat for the answer. The first "yes" or "no" from
 * anyone in the meeting decides, once:
 *   - "no"  -> the assistant posts DECLINED_MESSAGE; nothing is transcribed.
 *   - "yes" -> with START_TRANSCRIPTION_ON_YES=true the app joins the meeting's call
 *              and starts Teams transcription (graph/calls.ts; finished by
 *              functions/callsCallback.ts). Otherwise the assistant posts how to
 *              start it from Teams.
 * No answer within TRANSCRIPTION_ANSWER_WINDOW_MINUTES, or the meeting ending, closes
 * the question. Every state change is an etag-checked update, so two poll runs (or a
 * poll and a callback) can't both act on the same answer.
 */

export const DECLINED_MESSAGE = "<p>This meeting will not be transcribed.</p>";
const MANUAL_MESSAGE =
  "<p>To start transcription, the organizer or a presenter can choose " +
  "<b>More actions → Record and transcribe → Start transcription</b>.</p>";
const FAILED_MESSAGE =
  "<p>I couldn't start transcription. It can still be started from " +
  "<b>More actions → Record and transcribe → Start transcription</b>.</p>";

// A call that hasn't connected by now isn't going to.
const CALL_CONNECT_TIMEOUT_MS = 10 * 60_000;
// Replies are matched from slightly before the question was recorded (it's recorded
// just after posting), but never the question itself or the assistant's own messages.
const ASKED_AT_SLACK_MS = 5_000;

/** "yes" / "no" if the whole message says exactly that (any case, trailing ./! ignored), else null. */
export function parseAnswer(content: string): "yes" | "no" | null {
  const text = content
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/, "")
    .trim();
  return text === "yes" ? "yes" : text === "no" ? "no" : null;
}

async function say(q: TranscriptionQuestion, html: string): Promise<void> {
  try {
    await postChatMessage(q.chatId!, html);
  } catch (err) {
    console.error(`[transcription] could not post to the chat of "${q.meetingSubject}":`, err instanceof Error ? err.message : err);
  }
}

async function handleAsked(q: TranscriptionQuestion, now: Date, config: AppConfig): Promise<void> {
  const askedAt = Date.parse(q.askedAt ?? "");
  const meetingEnd = Date.parse(q.meetingEnd ?? "");
  const windowMs = config.transcription.answerWindowMinutes * 60_000;

  if (!q.chatId || Number.isNaN(askedAt) || now.getTime() >= meetingEnd || now.getTime() - askedAt > windowMs) {
    if (await updateQuestion(q.key, { status: "expired" }, q.etag)) {
      console.log(`[transcription] no answer for "${q.meetingSubject}"; question closed`);
    }
    return;
  }

  const messages = await listRecentChatMessages(q.chatId);
  const answer = messages
    .filter(
      (m) =>
        m.messageType === "message" &&
        m.id !== q.questionMessageId &&
        !!m.fromUserId &&
        m.fromUserId !== q.assistantUserId &&
        Date.parse(m.createdDateTime) >= askedAt - ASKED_AT_SLACK_MS
    )
    .sort((a, b) => Date.parse(a.createdDateTime) - Date.parse(b.createdDateTime))
    .map((m) => ({ message: m, answer: parseAnswer(m.content) }))
    .find((x) => x.answer !== null);
  if (!answer) return; // nobody has answered yet

  const decided = {
    decidedBy: answer.message.fromName ?? answer.message.fromUserId ?? "",
    decidedAt: answer.message.createdDateTime,
  };

  if (answer.answer === "no") {
    if (!(await updateQuestion(q.key, { status: "declined", ...decided }, q.etag))) return;
    console.log(`[transcription] "${q.meetingSubject}": ${decided.decidedBy} said no`);
    await say(q, DECLINED_MESSAGE);
    return;
  }

  // "yes"
  const canStart = config.transcription.startOnYes && !!q.organizerId && !!config.transcription.callbackUrl;
  if (!canStart) {
    if (!(await updateQuestion(q.key, { status: "manual", ...decided }, q.etag))) return;
    console.log(`[transcription] "${q.meetingSubject}": ${decided.decidedBy} said yes (auto-start off)`);
    await say(q, MANUAL_MESSAGE);
    return;
  }

  if (!(await updateQuestion(q.key, { status: "joining", ...decided }, q.etag))) return;
  console.log(`[transcription] "${q.meetingSubject}": ${decided.decidedBy} said yes; joining the call`);
  try {
    const callId = await joinMeetingCall({
      chatId: q.chatId,
      organizerId: q.organizerId!,
      tenantId: config.azure.tenantId,
      callbackUri: config.transcription.callbackUrl,
    });
    await updateQuestion(q.key, { callId });
  } catch (err) {
    const note = err instanceof Error ? err.message.slice(0, 300) : String(err);
    console.error(`[transcription] could not join the call for "${q.meetingSubject}": ${note}`);
    await updateQuestion(q.key, { status: "failed", note });
  }
}

/** Calls in progress: catch up on a missed "established" callback, give up on calls that never connect, leave when the meeting ends. */
async function handleCall(q: TranscriptionQuestion, now: Date): Promise<void> {
  const meetingEnded = now.getTime() >= Date.parse(q.meetingEnd ?? "");

  if (meetingEnded) {
    // Over either way: leave, and don't post anything into a finished meeting.
    if (q.callId) await leaveCall(q.callId);
    await updateQuestion(q.key, { status: "ended", note: q.status === "started" ? q.note : "meeting ended before transcription started" }, q.etag);
    return;
  }
  if (q.status !== "joining" || !q.callId) return;

  const state = await getCallState(q.callId);
  if (state === "established") {
    if (!(await updateQuestion(q.key, { status: "starting" }, q.etag))) return; // the callback got there first
    try {
      await startTranscription(q.callId);
      await updateQuestion(q.key, { status: "started" });
      console.log(`[transcription] started transcription for "${q.meetingSubject}" (poll)`);
    } catch (err) {
      const note = err instanceof Error ? err.message.slice(0, 300) : String(err);
      console.error(`[transcription] startTranscription failed for "${q.meetingSubject}": ${note}`);
      await updateQuestion(q.key, { status: "failed", note });
    }
  } else if (state === null || state === "terminated" || now.getTime() - Date.parse(q.decidedAt ?? "") > CALL_CONNECT_TIMEOUT_MS) {
    // notifyFailure (same poll run) leaves the call and tells the chat.
    await updateQuestion(q.key, { status: "failed", note: `call did not connect (state: ${state ?? "gone"})` }, q.etag);
  }
}

/** Tells the meeting once that transcription couldn't be started, and leaves the call. */
async function notifyFailure(q: TranscriptionQuestion): Promise<void> {
  if (!(await updateQuestion(q.key, { status: "failed-notified" }, q.etag))) return;
  if (q.callId) await leaveCall(q.callId).catch(() => undefined);
  await say(q, FAILED_MESSAGE);
}

/**
 * Called once per poll run. Never throws: like the greeting, this sits on top of the
 * pipeline and must not break meeting processing.
 */
export async function processTranscriptionQuestions(now: Date): Promise<void> {
  try {
    const config = await getConfig();
    const steps: [string[], (q: TranscriptionQuestion) => Promise<void>][] = [
      [["asked"], (q) => handleAsked(q, now, config)],
      [["joining", "starting", "started"], (q) => handleCall(q, now)],
      [["failed"], (q) => notifyFailure(q)],
    ];
    for (const [statuses, handle] of steps) {
      for (const q of await listQuestions(statuses)) {
        try {
          await handle(q);
        } catch (err) {
          console.error(`[transcription] "${q.meetingSubject}" (${q.status}):`, err instanceof Error ? err.message : err);
        }
      }
    }
  } catch (err) {
    console.error("[transcription] could not process questions:", err instanceof Error ? err.message : err);
  }
}
