import { getLatestTranscriptVtt } from "./graph/transcripts";
import { parseVtt, segmentsToPlainText } from "./processing/transcriptParser";
import { summarizeTranscript } from "./processing/summarizer";
import { publishMeetingDocs } from "./github/publisher";
import { isAlreadyProcessed, markProcessed } from "./state/tableStore";

/**
 * End-to-end processing for a single meeting once its transcript is ready.
 * Called from both the webhook path (via the queue) and the polling
 * fallback, which can observe the same finished meeting — the
 * isAlreadyProcessed/markProcessed pair makes re-running this a no-op
 * instead of a duplicate publish + duplicate GitHub issues.
 */
export async function processMeetingTranscript(params: {
  userId: string;
  onlineMeetingId: string;
  meetingSubject: string;
  meetingStartIso: string;
}): Promise<void> {
  const { userId, onlineMeetingId, meetingSubject, meetingStartIso } = params;

  console.log(`[pipeline] fetching transcript for "${meetingSubject}" (${onlineMeetingId})`);
  const result = await getLatestTranscriptVtt(userId, onlineMeetingId);
  if (!result) {
    console.warn(`[pipeline] no transcript available yet for ${onlineMeetingId}`);
    return;
  }

  if (await isAlreadyProcessed(userId, onlineMeetingId, result.transcriptId)) {
    console.log(`[pipeline] already processed ${onlineMeetingId}/${result.transcriptId}, skipping`);
    return;
  }

  const segments = parseVtt(result.vtt);
  if (!segments.length) {
    console.warn(`[pipeline] transcript for ${onlineMeetingId} parsed to zero segments`);
    return;
  }

  const plainText = segmentsToPlainText(segments);
  console.log(`[pipeline] summarizing ${segments.length} segments via Claude`);
  const summary = await summarizeTranscript(meetingSubject, plainText);

  const { folderPath } = await publishMeetingDocs({
    meetingSubject,
    meetingDateIso: meetingStartIso,
    segments,
    summary,
  });

  await markProcessed(userId, onlineMeetingId, result.transcriptId);

  console.log(
    `[pipeline] done. Published to ${folderPath} — ${summary.action_items.length} action item(s), ` +
      `${summary.decisions.length} decision(s).`
  );
}
