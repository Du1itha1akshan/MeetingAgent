import { getLatestTranscriptVtt } from "./graph/transcripts";
import { getMeetingMetadata } from "./graph/calendar";
import { getRecordingUrl } from "./graph/recordings";
import { parseVtt, segmentsToPlainText } from "./processing/transcriptParser";
import { summarizeTranscript } from "./processing/summarizer";
import { publishMeetingDocs } from "./github/publisher";
import { claimTranscript, markProcessed, releaseClaim } from "./state/tableStore";

/**
 * End-to-end processing for a single meeting once its transcript is ready.
 * Called from both the webhook path (via the queue) and the polling
 * fallback, which can observe the same finished meeting — and Graph can
 * deliver one notification twice. claimTranscript() lets exactly one
 * invocation publish a given transcript, so duplicates neither race each
 * other into GitHub write conflicts nor create duplicate issues.
 */
export async function processMeetingTranscript(params: {
  userId: string;
  onlineMeetingId: string;
  meetingSubject: string;
  meetingStartIso: string;
}): Promise<void> {
  const { userId, onlineMeetingId, meetingSubject, meetingStartIso } = params;

  console.log(`[pipeline] fetching transcript for "${meetingSubject}" (${onlineMeetingId})`);
  // afterIso=meetingStartIso: a recurring series reuses the same onlineMeetingId
  // across every occurrence, so without this cutoff "latest transcript" could
  // mean a prior, already-processed occurrence's transcript, not this one's.
  const result = await getLatestTranscriptVtt(userId, onlineMeetingId, meetingStartIso);
  if (!result) {
    // Throw, don't return: a webhook can fire before Graph lists the transcript,
    // and returning would mark the queue message done with nothing left to retry
    // it. Throwing lets the queue retry (host.json: up to 5 attempts) before
    // parking it in the poison queue; the poll sweep still backs it up.
    throw new Error(`No transcript available yet for ${onlineMeetingId} ("${meetingSubject}")`);
  }

  const claim = await claimTranscript(userId, onlineMeetingId, result.transcriptId);
  if (claim.status === "done") {
    console.log(`[pipeline] already processed ${onlineMeetingId}/${result.transcriptId}, skipping`);
    return;
  }
  if (claim.status === "in-progress") {
    // Throw, don't return: if the invocation that holds the claim dies, nothing
    // else would ever publish this. The queue retries this copy in ~5 minutes;
    // by then the other one has finished (-> "already processed") or its stale
    // claim can be taken over.
    throw new Error(
      `${onlineMeetingId}/${result.transcriptId} is being processed by another invocation`
    );
  }

  try {
    const segments = parseVtt(result.vtt);
    if (!segments.length) {
      console.warn(`[pipeline] transcript for ${onlineMeetingId} parsed to zero segments`);
      await releaseClaim(userId, onlineMeetingId, result.transcriptId, claim.etag);
      return;
    }

    const plainText = segmentsToPlainText(segments);
    console.log(`[pipeline] summarizing ${segments.length} segments via Claude`);
    const summary = await summarizeTranscript(meetingSubject, plainText);

    const metadata = await getMeetingMetadata(userId, onlineMeetingId, meetingStartIso);
    // The transcript's callId pins the recording message in the (series-shared)
    // meeting chat to this occurrence. "" when there's no recording or no access.
    const recordingUrl = await getRecordingUrl(
      metadata.chatId,
      result.callId ?? "",
      meetingStartIso
    );

    const { folderPath } = await publishMeetingDocs({
      meetingSubject,
      meetingDateIso: meetingStartIso,
      segments,
      summary,
      recordingLink: recordingUrl,
      organizerName: metadata.organizerName,
      organizerEmail: metadata.organizerEmail,
    });

    await markProcessed(userId, onlineMeetingId, result.transcriptId);

    console.log(
      `[pipeline] done. Published to ${folderPath} — ${summary.action_items.length} action item(s), ` +
        `${summary.decisions.length} decision(s).`
    );
  } catch (err) {
    // Hand the claim back so the queue's retry can proceed immediately instead
    // of finding it "in progress" for the next 12 minutes.
    await releaseClaim(userId, onlineMeetingId, result.transcriptId, claim.etag).catch((releaseErr) =>
      console.warn(`[pipeline] could not release claim for ${onlineMeetingId}:`, releaseErr)
    );
    throw err;
  }
}
