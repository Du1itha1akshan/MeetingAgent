import { QueueClient, QueueServiceClient } from "@azure/storage-queue";
import { getConfig } from "../config";

export const TRANSCRIPT_QUEUE_NAME = "meeting-transcript-ready";

/** A meeting already known to involve a monitored user, ready to process (sent by the poll). Has no `kind`. */
export interface TranscriptReadyMessage {
  userId: string;
  onlineMeetingId: string;
  meetingSubject: string;
  meetingStartIso: string;
  source: "webhook" | "poll";
}

/**
 * A raw "transcript created" notification, straight from the webhook. Nothing
 * has been looked up yet: the queue function resolves the meeting and drops it
 * if no monitored user is part of it.
 */
export interface TranscriptNotificationMessage {
  kind: "notification";
  meetingId: string;
  transcriptId: string;
}

export type QueueMessage = TranscriptReadyMessage | TranscriptNotificationMessage;

export function isNotificationMessage(msg: QueueMessage): msg is TranscriptNotificationMessage {
  return (msg as TranscriptNotificationMessage).kind === "notification";
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
async function send(msg: QueueMessage): Promise<string> {
  const client = await getQueueClient();
  // Plain JSON text, not base64: the Functions Node worker auto-parses a
  // queue message that's valid JSON into an object for the trigger handler.
  const sent = await client.sendMessage(JSON.stringify(msg));
  // The queue trigger logs the same id ("Trigger Details: MessageId: ..."), so
  // callers can log it to tie a queued message back to what enqueued it.
  return sent.messageId;
}

export function enqueueTranscriptReady(msg: TranscriptReadyMessage): Promise<string> {
  return send(msg);
}

/** Webhook path: queue the bare notification and let the queue function do the lookups. */
export function enqueueTranscriptNotification(meetingId: string, transcriptId: string): Promise<string> {
  return send({ kind: "notification", meetingId, transcriptId });
}
