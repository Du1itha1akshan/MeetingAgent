import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getConfig } from "../config";
import { getOnlineMeeting, findInvolvedMonitoredUser } from "../graph/meetings";
import { enqueueTranscriptReady } from "../state/queueStore";

interface GraphNotification {
  subscriptionId: string;
  clientState?: string;
  // Tenant-wide: "communications/onlineMeetings('{meetingId}')/transcripts('{transcriptId}')"
  resource: string;
  changeType: string;
}

function parseMeetingId(resource: string): string | null {
  const match = resource.match(/onlineMeetings\('([^']+)'\)/i);
  return match ? match[1] : null;
}

export async function graphWebhookHandler(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // Step 1: subscription validation handshake — Graph expects the token
  // echoed back as text/plain within a few seconds.
  const validationToken = req.query.get("validationToken");
  if (validationToken) {
    return { status: 200, headers: { "Content-Type": "text/plain" }, body: validationToken };
  }

  const config = await getConfig();
  const payload = (await req.json()) as { value?: GraphNotification[] };

  for (const notification of payload.value ?? []) {
    if (notification.clientState !== config.webhook.clientState) {
      context.warn("[webhook] clientState mismatch, dropping notification");
      continue;
    }

    const meetingId = parseMeetingId(notification.resource);
    if (!meetingId) {
      context.warn(`[webhook] unrecognized resource format: ${notification.resource}`);
      continue;
    }

    try {
      // The subscription is tenant-wide, so every meeting's transcript lands
      // here. Graph can't filter by attendee, so drop anything the JRC Meeting
      // Assistant isn't part of before it costs a queue message or a Claude call.
      const meeting = await getOnlineMeeting(meetingId);
      const monitoredUser = await findInvolvedMonitoredUser(meeting);
      if (!monitoredUser) continue;

      await enqueueTranscriptReady({
        userId: monitoredUser, // transcripts are fetched under the assistant, as in the poll path
        onlineMeetingId: meetingId,
        meetingSubject: meeting.subject ?? "Untitled meeting",
        meetingStartIso: meeting.startDateTime ?? new Date().toISOString(),
        source: "webhook",
      });
    } catch (err) {
      context.error(`[webhook] failed to process meeting ${meetingId}:`, err);
      // Swallow: returning 5xx here would make Graph retry the whole batch.
      // The polling fallback will pick this meeting up within its lookback window.
    }
  }

  // Graph requires a fast ack; the real work happens in the queue trigger.
  return { status: 202 };
}

app.http("graphWebhook", {
  route: "graph/notifications",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: graphWebhookHandler,
});
