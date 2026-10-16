import { SecretClient } from "@azure/keyvault-secrets";
import { getConfig, createVaultCredential } from "../config";

/**
 * A *delegated* Graph token for the JRC Meeting Assistant user, used only to post
 * chat messages as the assistant (src/graph/chat.ts).
 *
 * This is deliberately separate from graph/auth.ts. That file gets an app-only
 * token (client_credentials, `roles`) for everything the pipeline reads. Graph
 * refuses to send a chat message with an app-only token ("only for import
 * purposes"), so the message has to come from a signed-in user: this file signs in
 * as the assistant (`scp`) against the same token endpoint.
 *
 * Sign-in order, all non-interactive:
 *   1. the refresh token saved in Key Vault (secret ASSISTANT_REFRESH_SECRET);
 *   2. if there is none, or Microsoft rejects it, the password in Key Vault
 *      (secret ASSISTANT_PASSWORD_SECRET) with the password grant (ROPC). That
 *      only works for an account without MFA / conditional-access prompts.
 * Every successful sign-in returns a new refresh token, which is written back to
 * Key Vault. The access token (about an hour) is only kept in memory.
 *
 * Seeding (once): create both secrets in the vault; the refresh-token secret can
 * hold any placeholder until the first password sign-in replaces it. The Function
 * App's managed identity needs "Key Vault Secrets User" (already has it, vault-wide)
 * to read them and "Key Vault Secrets Officer" on the refresh-token secret to save
 * the new refresh token.
 */
export const ASSISTANT_REFRESH_SECRET = "assistant-refresh-token";
export const ASSISTANT_PASSWORD_SECRET = "assistant-password";

const EXPIRY_MARGIN_MS = 5 * 60_000;
// After a failed sign-in, don't try again for this long. A wrong password retried
// every poll (5 min) would lock the assistant's account for everything else.
const FAILURE_PAUSE_MS = 30 * 60_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** A failed token request. Carries only Microsoft's error code and AADSTS text; never credentials. */
export class AssistantAuthError extends Error {
  constructor(message: string, readonly oauthError?: string) {
    super(message);
    this.name = "AssistantAuthError";
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;
let pausedUntil = 0;
let secretClient: SecretClient | null = null;

function getVault(): SecretClient {
  const vaultUri = process.env.KEY_VAULT_URI;
  if (!vaultUri) throw new AssistantAuthError("KEY_VAULT_URI is not set; cannot read the assistant's credentials");
  return (secretClient ??= new SecretClient(vaultUri, createVaultCredential()));
}

async function readSecret(name: string): Promise<string | undefined> {
  try {
    const secret = await getVault().getSecret(name);
    return secret.value || undefined;
  } catch (err: any) {
    if (err?.statusCode === 404) return undefined; // not created yet
    throw err;
  }
}

async function requestToken(grant: Record<string, string>): Promise<TokenResponse> {
  const config = await getConfig();
  const body = new URLSearchParams({
    client_id: config.azure.clientId,
    client_secret: config.azure.clientSecret,
    scope: config.assistant.scope,
    ...grant,
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
  );

  if (!res.ok) {
    // Report only the OAuth error code and the first line of Microsoft's description
    // (it starts with the AADSTS code). Never the request, which holds the secrets.
    const err = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
    const firstLine = (err.error_description ?? "").split(/\r?\n/)[0].slice(0, 200);
    throw new AssistantAuthError(
      `Assistant sign-in (${grant.grant_type}) failed: HTTP ${res.status} ${err.error ?? ""} ${firstLine}`.trim(),
      err.error
    );
  }
  return (await res.json()) as TokenResponse;
}

async function signIn(): Promise<TokenResponse> {
  const config = await getConfig();

  const refreshToken = await readSecret(ASSISTANT_REFRESH_SECRET);
  if (refreshToken) {
    try {
      return await requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
    } catch (err) {
      // Only a rejected token (revoked, expired, placeholder) falls through to the
      // password; a network or server error shouldn't trigger a password attempt.
      if (!(err instanceof AssistantAuthError) || err.oauthError !== "invalid_grant") throw err;
      console.warn(`[assistant-auth] saved refresh token was rejected; signing in with the password. ${err.message}`);
    }
  }

  if (!config.assistant.username) {
    throw new AssistantAuthError("ASSISTANT_USERNAME is not set; cannot sign in as the assistant");
  }
  const password = await readSecret(ASSISTANT_PASSWORD_SECRET);
  if (!password) {
    throw new AssistantAuthError(`Key Vault secret "${ASSISTANT_PASSWORD_SECRET}" is missing; cannot sign in as the assistant`);
  }
  return requestToken({ grant_type: "password", username: config.assistant.username, password });
}

async function acquire(): Promise<string> {
  const tokens = await signIn();

  // Keep the newest refresh token. If saving fails (e.g. the identity lacks write
  // access to the secret) the access token we just got is still good, so don't fail
  // the post over it; the next sign-in just falls back to the password again.
  if (tokens.refresh_token) {
    try {
      await getVault().setSecret(ASSISTANT_REFRESH_SECRET, tokens.refresh_token);
    } catch (err: any) {
      console.warn(`[assistant-auth] could not save the new refresh token to Key Vault: ${err?.message ?? err}`);
    }
  }

  cachedToken = { value: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  return tokens.access_token;
}

/** An access token for the assistant, signing in (and refreshing the saved token) only when needed. */
export async function getAssistantAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - EXPIRY_MARGIN_MS > now) return cachedToken.value;

  if (now < pausedUntil) {
    throw new AssistantAuthError(
      `Assistant sign-in is paused until ${new Date(pausedUntil).toISOString()} after an earlier failure`
    );
  }

  // Concurrent callers share one sign-in instead of each using (and rotating) the token.
  inFlight ??= acquire()
    .catch((err) => {
      pausedUntil = Date.now() + FAILURE_PAUSE_MS;
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
