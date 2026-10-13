import { graphFetch } from "./auth";
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
  for (const user of candidates) {
    try {
      return await graphFetch<OnlineMeeting>(
        `/users/${encodeURIComponent(user)}/onlineMeetings/${onlineMeetingId}`
      );
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`No user available to look up meeting ${onlineMeetingId}`);
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
