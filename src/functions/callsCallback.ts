import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { startTranscription } from "../graph/calls";
import { findQuestionByCallId, updateQuestion } from "../state/tableStore";

interface CallNotification {
  resourceUrl?: string; // "/communications/calls/{callId}"
  resourceData?: { id?: string; state?: string };
}

/**
 * Graph reports the app's own call events here (the callbackUri given when the app
 * joins a meeting in graph/calls.ts). When the call reaches "established", start the
 * meeting's transcription. Only calls recorded in the question table are acted on,
 * so an unknown or forged call id does nothing. The poll (src/transcriptionQuestion.ts)
 * does the same check on its own, so a missed callback only delays the start.
 */
export async function callsCallbackHandler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  let payload: { value?: CallNotification[] };
  try {
    payload = (await req.json()) as { value?: CallNotification[] };
  } catch {
    return { status: 202 };
  }

  for (const n of payload.value ?? []) {
    const callId = n.resourceData?.id ?? /\/communications\/calls\/([^/?]+)/.exec(n.resourceUrl ?? "")?.[1];
    const state = n.resourceData?.state;
    if (!callId || !state) continue;

    try {
      const q = await findQuestionByCallId(callId);
      if (!q) continue; // not one of our calls

      if (state === "established" && q.status === "joining") {
        if (!(await updateQuestion(q.key, { status: "starting" }, q.etag))) continue; // the poll got there first
        try {
          await startTranscription(callId);
          await updateQuestion(q.key, { status: "started" });
          context.log(`[calls] started transcription for "${q.meetingSubject}"`);
        } catch (err) {
          const note = err instanceof Error ? err.message.slice(0, 300) : String(err);
          context.error(`[calls] startTranscription failed for "${q.meetingSubject}": ${note}`);
          await updateQuestion(q.key, { status: "failed", note }); // the poll tells the chat and leaves the call
        }
      } else if (state === "terminated" && ["joining", "starting", "started"].includes(q.status ?? "")) {
        await updateQuestion(q.key, {
          status: q.status === "started" ? "ended" : "failed",
          note: "call ended",
        });
      }
    } catch (err) {
      context.error(`[calls] could not handle "${state}" for call ${callId}:`, err);
    }
  }

  // Graph only needs an acknowledgement.
  return { status: 202 };
}

app.http("callsCallback", {
  route: "calls/callback",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: callsCallbackHandler,
});
