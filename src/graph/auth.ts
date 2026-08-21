import { ConfidentialClientApplication } from "@azure/msal-node";
import { getConfig } from "../config";

/**
 * Required Graph application permissions (admin consent required):
 *   - OnlineMeetings.Read.All          (read meeting metadata)
 *   - OnlineMeetingTranscript.Read.All (read transcripts tenant-wide)
 *   - Calendars.Read                  (discover scheduled meetings)
 *
 * Provisioned by scripts/provision-entra-app.ps1. Teams also gates ALL Graph
 * transcript access behind a tenant-level toggle, EnableGraphTranscriptAccess,
 * independent of app permissions — see scripts/setup-teams-policy.ps1.
 */
let ccaPromise: Promise<ConfidentialClientApplication> | null = null;

async function getClientApp(): Promise<ConfidentialClientApplication> {
  if (!ccaPromise) {
    ccaPromise = getConfig().then(
      (config) =>
        new ConfidentialClientApplication({
          auth: {
            clientId: config.azure.clientId,
            authority: `https://login.microsoftonline.com/${config.azure.tenantId}`,
            clientSecret: config.azure.clientSecret,
          },
        })
    );
  }
  return ccaPromise;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getGraphToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.value;
  }

  const cca = await getClientApp();
  const result = await cca.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });

  if (!result?.accessToken) {
    throw new Error("Failed to acquire Graph app-only access token");
  }

  cachedToken = {
    value: result.accessToken,
    expiresAt: result.expiresOn ? result.expiresOn.getTime() : now + 3_000_000,
  };
  return cachedToken.value;
}

export async function graphFetch<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getGraphToken();
  const url = path.startsWith("http")
    ? path
    : `https://graph.microsoft.com/v1.0${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph API ${init.method ?? "GET"} ${url} failed: ${res.status} ${body}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  // Transcript content endpoint returns text/vtt, not JSON
  return (await res.text()) as unknown as T;
}
