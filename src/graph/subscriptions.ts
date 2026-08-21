import { graphFetch } from "./auth";
import { getConfig } from "../config";
import { getSubscriptionRecord, putSubscriptionRecord } from "../state/tableStore";

/**
 * Subscribes to transcript-created notifications for a user's online meetings.
 * Tenant-wide app permissions let you subscribe once per user and get
 * notified whenever any of their meetings produces a transcript.
 *
 * Graph subscriptions expire (max ~60 min for this resource type in most
 * tenants). Since Functions are stateless between invocations, subscription
 * state lives in Table Storage and pollTimer.ts calls ensureSubscriptions()
 * on every run to renew or recreate anything close to expiring — there is no
 * long-lived process to run a setInterval in.
 */
const MAX_EXPIRATION_MINUTES = 55;
const RENEW_IF_EXPIRING_WITHIN_MINUTES = 15;

async function createTranscriptSubscription(userId: string): Promise<{
  id: string;
  expirationDateTime: string;
}> {
  const config = await getConfig();
  const expirationDateTime = new Date(
    Date.now() + MAX_EXPIRATION_MINUTES * 60_000
  ).toISOString();

  const resource = `/users/${userId}/onlineMeetings/getAllTranscripts`;

  const sub = await graphFetch<{
    id: string;
    resource: string;
    expirationDateTime: string;
  }>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: config.webhook.notificationUrl,
      resource,
      expirationDateTime,
      clientState: config.webhook.clientState,
      latestSupportedTlsVersion: "v1_2",
    }),
  });

  return { id: sub.id, expirationDateTime: sub.expirationDateTime };
}

async function renewSubscription(subscriptionId: string): Promise<string> {
  const expirationDateTime = new Date(
    Date.now() + MAX_EXPIRATION_MINUTES * 60_000
  ).toISOString();

  await graphFetch(`/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify({ expirationDateTime }),
  });
  return expirationDateTime;
}

/**
 * Called on every pollTimer.ts run for each monitored user: creates a
 * subscription if none exists, renews one that's close to expiring, or
 * recreates it if Graph reports it's already gone (e.g. it lapsed between
 * timer runs). Idempotent and safe to call on a schedule indefinitely.
 */
export async function ensureSubscription(userId: string): Promise<void> {
  const existing = await getSubscriptionRecord(userId);

  if (!existing) {
    const created = await createTranscriptSubscription(userId);
    await putSubscriptionRecord({
      userId,
      subscriptionId: created.id,
      expirationDateTime: created.expirationDateTime,
    });
    console.log(`[subscriptions] created for ${userId}: ${created.id}`);
    return;
  }

  const expiresInMs = new Date(existing.expirationDateTime).getTime() - Date.now();
  if (expiresInMs > RENEW_IF_EXPIRING_WITHIN_MINUTES * 60_000) {
    return; // still comfortably valid
  }

  try {
    const expirationDateTime = await renewSubscription(existing.subscriptionId);
    await putSubscriptionRecord({ ...existing, expirationDateTime });
    console.log(`[subscriptions] renewed ${userId}: ${existing.subscriptionId}`);
  } catch (err) {
    console.warn(
      `[subscriptions] renewal failed for ${userId}, recreating:`,
      err
    );
    const created = await createTranscriptSubscription(userId);
    await putSubscriptionRecord({
      userId,
      subscriptionId: created.id,
      expirationDateTime: created.expirationDateTime,
    });
  }
}

export async function ensureAllSubscriptions(userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    try {
      await ensureSubscription(userId);
    } catch (err) {
      console.error(`[subscriptions] failed for ${userId}:`, err);
    }
  }
}
