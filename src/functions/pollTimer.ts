import { app, Timer, InvocationContext } from "@azure/functions";
import { getConfig } from "../config";
import { listScheduledTeamsMeetings, resolveOnlineMeetingId } from "../graph/calendar";
import { listTranscripts } from "../graph/transcripts";
import { ensureAllSubscriptions } from "../graph/subscriptions";
import { enqueueTranscriptReady } from "../state/queueStore";
import {
  getPendingRecord,
  putPendingRecord,
  deletePendingRecord,
  listPendingRecords,
  PendingTranscriptRecord,
} from "../state/tableStore";

// Give up on a meeting that never produces a transcript (access-policy
// denial, cancelled recording, etc.) rather than retrying it forever.
const PENDING_MAX_AGE_HOURS = 24;

/**
 * Runs every 5 minutes, always — three jobs in one, since they all need the
 * same "wake up periodically" mechanism and there's no long-lived process
 * left to host a setInterval:
 *
 *   1. Keep each monitored user's Graph subscription alive (create/renew).
 *   2. Re-check every meeting still waiting on its transcript, regardless of
 *      whether it's still inside the calendar lookback window — a meeting
 *      that runs long enough to age out of that window would otherwise never
 *      be revisited. Gives up after PENDING_MAX_AGE_HOURS.
 *   3. Belt-and-suspenders sweep of each user's calendar for meetings that
 *      ended within the lookback window, in case a webhook notification was
 *      ever missed (Graph doesn't guarantee delivery). A meeting whose
 *      transcript isn't ready yet is tracked in the pending table (step 2)
 *      instead of being enqueued early. Duplicate work against an
 *      already-published meeting is a no-op — see pipeline.ts.
 */
export async function pollTimerHandler(_timer: Timer, context: InvocationContext): Promise<void> {
  const config = await getConfig();

  await ensureAllSubscriptions(config.monitoredUsers);

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - config.poll.lookbackMinutes * 60_000);

  let pendingRecords: PendingTranscriptRecord[];
  try {
    pendingRecords = await listPendingRecords();
  } catch (err) {
    context.error("[poll] failed to list pending transcripts:", err);
    pendingRecords = [];
  }

  for (const pending of pendingRecords) {
    try {
      // A recurring series reuses the same onlineMeetingId across every
      // occurrence, so listTranscripts() can return a PRIOR occurrence's
      // transcript even before this one's exists — only count one created
      // after this occurrence's scheduled start.
      const transcripts = await listTranscripts(pending.userId, pending.onlineMeetingId);
      const current = transcripts.filter((t) => t.createdDateTime > pending.meetingStartIso);
      if (current.length > 0) {
        await enqueueTranscriptReady({
          userId: pending.userId,
          onlineMeetingId: pending.onlineMeetingId,
          meetingSubject: pending.meetingSubject,
          meetingStartIso: pending.meetingStartIso,
          source: "poll",
        });
        await deletePendingRecord(pending.onlineMeetingId);
        continue;
      }

      const ageHours =
        (now.getTime() - new Date(pending.firstSeenAt).getTime()) / 3_600_000;
      if (ageHours > PENDING_MAX_AGE_HOURS) {
        context.warn(
          `[poll] giving up on "${pending.meetingSubject}" — no transcript after ${PENDING_MAX_AGE_HOURS}h`
        );
        await deletePendingRecord(pending.onlineMeetingId);
      }
    } catch (err) {
      context.error(`[poll] pending re-check failed for "${pending.meetingSubject}":`, err);
    }
  }

  for (const userId of config.monitoredUsers) {
    let meetings;
    try {
      meetings = await listScheduledTeamsMeetings(
        userId,
        lookbackStart.toISOString(),
        now.toISOString()
      );
    } catch (err) {
      context.error(`[poll] failed to list meetings for ${userId}:`, err);
      continue;
    }

    for (const meeting of meetings) {
      if (new Date(meeting.end) > now) continue; // still in progress

      try {
        const onlineMeetingId = await resolveOnlineMeetingId(userId, meeting.joinUrl);
        // Same recurring-series caveat as above: only a transcript created
        // after THIS occurrence's start actually belongs to it.
        const transcripts = await listTranscripts(userId, onlineMeetingId);
        const current = transcripts.filter((t) => t.createdDateTime > meeting.start);

        if (current.length > 0) {
          await enqueueTranscriptReady({
            userId,
            onlineMeetingId,
            meetingSubject: meeting.subject,
            meetingStartIso: meeting.start,
            source: "poll",
          });
          await deletePendingRecord(onlineMeetingId); // in case it was already pending
        } else {
          const existing = await getPendingRecord(onlineMeetingId);
          await putPendingRecord({
            userId,
            onlineMeetingId,
            meetingSubject: meeting.subject,
            meetingStartIso: meeting.start,
            firstSeenAt: existing?.firstSeenAt ?? now.toISOString(),
          });
        }
      } catch (err) {
        context.error(`[poll] failed to process "${meeting.subject}":`, err);
      }
    }
  }
}

app.timer("pollTimer", {
  schedule: "0 */5 * * * *",
  handler: pollTimerHandler,
});
