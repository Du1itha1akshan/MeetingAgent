import { graphFetch } from "./auth";

export interface TranscriptRef {
  id: string;
  createdDateTime: string;
  meetingId: string;
  callId?: string;
}

/** Lists transcript objects available for a given online meeting. */
export async function listTranscripts(
  userId: string,
  onlineMeetingId: string
): Promise<TranscriptRef[]> {
  const data = await graphFetch<{
    value: { id: string; createdDateTime: string; callId?: string }[];
  }>(`/users/${encodeURIComponent(userId)}/onlineMeetings/${onlineMeetingId}/transcripts`);

  return data.value.map((t) => ({
    id: t.id,
    createdDateTime: t.createdDateTime,
    meetingId: onlineMeetingId,
    callId: t.callId,
  }));
}

/**
 * Fetches raw transcript content (WebVTT format) for a specific transcript.
 * Graph returns text/vtt; graphFetch already handles the non-JSON path.
 */
export async function getTranscriptContentVtt(
  userId: string,
  onlineMeetingId: string,
  transcriptId: string
): Promise<string> {
  return graphFetch<string>(
    `/users/${encodeURIComponent(
      userId
    )}/onlineMeetings/${onlineMeetingId}/transcripts/${transcriptId}/content?$format=text/vtt`
  );
}

/**
 * Convenience: get the most recent transcript's raw VTT for a meeting.
 *
 * A recurring meeting series reuses the same onlineMeetingId across every
 * occurrence, so `listTranscripts` returns transcripts from ALL past
 * occurrences, not just the current one. Without `afterIso`, "most recent"
 * would happily return last week's already-processed transcript before
 * today's actually exists — pass the current occurrence's scheduled start
 * (meetingStartIso) to only consider transcripts created for THIS occurrence.
 */
export async function getLatestTranscriptVtt(
  userId: string,
  onlineMeetingId: string,
  afterIso?: string
): Promise<{ vtt: string; transcriptId: string; callId?: string } | null> {
  const transcripts = await listTranscripts(userId, onlineMeetingId);
  const candidates = afterIso
    ? transcripts.filter((t) => t.createdDateTime > afterIso)
    : transcripts;
  if (!candidates.length) return null;

  const latest = candidates.sort((a, b) =>
    b.createdDateTime.localeCompare(a.createdDateTime)
  )[0];

  const vtt = await getTranscriptContentVtt(userId, onlineMeetingId, latest.id);
  return { vtt, transcriptId: latest.id, callId: latest.callId };
}
