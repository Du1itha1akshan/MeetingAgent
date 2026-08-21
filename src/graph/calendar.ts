import { graphFetch } from "./auth";

export interface DiscoveredMeeting {
  userId: string;
  eventId: string;
  subject: string;
  start: string; // ISO
  end: string; // ISO
  joinUrl: string;
  onlineMeetingId?: string; // resolved separately
}

interface GraphEvent {
  id: string;
  subject: string;
  start: { dateTime: string };
  end: { dateTime: string };
  isOnlineMeeting: boolean;
  onlineMeeting?: { joinUrl: string };
}

/**
 * Lists Teams meetings on a user's calendar within [startWindow, endWindow].
 * Used both by the webhook-driven flow (to resolve which meeting a
 * notification belongs to) and by the polling fallback (pollOnce.ts).
 */
export async function listScheduledTeamsMeetings(
  userId: string,
  startWindowIso: string,
  endWindowIso: string
): Promise<DiscoveredMeeting[]> {
  const params = new URLSearchParams({
    startDateTime: startWindowIso,
    endDateTime: endWindowIso,
    $select: "id,subject,start,end,isOnlineMeeting,onlineMeeting",
  });

  const data = await graphFetch<{ value: GraphEvent[] }>(
    `/users/${encodeURIComponent(userId)}/calendarView?${params.toString()}`
  );

  return data.value
    .filter((e) => e.isOnlineMeeting && e.onlineMeeting?.joinUrl)
    .map((e) => ({
      userId,
      eventId: e.id,
      subject: e.subject,
      start: e.start.dateTime,
      end: e.end.dateTime,
      joinUrl: e.onlineMeeting!.joinUrl,
    }));
}

/**
 * Resolves the online meeting object (and its id) from a join URL.
 * The onlineMeetingId is what the transcripts API is keyed on.
 */
export async function resolveOnlineMeetingId(
  userId: string,
  joinUrl: string
): Promise<string> {
  const params = new URLSearchParams({
    $filter: `JoinWebUrl eq '${joinUrl}'`,
  });
  const data = await graphFetch<{ value: { id: string }[] }>(
    `/users/${encodeURIComponent(userId)}/onlineMeetings?${params.toString()}`
  );
  if (!data.value.length) {
    throw new Error(`No onlineMeeting found for joinUrl on user ${userId}`);
  }
  return data.value[0].id;
}
