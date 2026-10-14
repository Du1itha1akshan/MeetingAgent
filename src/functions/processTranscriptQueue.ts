import { app, InvocationContext } from "@azure/functions";
import { processMeetingTranscript } from "../pipeline";
import { resolveTranscriptNotification } from "../graph/meetings";
import {
  TRANSCRIPT_QUEUE_NAME,
  QueueMessage,
  TranscriptReadyMessage,
  isNotificationMessage,
} from "../state/queueStore";

export async function processTranscriptQueueHandler(
  message: unknown,
  context: InvocationContext
): Promise<void> {
  const msg = (typeof message === "string" ? JSON.parse(message) : message) as QueueMessage;

  // Throwing here (transient Claude/Graph/GitHub failure) lets the Functions
  // queue trigger retry automatically (host.json: up to 5 attempts) before
  // the message lands in the poison queue for manual inspection.
  let job: TranscriptReadyMessage;
  if (isNotificationMessage(msg)) {
    // Raw webhook notification for ANY meeting in the tenant: find out whether a
    // monitored user (the JRC Meeting Assistant) is part of it, and drop it if not.
    const resolved = await resolveTranscriptNotification(msg.meetingId, msg.transcriptId);
    if (!resolved) {
      context.log(`[queue] dropping meeting ${msg.meetingId}: no monitored user is part of it`);
      return;
    }
    job = { ...resolved, onlineMeetingId: msg.meetingId, source: "webhook" };
  } else {
    job = msg;
  }

  context.log(`[queue] processing "${job.meetingSubject}" for ${job.userId} (source: ${job.source})`);
  await processMeetingTranscript({
    userId: job.userId,
    onlineMeetingId: job.onlineMeetingId,
    meetingSubject: job.meetingSubject,
    meetingStartIso: job.meetingStartIso,
  });
}

app.storageQueue("processTranscriptQueue", {
  queueName: TRANSCRIPT_QUEUE_NAME,
  connection: "AzureWebJobsStorage",
  handler: processTranscriptQueueHandler,
});
