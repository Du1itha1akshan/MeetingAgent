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
export async function isAlreadyProcessed(
  userId: string,
  meetingId: string,
  transcriptId: string
): Promise<boolean> {
  const client = await getTableClient(PROCESSED_TABLE);
  try {
    await client.getEntity(userId, `${meetingId}_${transcriptId}`);
    return true;
  } catch (err: any) {
    if (err.statusCode === 404) return false;
    throw err;
  }
}

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
      processedAt: new Date().toISOString(),
    },
    "Replace"
  );
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
