import { graphFetch } from "./auth";
import { getConfig } from "../config";
import { getSubscriptionRecord, putSubscriptionRecord } from "../state/tableStore";

/**
 * One tenant-wide subscription: Graph notifies the webhook whenever a transcript
 * becomes available for ANY online meeting in the organization. Which meetings
 * matter (those involving a monitored user) is decided in graphWebhook.ts,
 * because Graph offers no attendee filter on this resource.
 *
 * Graph subscriptions expire (max ~60 min for this resource type in most
 * tenants). Since Functions are stateless between invocations, subscription
 * state lives in Table Storage and pollTimer.ts calls ensureTenantSubscription()
 * on every run to renew or recreate it — there is no long-lived process to run
 * a setInterval in.
 */
const MAX_EXPIRATION_MINUTES = 55;
const RENEW_IF_EXPIRING_WITHIN_MINUTES = 15;
const TENANT_KEY = "tenant"; // stored in the table's userId slot
const TENANT_RESOURCE = "/communications/onlineMeetings/getAllTranscripts";

async function createTenantSubscription(): Promise<{
  id: string;
  expirationDateTime: string;
}> {
  const config = await getConfig();
  const expirationDateTime = new Date(
    Date.now() + MAX_EXPIRATION_MINUTES * 60_000
  ).toISOString();

  const sub = await graphFetch<{
    id: string;
    resource: string;
    expirationDateTime: string;
  }>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: config.webhook.notificationUrl,
      resource: TENANT_RESOURCE,
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
 * Called on every pollTimer.ts run: creates the subscription if none exists,
 * renews it when close to expiring, or recreates it if Graph reports it's
 * already gone (e.g. it lapsed between timer runs). Idempotent and safe to
 * call on a schedule indefinitely.
 */
export async function ensureTenantSubscription(): Promise<void> {
  const existing = await getSubscriptionRecord(TENANT_KEY);

  if (!existing) {
    const created = await createTenantSubscription();
    await putSubscriptionRecord({
      userId: TENANT_KEY,
      subscriptionId: created.id,
      expirationDateTime: created.expirationDateTime,
    });
    console.log(`[subscriptions] created tenant-wide: ${created.id}`);
    return;
  }

  const expiresInMs = new Date(existing.expirationDateTime).getTime() - Date.now();
  if (expiresInMs > RENEW_IF_EXPIRING_WITHIN_MINUTES * 60_000) {
    return; // still comfortably valid
  }

  try {
    const expirationDateTime = await renewSubscription(existing.subscriptionId);
    await putSubscriptionRecord({ ...existing, expirationDateTime });
    console.log(`[subscriptions] renewed tenant-wide: ${existing.subscriptionId}`);
  } catch (err) {
    console.warn(`[subscriptions] renewal failed, recreating:`, err);
    const created = await createTenantSubscription();
    await putSubscriptionRecord({
      userId: TENANT_KEY,
      subscriptionId: created.id,
      expirationDateTime: created.expirationDateTime,
    });
  }
}
