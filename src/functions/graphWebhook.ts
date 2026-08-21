import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getConfig } from "../config";
import { graphFetch } from "../graph/auth";
import { enqueueTranscriptReady } from "../state/queueStore";

interface GraphNotification {
  subscriptionId: string;
  clientState?: string;
  resource: string; // e.g. "Users/{userId}/OnlineMeetings('{meetingId}')/Transcripts('{transcriptId}')"
  changeType: string;
}

function parseResource(resource: string): { userId: string; meetingId: string } | null {
  const match = resource.match(/Users\/([^/]+)\/OnlineMeetings\('([^']+)'\)/i);
  if (!match) return null;
  return { userId: match[1], meetingId: match[2] };
}

async function lookupMeetingMetadata(userId: string, meetingId: string) {
  const meeting = await graphFetch<{ subject?: string; startDateTime?: string }>(
    `/users/${encodeURIComponent(userId)}/onlineMeetings/${meetingId}`
  );
  return {
    subject: meeting.subject ?? "Untitled meeting",
    startIso: meeting.startDateTime ?? new Date().toISOString(),
  };
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

    const parsed = parseResource(notification.resource);
    if (!parsed) {
      context.warn(`[webhook] unrecognized resource format: ${notification.resource}`);
      continue;
    }

    try {
      const meta = await lookupMeetingMetadata(parsed.userId, parsed.meetingId);
      await enqueueTranscriptReady({
        userId: parsed.userId,
        onlineMeetingId: parsed.meetingId,
        meetingSubject: meta.subject,
        meetingStartIso: meta.startIso,
      });
    } catch (err) {
      context.error(`[webhook] failed to enqueue meeting ${parsed.meetingId}:`, err);
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
