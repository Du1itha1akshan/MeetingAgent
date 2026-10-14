import { TableClient } from "@azure/data-tables";
import { getConfig } from "../config";

const clients = new Map<string, TableClient>();

/**
 * Table clients are the only piece of state that survives across Function
 * invocations (Functions themselves are stateless/scaled-out). Uses the same
 * storage connection string the Functions runtime already requires
 * (AzureWebJobsStorage) — in Azure that's a Key Vault-referenced app
 * setting, locally it's Azurite via UseDevelopmentStorage=true.
 */
async function getTableClient(tableName: string): Promise<TableClient> {
  const cached = clients.get(tableName);
  if (cached) return cached;

  const config = await getConfig();
  const client = TableClient.fromConnectionString(config.storage.connectionString, tableName);

  try {
    await client.createTable();
  } catch (err: any) {
    if (err.statusCode !== 409) throw err; // 409 = table already exists
  }

  clients.set(tableName, client);
  return client;
}

export interface SubscriptionRecord {
  userId: string;
  subscriptionId: string;
  expirationDateTime: string;
}

const SUBSCRIPTIONS_TABLE = "MeetingAgentSubscriptions";
const PROCESSED_TABLE = "MeetingAgentProcessed";
const PENDING_TABLE = "MeetingAgentPending";

