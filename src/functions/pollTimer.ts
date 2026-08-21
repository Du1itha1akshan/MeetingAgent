import { app, Timer, InvocationContext } from "@azure/functions";
import { getConfig } from "../config";
import { listScheduledTeamsMeetings, resolveOnlineMeetingId } from "../graph/calendar";
import { ensureAllSubscriptions } from "../graph/subscriptions";
import { enqueueTranscriptReady } from "../state/queueStore";

/**
 * Runs every 5 minutes, always — two jobs in one, since both need the same
 * "wake up periodically" mechanism and there's no long-lived process left to
 * host a setInterval:
 *
 *   1. Keep each monitored user's Graph subscription alive (create/renew).
 *   2. Belt-and-suspenders sweep of each user's calendar for meetings that
 *      ended within the lookback window, in case a webhook notification was
 *      ever missed (Graph doesn't guarantee delivery). Duplicate work against
 *      an already-published meeting is a no-op — see pipeline.ts.
 */
export async function pollTimerHandler(_timer: Timer, context: InvocationContext): Promise<void> {
  const config = await getConfig();

  await ensureAllSubscriptions(config.monitoredUsers);

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - config.poll.lookbackMinutes * 60_000);

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
        await enqueueTranscriptReady({
          userId,
          onlineMeetingId,
          meetingSubject: meeting.subject,
          meetingStartIso: meeting.start,
        });
      } catch (err) {
        context.error(`[poll] failed to enqueue "${meeting.subject}":`, err);
      }
    }
  }
}

app.timer("pollTimer", {
  schedule: "0 */5 * * * *",
  handler: pollTimerHandler,
});
