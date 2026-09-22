import { QueueClient, QueueServiceClient } from "@azure/storage-queue";
import { getConfig } from "../config";

export const TRANSCRIPT_QUEUE_NAME = "meeting-transcript-ready";

export interface TranscriptReadyMessage {
  userId: string;
  onlineMeetingId: string;
  meetingSubject: string;
  meetingStartIso: string;
}

let queuePromise: Promise<QueueClient> | null = null;

async function getQueueClient(): Promise<QueueClient> {
  if (!queuePromise) {
    queuePromise = getConfig().then(async (config) => {
      const client = QueueServiceClient.fromConnectionString(
        config.storage.connectionString
      ).getQueueClient(TRANSCRIPT_QUEUE_NAME);
      await client.createIfNotExists();
      return client;
    });
  }
  return queuePromise;
}

/**
 * The HTTP webhook and the timer poll both push here instead of processing
 * inline. That gets Graph's fast-ack requirement (respond within seconds)
 * and Azure Functions' built-in retry-with-poison-queue for transient
 * failures in the actual work (Claude call, GitHub write) for free.
 */
export async function enqueueTranscriptReady(msg: TranscriptReadyMessage): Promise<void> {
  const client = await getQueueClient();
  // Plain JSON text, not base64: the Functions Node worker auto-parses a
  // queue message that's valid JSON into an object for the trigger handler.
  await client.sendMessage(JSON.stringify(msg));
}
