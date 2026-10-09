import { graphFetch } from "./auth";

interface ChatMessage {
  eventDetail?: {
    "@odata.type"?: string;
    callId?: string;
    callRecordingStatus?: string;
    callRecordingUrl?: string;
  };
}

const RECORDING_EVENT_TYPE = "#microsoft.graph.callRecordingEventMessageDetail";

// Recording can start before the scheduled start (people join early), so look
// slightly before it rather than exactly at it.
const START_TOLERANCE_MINUTES = 30;
const MAX_PAGES = 5;

/**
 * Finds the recording URL for one call by reading the meeting chat, where
 * Teams posts a recording event message carrying the call's callId.
 *
 * A recurring series shares one chat across all occurrences, so the callId is
 * what pins the message to THIS occurrence; the date bound only keeps the
 * search small. Needs a Graph chat-read permission, so any failure (missing
 * permission, no recording, not finished yet) returns "" instead of throwing —
 * a missing link must not block publishing the summary.
 */
export async function getRecordingUrl(
  chatId: string,
  callId: string,
  meetingStartIso: string
): Promise<string> {
  if (!chatId || !callId) return "";

  try {
    // Calendar start times come back without a zone suffix (UTC).
    const hasZone = /(Z|[+-]\d{2}:\d{2})$/i.test(meetingStartIso);
    const startMs = Date.parse(hasZone ? meetingStartIso : `${meetingStartIso}Z`);
    const afterIso = new Date(startMs - START_TOLERANCE_MINUTES * 60_000).toISOString();

    const params = new URLSearchParams({
      $top: "50",
      $orderby: "lastModifiedDateTime desc",
      $filter: `lastModifiedDateTime gt ${afterIso}`,
    });

    let url: string | undefined = `/chats/${chatId}/messages?${params.toString()}`;
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const data: { value: ChatMessage[]; "@odata.nextLink"?: string } = await graphFetch(url);

      // Newest first, so with several recordings in one call this keeps the latest.
      const match = data.value.find(
        (m) =>
          m.eventDetail?.["@odata.type"] === RECORDING_EVENT_TYPE &&
          m.eventDetail.callId === callId &&
          m.eventDetail.callRecordingStatus === "success" &&
          m.eventDetail.callRecordingUrl
      );
      if (match) return match.eventDetail!.callRecordingUrl!;

      url = data["@odata.nextLink"];
    }
  } catch (err) {
    console.warn(`[recording] chat lookup failed for call ${callId}:`, err);
  }

  return "";
}
