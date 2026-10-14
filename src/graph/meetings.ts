import { graphFetch, isNotAccessible } from "./auth";
import { getConfig } from "../config";

interface MeetingIdentity {
  upn?: string;
  identity?: { user?: { id?: string } };
}

export interface OnlineMeeting {
  id: string;
  subject?: string;
  startDateTime?: string;
  participants?: {
    organizer?: MeetingIdentity;
    attendees?: MeetingIdentity[];
  };
}

/**
 * Meeting ids are base64 of "1*<organizerUserId>*0**19:meeting_...@thread.v2",
 * so the organizer's object id can be read straight out of the id.
 */
function organizerIdFromMeetingId(onlineMeetingId: string): string | null {
  try {
    const organizerId = Buffer.from(onlineMeetingId, "base64").toString("utf8").split("*")[1];
    return organizerId && /^[0-9a-f-]{36}$/i.test(organizerId) ? organizerId : null;
  } catch {
    return null;
  }
}

/**
 * Fetches a meeting from a tenant-wide notification, whose resource path has no
 * user in it. v1.0 has no user-less GET for these ids ("/communications/
 * onlineMeetings/{id}" returns 400 "Unexpected id format"), so it must go
 * through /users/{id}/onlineMeetings/{id}: try the organizer first, then each
 * monitored user (an invitee such as the assistant can read it too).
 */
export async function getOnlineMeeting(onlineMeetingId: string): Promise<OnlineMeeting> {
  const config = await getConfig();
  const candidates = [organizerIdFromMeetingId(onlineMeetingId), ...config.monitoredUsers].filter(
    (u): u is string => !!u
  );

  let lastErr: unknown;
  let transientErr: unknown; // anything other than 403/404 deserves a retry, so don't let a later 404 hide it
  for (const user of candidates) {
    try {
      return await graphFetch<OnlineMeeting>(
        `/users/${encodeURIComponent(user)}/onlineMeetings/${onlineMeetingId}`
      );
    } catch (err) {
      lastErr = err;
      if (!isNotAccessible(err)) transientErr ??= err;
    }
  }
  throw transientErr ?? lastErr ?? new Error(`No user available to look up meeting ${onlineMeetingId}`);
}

/**
 * Turns a raw tenant-wide transcript notification into a ready-to-process job,
 * or null if it isn't for us. Runs in the queue function (not the webhook) so
 * the webhook can answer Graph within its few-second limit.
 *
 * Returns null — drop quietly, no retry — when no monitored user is the
 * organizer or an attendee, or when Graph says the meeting can't be read (403/404:
 * a meeting we aren't part of). Anything else (timeouts, 5xx, a transcript that
 * isn't listable yet) throws, so the queue retries it.
 */
export async function resolveTranscriptNotification(
  meetingId: string,
  transcriptId: string
): Promise<{
  userId: string;
  meetingSubject: string;
  meetingStartIso: string;
} | null> {
  let meeting: OnlineMeeting;
  try {
    meeting = await getOnlineMeeting(meetingId);
  } catch (err) {
    if (isNotAccessible(err)) return null;
    throw err;
  }

  const monitoredUser = await findInvolvedMonitoredUser(meeting);
  if (!monitoredUser) return null;

  // meeting.startDateTime is the start of a recurring SERIES, not of this
  // occurrence, so using it dated every occurrence as the first one and made
  // them overwrite each other's folder. The notification is for one specific
  // transcript, so use when that transcript was created instead.
  const transcript = await graphFetch<{ createdDateTime: string }>(
    `/users/${encodeURIComponent(monitoredUser)}/onlineMeetings/${meetingId}/transcripts/${transcriptId}`
  );

  return {
    userId: monitoredUser, // transcripts are fetched under the assistant, as in the poll path
    meetingSubject: meeting.subject ?? "Untitled meeting",
    meetingStartIso: transcript.createdDateTime,
  };
}

/**
 * Returns the MONITORED_USERS entry (e.g. the JRC Meeting Assistant) that is the
 * organizer or an invited attendee of this meeting, or null if none is.
 * That entry is then used as the /users/{x} path for the transcript calls.
 *
 * An entry matches an attendee's object id or UPN exactly as written (case-
 * insensitive), so MONITORED_USERS should hold the object id or the UPN — no
 * Graph lookup (and no User.Read.All permission) is needed to compare them.
 */
export async function findInvolvedMonitoredUser(meeting: OnlineMeeting): Promise<string | null> {
  const config = await getConfig();
  const people = [meeting.participants?.organizer, ...(meeting.participants?.attendees ?? [])];

  for (const configValue of config.monitoredUsers) {
    const wanted = configValue.toLowerCase();
    const present = people.some(
      (p) => p?.identity?.user?.id?.toLowerCase() === wanted || p?.upn?.toLowerCase() === wanted
    );
    if (present) return configValue;
  }
  return null;
}
