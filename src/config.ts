import * as dotenv from "dotenv";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

dotenv.config();

export interface AppConfig {
  azure: { tenantId: string; clientId: string; clientSecret: string };
  monitoredUsers: string[];
  webhook: { clientState: string; notificationUrl: string };
  claude: { apiKey: string; model: string };
  github: {
    owner: string;
    repo: string;
    branch: string;
    basePath: string;
    createIssuesForActionItems: boolean;
    appId: string;
    appPrivateKey: string;
    installationId: string;
  };
  poll: { lookbackMinutes: number };
  storage: { connectionString: string };
}

/**
 * Secrets come from Key Vault in Azure (KEY_VAULT_URI set by infra/main.bicep) and
 * from .env locally. Non-secret settings (tenant/app IDs, monitored users, GitHub
 * repo coordinates) are plain app settings either way — no reason to round-trip
 * those through Key Vault too.
 */
let cached: Promise<AppConfig> | null = null;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function loadSecrets(): Promise<Record<string, string>> {
  const vaultUri = process.env.KEY_VAULT_URI;
  if (!vaultUri) return {};

  const credential = new DefaultAzureCredential();
  const client = new SecretClient(vaultUri, credential);

  const names = [
    "azure-client-secret",
    "anthropic-api-key",
    "graph-client-state",
    "github-app-private-key",
  ];

  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const secret = await client.getSecret(name);
        return [name, secret.value ?? ""] as const;
      } catch (err) {
        console.error(`[config] failed to read Key Vault secret "${name}":`, err);
        return [name, ""] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

async function buildConfig(): Promise<AppConfig> {
  const secrets = await loadSecrets();

  const clientSecret = secrets["azure-client-secret"] || process.env.AZURE_CLIENT_SECRET;
  const anthropicKey = secrets["anthropic-api-key"] || process.env.ANTHROPIC_API_KEY;
  const clientState = secrets["graph-client-state"] || process.env.GRAPH_CLIENT_STATE;
  const githubPrivateKey =
    secrets["github-app-private-key"] || process.env.GITHUB_APP_PRIVATE_KEY;

  if (!clientSecret) throw new Error("Missing AZURE_CLIENT_SECRET (env or Key Vault)");
  if (!anthropicKey) throw new Error("Missing ANTHROPIC_API_KEY (env or Key Vault)");
  if (!clientState) throw new Error("Missing GRAPH_CLIENT_STATE (env or Key Vault)");
  if (!githubPrivateKey) throw new Error("Missing GITHUB_APP_PRIVATE_KEY (env or Key Vault)");

  return {
    azure: {
      tenantId: required("AZURE_TENANT_ID"),
      clientId: required("AZURE_CLIENT_ID"),
      clientSecret,
    },
    monitoredUsers: required("MONITORED_USERS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    webhook: { clientState, notificationUrl: required("NOTIFICATION_URL") },
    claude: {
      apiKey: anthropicKey,
      model: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6",
    },
    github: {
      owner: required("GITHUB_OWNER"),
      repo: required("GITHUB_REPO"),
      branch: process.env.GITHUB_BRANCH ?? "main",
      basePath: process.env.GITHUB_BASE_PATH ?? "meetings",
      createIssuesForActionItems:
        (process.env.CREATE_ISSUES_FOR_ACTION_ITEMS ?? "true") === "true",
      appId: required("GITHUB_APP_ID"),
      appPrivateKey: githubPrivateKey.replace(/\\n/g, "\n"),
      installationId: required("GITHUB_APP_INSTALLATION_ID"),
    },
    poll: { lookbackMinutes: Number(process.env.POLL_LOOKBACK_MINUTES ?? 20) },
    storage: { connectionString: required("AzureWebJobsStorage") },
  };
}

export function getConfig(): Promise<AppConfig> {
  if (!cached) cached = buildConfig();
  return cached;
}