export async function getSubscriptionRecord(
  userId: string
): Promise<SubscriptionRecord | null> {
  const client = await getTableClient(SUBSCRIPTIONS_TABLE);
  try {
    const entity = await client.getEntity<{ subscriptionId: string; expirationDateTime: string }>(
      "subscription",
      userId
    );
    return {
      userId,
      subscriptionId: entity.subscriptionId,
      expirationDateTime: entity.expirationDateTime,
    };
  } catch (err: any) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

export async function putSubscriptionRecord(record: SubscriptionRecord): Promise<void> {
  const client = await getTableClient(SUBSCRIPTIONS_TABLE);
  await client.upsertEntity(
    {
      partitionKey: "subscription",
      rowKey: record.userId,
      subscriptionId: record.subscriptionId,
      expirationDateTime: record.expirationDateTime,
    },
    "Replace"
  );
}

/**
 * Guards against the same meeting being published/issued twice — the webhook
 * path and the polling fallback can both observe the same finished meeting,
 * and the queue trigger retries on transient failure without re-running work
 * that already succeeded.
 */
// Longer than the function timeout (host.json: 10 min), so a claim older than
// this belongs to an invocation that died without releasing it.
const CLAIM_STALE_MS = 12 * 60_000;

export type ClaimResult =
  | { status: "claimed"; etag: string } // we own it: publish, then markProcessed (or releaseClaim on failure)
  | { status: "done" } // already published
  | { status: "in-progress" }; // another invocation is publishing it right now

/**
 * Atomically claims a transcript before anything is published. Creating the row
 * fails with 409 if it already exists, so of two concurrent copies of the same
 * job (Graph delivering a notification twice) exactly one gets to publish —
 * the other can't race it into a GitHub write conflict or duplicate issues.
 *
 * Rows from before claims existed have `processedAt` and no `state`; they count
 * as done. A claim stuck past CLAIM_STALE_MS (the owner crashed) can be taken over.
 */
export async function claimTranscript(
  userId: string,
  meetingId: string,
  transcriptId: string
): Promise<ClaimResult> {
  const client = await getTableClient(PROCESSED_TABLE);
  const rowKey = `${meetingId}_${transcriptId}`;

  // Two passes: the row can vanish between our 409 and our read if its owner
  // released it, in which case we just try to create it again.
  for (let attempt = 0; attempt < 2; attempt++) {
    const claimedAt = new Date().toISOString();
    try {
      const created = await client.createEntity({
        partitionKey: userId,
        rowKey,
        state: "claimed",
        claimedAt,
      });
      return { status: "claimed", etag: created.etag! };
    } catch (err: any) {
      if (err.statusCode !== 409) throw err;
    }

    let entity;
    try {
      entity = await client.getEntity<{ state?: string; claimedAt?: string }>(userId, rowKey);
    } catch (err: any) {
      if (err.statusCode === 404) continue; // released in the meantime
      throw err;
    }

    if (entity.state !== "claimed") return { status: "done" };

    const ageMs = Date.now() - new Date(entity.claimedAt ?? 0).getTime();
    if (ageMs < CLAIM_STALE_MS) return { status: "in-progress" };

    // Stale: take it over, but only if nobody touched it since we read it.
    try {
      const taken = await client.updateEntity(
        { partitionKey: userId, rowKey, state: "claimed", claimedAt },
        "Replace",
        { etag: entity.etag }
      );
      return { status: "claimed", etag: taken.etag! };
    } catch (err: any) {
      if (err.statusCode === 412 || err.statusCode === 404) return { status: "in-progress" };
      throw err;
    }
  }
  return { status: "in-progress" };
}

/** Marks the claimed transcript as published. */
export async function markProcessed(
  userId: string,
  meetingId: string,
  transcriptId: string
): Promise<void> {
  const client = await getTableClient(PROCESSED_TABLE);
  await client.upsertEntity(
    {
      partitionKey: userId,
      rowKey: `${meetingId}_${transcriptId}`,
      state: "done",
      processedAt: new Date().toISOString(),
    },
    "Replace"
  );
}

/**
 * Gives a claim back after a failure so the queue's retry can take it right
 * away instead of finding it "in progress". Uses the claim's etag so it can
 * never delete a claim someone else has since taken over.
 */
export async function releaseClaim(
  userId: string,
  meetingId: string,
  transcriptId: string,
  etag: string
): Promise<void> {
  const client = await getTableClient(PROCESSED_TABLE);
  try {
    await client.deleteEntity(userId, `${meetingId}_${transcriptId}`, { etag });
  } catch (err: any) {
    if (err.statusCode !== 404 && err.statusCode !== 412) throw err;
  }
}

/**
 * Tracks a meeting that has ended but whose transcript wasn't ready yet, so
 * pollTimer can keep re-checking it on every subsequent run regardless of
 * whether it's still inside the calendar lookback window (a meeting running
 * long enough to miss that window would otherwise never be revisited).
 */
export interface PendingTranscriptRecord {
  userId: string;
  onlineMeetingId: string;
  meetingSubject: string;
  meetingStartIso: string;
  firstSeenAt: string;
}

export async function getPendingRecord(
  onlineMeetingId: string
): Promise<PendingTranscriptRecord | null> {
  const client = await getTableClient(PENDING_TABLE);
  try {
    const entity = await client.getEntity<{
      userId: string;
      meetingSubject: string;
      meetingStartIso: string;
      firstSeenAt: string;
    }>("pending", onlineMeetingId);
    return {
      userId: entity.userId,
      onlineMeetingId,
      meetingSubject: entity.meetingSubject,
      meetingStartIso: entity.meetingStartIso,
      firstSeenAt: entity.firstSeenAt,
    };
  } catch (err: any) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

export async function putPendingRecord(record: PendingTranscriptRecord): Promise<void> {
  const client = await getTableClient(PENDING_TABLE);
  await client.upsertEntity(
    {
      partitionKey: "pending",
      rowKey: record.onlineMeetingId,
      userId: record.userId,
      meetingSubject: record.meetingSubject,
      meetingStartIso: record.meetingStartIso,
      firstSeenAt: record.firstSeenAt,
    },
    "Replace"
  );
}

export async function deletePendingRecord(onlineMeetingId: string): Promise<void> {
  const client = await getTableClient(PENDING_TABLE);
  try {
    await client.deleteEntity("pending", onlineMeetingId);
  } catch (err: any) {
    if (err.statusCode !== 404) throw err;
  }
}

export async function listPendingRecords(): Promise<PendingTranscriptRecord[]> {
  const client = await getTableClient(PENDING_TABLE);
  const records: PendingTranscriptRecord[] = [];
  for await (const entity of client.listEntities<{
    userId: string;
    meetingSubject: string;
    meetingStartIso: string;
    firstSeenAt: string;
  }>({ queryOptions: { filter: `PartitionKey eq 'pending'` } })) {
    records.push({
      userId: entity.userId,
      onlineMeetingId: entity.rowKey!,
      meetingSubject: entity.meetingSubject,
      meetingStartIso: entity.meetingStartIso,
      firstSeenAt: entity.firstSeenAt,
    });
  }
  return records;
}
