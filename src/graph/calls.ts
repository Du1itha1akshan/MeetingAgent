import { graphFetch } from "./auth";

/**
 * Starting Teams transcription from code. Graph's startTranscription acts on a
 * *call the app itself is in*, so the app first joins the meeting as a calling bot
 * (service-hosted media: it doesn't receive or process any audio), then asks Teams
 * to start its own transcription, which shows the usual transcription notice to
 * everyone. The transcript then reaches this pipeline like any other.
 *
 * Requires, beyond the code: the Calls.JoinGroupCall.All application permission
 * (admin consent), the app registered as a calling bot (Azure Bot with the Teams
 * channel's calling webhook set to CALLS_CALLBACK_URL), and the callback function
 * in functions/callsCallback.ts. startTranscription is a Graph *beta* API.
 */

/** Joins a meeting's call as the app. Returns the app's call id. */
export async function joinMeetingCall(params: {
  chatId: string;
  organizerId: string;
  tenantId: string;
  callbackUri: string;
}): Promise<string> {
  const call = await graphFetch<{ id: string }>("/communications/calls", {
    method: "POST",
    body: JSON.stringify({
      "@odata.type": "#microsoft.graph.call",
      callbackUri: params.callbackUri,
      requestedModalities: ["audio"],
      mediaConfig: { "@odata.type": "#microsoft.graph.serviceHostedMediaConfig" },
      chatInfo: {
        "@odata.type": "#microsoft.graph.chatInfo",
        threadId: params.chatId,
        messageId: "0",
      },
      meetingInfo: {
        "@odata.type": "#microsoft.graph.organizerMeetingInfo",
        organizer: {
          "@odata.type": "#microsoft.graph.identitySet",
          user: {
            "@odata.type": "#microsoft.graph.identity",
            id: params.organizerId,
            tenantId: params.tenantId,
          },
        },
        allowConversationWithoutHost: true,
      },
      tenantId: params.tenantId,
    }),
  });
  return call.id;
}

/**
 * The app's call state ("establishing", "established", "terminated", ...), or null
 * if the call no longer exists. Lets the poll catch up when a callback was missed.
 */
export async function getCallState(callId: string): Promise<string | null> {
  try {
    const call = await graphFetch<{ state?: string }>(`/communications/calls/${callId}`);
    return call.state ?? null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/** Asks Teams to start transcribing the meeting the app's call is in (Graph beta). */
export async function startTranscription(callId: string, language = "en-us"): Promise<void> {
  await graphFetch(
    `https://graph.microsoft.com/beta/communications/calls/${callId}/microsoft.graph.StartTranscription`,
    { method: "POST", body: JSON.stringify({ language }) }
  );
}

/** Leaves the meeting (hangs up the app's own call). A call that's already gone is fine. */
export async function leaveCall(callId: string): Promise<void> {
  try {
    await graphFetch(`/communications/calls/${callId}`, { method: "DELETE" });
  } catch (err: any) {
    if (err?.status !== 404) throw err;
  }
}
