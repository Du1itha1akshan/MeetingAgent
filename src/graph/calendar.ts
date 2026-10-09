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

export interface MeetingMetadata {
  meetingLink: string;
  chatId: string;
  organizerName: string;
  organizerEmail: string;
}

/**
 * Best-effort join link + organizer for a meeting. Never throws: a metadata
 * gap must not block publishing the summary, so anything unresolved is "".
 *
 * Link and organizer email come from the onlineMeeting resource. That
 * resource carries no display name (and the app has no User.Read.All to look
 * one up), so the organizer's name is read from the calendar event instead.
 */
export async function getMeetingMetadata(
  userId: string,
  onlineMeetingId: string,
  meetingStartIso: string
): Promise<MeetingMetadata> {
  const result: MeetingMetadata = {
    meetingLink: "",
    chatId: "",
    organizerName: "",
    organizerEmail: "",
  };

  try {
    const meeting = await graphFetch<{
      joinWebUrl?: string;
      chatInfo?: { threadId?: string };
      participants?: { organizer?: { upn?: string } };
    }>(`/users/${encodeURIComponent(userId)}/onlineMeetings/${onlineMeetingId}`);
    result.meetingLink = meeting.joinWebUrl ?? "";
    result.chatId = meeting.chatInfo?.threadId ?? "";
    result.organizerEmail = meeting.participants?.organizer?.upn ?? "";
  } catch (err) {
    console.warn(`[metadata] onlineMeeting lookup failed for ${onlineMeetingId}:`, err);
  }

  if (!result.meetingLink) return result;

  try {
    // Calendar start times come back without a zone suffix (UTC).
    const hasZone = /(Z|[+-]\d{2}:\d{2})$/i.test(meetingStartIso);
    const startMs = Date.parse(hasZone ? meetingStartIso : `${meetingStartIso}Z`);
    const params = new URLSearchParams({
      startDateTime: new Date(startMs - 60_000).toISOString(),
      endDateTime: new Date(startMs + 60_000).toISOString(),
      $select: "onlineMeeting,organizer",
    });
    const data = await graphFetch<{
      value: {
        onlineMeeting?: { joinUrl: string };
        organizer?: { emailAddress?: { name?: string; address?: string } };
      }[];
    }>(`/users/${encodeURIComponent(userId)}/calendarView?${params.toString()}`);

    const event = data.value.find((e) => e.onlineMeeting?.joinUrl === result.meetingLink);
    result.organizerName = event?.organizer?.emailAddress?.name ?? "";
    result.organizerEmail ||= event?.organizer?.emailAddress?.address ?? "";
  } catch (err) {
    console.warn(`[metadata] organizer name lookup failed for ${onlineMeetingId}:`, err);
  }

  return result;
}
