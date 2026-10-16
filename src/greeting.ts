import { createHash } from "crypto";
import { getConfig } from "./config";
import { DiscoveredMeeting } from "./graph/calendar";
import { getMeetingChatInfo, postChatMessage, MeetingChatInfo } from "./graph/chat";
import { claimGreeting, releaseGreeting, updateQuestion } from "./state/tableStore";

// Only greet a meeting that started recently. Without this, switching the feature on
// (or a poll that was down) would post into a meeting that's been running for an hour.
const GREET_WITHIN_MINUTES_OF_START = 15;

/** Calendar times come back without a zone suffix (UTC), so add one before parsing. */
export function parseUtc(iso: string): number {
  const hasZone = /(Z|[+-]\d{2}:\d{2})$/i.test(iso);
  return Date.parse(hasZone ? iso : `${iso}Z`);
}

/**
 * Called from the poll for every meeting on the assistant's calendar. If the meeting
 * is in progress, started recently and hasn't been greeted yet, the JRC Meeting
 * Assistant posts the greeting (GREETING_MESSAGE) into the meeting's chat, once.
 *
 * Never throws: this is an extra on top of the pipeline, so nothing here (sign-in,
 * Graph, Key Vault) may break meeting processing. Does nothing unless
 * GREETING_ENABLED=true.
 */
export async function greetMeetingIfStarted(meeting: DiscoveredMeeting, now: Date): Promise<void> {
  let key: string | null = null;
  try {
    const config = await getConfig();
    if (!config.assistant.greetingEnabled) return;

    const start = parseUtc(meeting.start);
    const end = parseUtc(meeting.end);
    if (Number.isNaN(start) || Number.isNaN(end)) return;
    if (start > now.getTime() || end <= now.getTime()) return; // not in progress
    if (now.getTime() - start > GREET_WITHIN_MINUTES_OF_START * 60_000) return;

    // One greeting per occurrence: the event id (distinct per occurrence of a series)
    // plus its start. Hashed because table keys can't hold some characters.
    key = createHash("sha256").update(`${meeting.eventId}|${meeting.start}`).digest("hex");
    if (!(await claimGreeting(key))) return; // already greeted

    // Nothing has been posted yet, so a failure up to here may be retried next poll.
    let chat: MeetingChatInfo | null;
    try {
      chat = await getMeetingChatInfo(meeting.userId, meeting.joinUrl);
    } catch (err) {
      await releaseGreeting(key);
      throw err;
    }
    if (!chat) {
      await releaseGreeting(key);
      console.warn(`[greeting] no chat found for "${meeting.subject}"`);
      return;
    }

    // From here the claim is kept even if posting fails: retrying every 5 minutes
    // could repeat a failed sign-in and lock the assistant's account.
    const posted = await postChatMessage(chat.chatId, config.assistant.message);
    console.log(`[greeting] posted message ${posted.id} to the chat of "${meeting.subject}"`);

    // Record the question so the poll can watch for the yes/no answer
    // (src/transcriptionQuestion.ts).
    await updateQuestion(key, {
      status: "asked",
      meetingSubject: meeting.subject,
      meetingEnd: new Date(end).toISOString(),
      chatId: chat.chatId,
      organizerId: chat.organizerId ?? "",
      questionMessageId: posted.id,
      askedAt: new Date().toISOString(),
      assistantUserId: posted.fromUserId ?? "",
    });
  } catch (err) {
    console.error(`[greeting] could not greet "${meeting.subject}":`, err instanceof Error ? err.message : err);
  }
}
