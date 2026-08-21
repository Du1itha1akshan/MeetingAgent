import { app, InvocationContext } from "@azure/functions";
import { processMeetingTranscript } from "../pipeline";
import { TRANSCRIPT_QUEUE_NAME, TranscriptReadyMessage } from "../state/queueStore";

export async function processTranscriptQueueHandler(
  message: unknown,
  context: InvocationContext
): Promise<void> {
  const msg = (typeof message === "string" ? JSON.parse(message) : message) as TranscriptReadyMessage;
  context.log(`[queue] processing "${msg.meetingSubject}" for ${msg.userId}`);

  // Throwing here (transient Claude/Graph/GitHub failure) lets the Functions
  // queue trigger retry automatically (host.json: up to 5 attempts) before
  // the message lands in the poison queue for manual inspection.
  await processMeetingTranscript({
    userId: msg.userId,
    onlineMeetingId: msg.onlineMeetingId,
    meetingSubject: msg.meetingSubject,
    meetingStartIso: msg.meetingStartIso,
  });
}

app.storageQueue("processTranscriptQueue", {
  queueName: TRANSCRIPT_QUEUE_NAME,
  connection: "AzureWebJobsStorage",
  handler: processTranscriptQueueHandler,
});
