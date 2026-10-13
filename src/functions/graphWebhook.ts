import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getConfig } from "../config";
import { graphFetch } from "../graph/auth";
import { getOnlineMeeting, findInvolvedMonitoredUser } from "../graph/meetings";
import { enqueueTranscriptReady } from "../state/queueStore";

interface GraphNotification {
  subscriptionId: string;
  clientState?: string;
  // Tenant-wide: "communications/onlineMeetings('{meetingId}')/transcripts('{transcriptId}')"
  resource: string;
  changeType: string;
}

function parseIds(resource: string): { meetingId: string; transcriptId: string } | null {
  const meeting = resource.match(/onlineMeetings\('([^']+)'\)/i);
  const transcript = resource.match(/transcripts\('([^']+)'\)/i);
  if (!meeting || !transcript) return null;
  return { meetingId: meeting[1], transcriptId: transcript[1] };
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

    const ids = parseIds(notification.resource);
    if (!ids) {
      context.warn(`[webhook] unrecognized resource format: ${notification.resource}`);
      continue;
    }
    const { meetingId, transcriptId } = ids;

    try {
      // The subscription is tenant-wide, so every meeting's transcript lands
      // here. Graph can't filter by attendee, so drop anything the JRC Meeting
      // Assistant isn't part of before it costs a queue message or a Claude call.
      const meeting = await getOnlineMeeting(meetingId);
      const monitoredUser = await findInvolvedMonitoredUser(meeting);
      if (!monitoredUser) continue;

      // meeting.startDateTime is the start of a recurring SERIES, not of this
      // occurrence, so using it dated every occurrence as the first one and made
      // them overwrite each other's folder. The notification is for one specific
      // transcript, so use when that transcript was created instead.
      const transcript = await graphFetch<{ createdDateTime: string }>(
        `/users/${encodeURIComponent(monitoredUser)}/onlineMeetings/${meetingId}/transcripts/${transcriptId}`
      );

      await enqueueTranscriptReady({
        userId: monitoredUser, // transcripts are fetched under the assistant, as in the poll path
        onlineMeetingId: meetingId,
        meetingSubject: meeting.subject ?? "Untitled meeting",
        meetingStartIso: transcript.createdDateTime,
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
