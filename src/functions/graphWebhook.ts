import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getConfig } from "../config";
import { enqueueTranscriptNotification } from "../state/queueStore";

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

/**
 * Deliberately does almost nothing: Graph hangs up (and retries, producing
 * duplicate jobs) if it isn't answered within a few seconds, and a cold start
 * plus Graph lookups can exceed that. The subscription is tenant-wide, so every
 * meeting's transcript lands here; deciding whether the JRC Meeting Assistant is
 * part of it needs Graph calls, so that happens in processTranscriptQueue, which
 * has minutes to work instead of seconds.
 */
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

    try {
      const messageId = await enqueueTranscriptNotification(ids.meetingId, ids.transcriptId);
      // Graph can deliver the same notification twice, so record which
      // invocation queued which message.
      context.log(
        `[webhook] queued message ${messageId} for meeting ${ids.meetingId} ` +
          `(transcript ${ids.transcriptId}) from invocation ${context.invocationId}`
      );
    } catch (err) {
      context.error(`[webhook] failed to queue meeting ${ids.meetingId}:`, err);
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
