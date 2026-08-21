# Setup Guide

Everything below is a **one-time** step. Once done, the agent runs
unattended — no server to babysit, no token to remember to rotate, no cron
job on someone's laptop.

## 1. Register the Entra ID app

Run instead of clicking through the Portal:

```powershell
az login
./scripts/provision-entra-app.ps1 -DisplayName "Meeting Agent"
```

This creates the app registration, adds the three Graph application
permissions (`Calendars.Read`, `OnlineMeetings.Read.All`,
`OnlineMeetingTranscript.Read.All`), creates a client secret, and attempts
admin consent. If the account running the script isn't a Global Admin /
Privileged Role Administrator, the script prints the one command (or portal
click) left for whoever is: **this click cannot be scripted away** — it's an
intentional Microsoft security gate, not a gap in this repo.

Keep the printed `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`
/ `GRAPH_CLIENT_STATE` — you'll pass them to `scripts/deploy.ps1`.

## 2. Enable tenant-wide Graph transcript access + auto-recording

```powershell
./scripts/setup-teams-policy.ps1 -MonitoredUsers "alice@contoso.com,bob@contoso.com"
```

Requires a Teams Administrator or Global Administrator role — same
reasoning as step 1, this is a tenant-admin action Microsoft doesn't expose
to an app's own permissions. By default this creates a **scoped** policy
(`-Scope ScopedPolicy`) applied only to the monitored users, rather than
flipping the switch tenant-wide; pass `-Scope Global` if you'd rather apply
it to everyone at once.

Skipping this step is the most common "why is everything a 403" cause —
check it before debugging app code.

## 3. Create a GitHub App

The one piece of this setup Microsoft's/GitHub's APIs genuinely can't do for
you: GitHub doesn't expose an API to create an App from scratch (there's no
credential yet to call an API with). This is a five-minute, once-ever click:

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.
2. Repository permissions: **Contents: Read and write**, **Issues: Read and
   write**.
3. No webhook needed — uncheck "Active" under Webhook.
4. Create the app, then **Generate a private key** — download the `.pem`.
5. **Install App** on the target repository (or your whole org). Note the
   installation ID from the URL:
   `github.com/settings/installations/<installation-id>`.

Unlike a personal access token, this installation never expires and never
needs manual rotation — `src/github/publisher.ts` mints a fresh ~1-hour
token from the App's private key on every run.

## 4. Deploy

```powershell
./scripts/deploy.ps1 `
  -ResourceGroup "meeting-agent-rg" -BaseName "meetingagent" `
  -AzureTenantId "<from step 1>" -AzureClientId "<from step 1>" `
  -AzureClientSecret (Read-Host -AsSecureString) `
  -GraphClientState (Read-Host -AsSecureString) `
  -AnthropicApiKey (Read-Host -AsSecureString) `
  -MonitoredUsers "alice@contoso.com,bob@contoso.com" `
  -GithubOwner "your-org" -GithubRepo "meeting-notes" `
  -GithubAppId "<from step 3>" -GithubAppInstallationId "<from step 3>" `
  -GithubAppPrivateKeyPath "./github-app-key.pem"
```

This provisions Key Vault, Storage, Application Insights, and a Linux
Consumption Function App (`infra/main.bicep`), wires the webhook URL back
into the app's own settings, and publishes the compiled code. From that
point on:

- The **timer trigger** (`pollTimer`, every 5 minutes) creates/renews the
  Graph subscription — there's no separate "start listening" step.
- The **HTTP trigger** (`graphWebhook`) receives real-time notifications the
  moment a transcript is ready.
- The **queue trigger** (`processTranscriptQueue`) does the actual
  fetch → summarize → publish work, with automatic retry on transient
  failures (see `docs/AUTOMATION.md`).

## 5. Local development

```powershell
npm install
cp local.settings.json.example local.settings.json   # fill in real values
npm run build
npm start   # func start — runs all three triggers locally
```

Locally, `AzureWebJobsStorage=UseDevelopmentStorage=true` uses
[Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)
for table/queue state, and secrets come straight from
`local.settings.json` rather than Key Vault (no `KEY_VAULT_URI` set → the
app falls back to plain env vars — see `src/config.ts`).

## Coverage limits (unchanged from before)

This still only reaches meetings your tenant organizes — a monitored user as
a guest in an externally-hosted meeting needs a different mechanism
entirely. See `docs/EXTERNAL_MEETINGS.md`.
