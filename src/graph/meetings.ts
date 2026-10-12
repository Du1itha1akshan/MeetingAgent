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

interface MonitoredUser {
  configValue: string; // exactly as written in MONITORED_USERS; used as the /users/{x} path segment
  ids: string[];
  upns: string[];
}

let monitoredPromise: Promise<MonitoredUser[]> | null = null;

/**
 * MONITORED_USERS may hold UPNs or object ids, while meeting participants
 * expose both, so resolve each entry once to its (id, upn) pair and match on either.
 */
function getMonitoredUsers(): Promise<MonitoredUser[]> {
  if (!monitoredPromise) {
    monitoredPromise = (async () => {
      const config = await getConfig();
      return Promise.all(
        config.monitoredUsers.map(async (configValue) => {
          const ids = [configValue.toLowerCase()];
          const upns = [configValue.toLowerCase()];
          try {
            const u = await graphFetch<{ id: string; userPrincipalName: string }>(
              `/users/${encodeURIComponent(configValue)}?$select=id,userPrincipalName`
            );
            ids.push(u.id.toLowerCase());
            upns.push(u.userPrincipalName.toLowerCase());
          } catch (err) {
            console.error(`[meetings] could not resolve monitored user "${configValue}":`, err);
          }
          return { configValue, ids, upns };
        })
      );
    })();
    monitoredPromise.catch(() => {
      monitoredPromise = null; // don't cache a failed lookup
    });
  }
  return monitoredPromise;
}

/**
 * Returns the MONITORED_USERS entry (e.g. the JRC Meeting Assistant) that is the
 * organizer or an invited attendee of this meeting, or null if none is.
 * That entry is then used as the /users/{x} path for the transcript calls.
 */
export async function findInvolvedMonitoredUser(meeting: OnlineMeeting): Promise<string | null> {
  const monitored = await getMonitoredUsers();
  const people = [meeting.participants?.organizer, ...(meeting.participants?.attendees ?? [])];

  for (const user of monitored) {
    const present = people.some((p) => {
      const id = p?.identity?.user?.id?.toLowerCase();
      const upn = p?.upn?.toLowerCase();
      return (id && user.ids.includes(id)) || (upn && user.upns.includes(upn));
    });
    if (present) return user.configValue;
  }
  return null;
}
