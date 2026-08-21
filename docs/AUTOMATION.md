# What "100% automated" means here, concretely

Every piece of ongoing operation — not just triggering — is handled without
a person, including the failure paths:

| Concern | How it's handled |
|---|---|
| Meeting detection | Real-time via Graph webhook; a 5-minute timer sweep as backup in case a notification is ever dropped (Graph doesn't guarantee delivery) |
| Subscription expiry | `pollTimer` checks and renews/recreates every 5 minutes — there's no long-running process to host a `setInterval`, so this replaces it |
| Duplicate processing | Webhook and poll can both observe the same meeting; `state/tableStore.ts` records `(userId, meetingId, transcriptId)` after a successful publish, so a repeat is a no-op, not a duplicate GitHub issue |
| Transient failures (Claude rate limit, GitHub 5xx, Graph blip) | The actual work runs in a **queue-triggered** function; Azure Functions retries automatically (`host.json`: 5 attempts) before parking the message in the poison queue for inspection — nothing is silently dropped |
| Secret rotation | GitHub auth uses an App installation token (auto-refreshed hourly, no expiry to manage). The Entra ID client secret is the one credential that still expires (Microsoft doesn't offer non-expiring app secrets) — 2-year expiry set by `provision-entra-app.ps1`, worth a calendar reminder or a future move to certificate-based auth |
| Observability | Application Insights is wired in from `infra/main.bicep`; every `console.log`/`context.log` in the functions lands there automatically — set up an alert rule on Function failures if you want to be paged rather than having to go look |

## What still needs a human, and why that's fine

Three things, each **once**, each because it's an identity/trust boundary
Microsoft or GitHub deliberately puts in front of a person:

1. Admin consent for the Graph app permissions (Global Admin action)
2. Enabling the Teams transcript-access policy (Teams Admin action)
3. Creating the GitHub App itself (no bootstrap API exists for this)

None of these recur. Once granted, nothing about the pipeline's ongoing
operation depends on a person showing up again.
