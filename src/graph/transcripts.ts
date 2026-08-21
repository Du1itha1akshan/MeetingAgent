import { graphFetch } from "./auth";

export interface TranscriptRef {
  id: string;
  createdDateTime: string;
  meetingId: string;
}

/** Lists transcript objects available for a given online meeting. */
export async function listTranscripts(
  userId: string,
  onlineMeetingId: string
): Promise<TranscriptRef[]> {
  const data = await graphFetch<{
    value: { id: string; createdDateTime: string }[];
  }>(`/users/${encodeURIComponent(userId)}/onlineMeetings/${onlineMeetingId}/transcripts`);

  return data.value.map((t) => ({
    id: t.id,
    createdDateTime: t.createdDateTime,
    meetingId: onlineMeetingId,
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

/** Convenience: get the most recent transcript's raw VTT for a meeting. */
export async function getLatestTranscriptVtt(
  userId: string,
  onlineMeetingId: string
): Promise<{ vtt: string; transcriptId: string } | null> {
  const transcripts = await listTranscripts(userId, onlineMeetingId);
  if (!transcripts.length) return null;

  const latest = transcripts.sort((a, b) =>
    b.createdDateTime.localeCompare(a.createdDateTime)
  )[0];

  const vtt = await getTranscriptContentVtt(userId, onlineMeetingId, latest.id);
  return { vtt, transcriptId: latest.id };
}
