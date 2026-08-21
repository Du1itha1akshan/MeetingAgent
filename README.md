# Meeting Agent

Joins scheduled Microsoft Teams meetings' data pipeline (via Microsoft
Graph), transcribes them, extracts action items, generates a summary, and
publishes all three to a GitHub repository as Markdown — with a GitHub
Issue per action item. Runs as an Azure Functions app: after one-time setup,
nothing needs a person to keep it running.

## What this actually does (read before deploying)

This uses **Microsoft Teams' built-in transcription + Graph API
`callTranscript`**, not a bot that visually joins the call as a participant:

1. A timer trigger keeps a Graph change-notification subscription alive for
   each monitored user's calendar (create/renew every 5 minutes).
2. When a meeting's transcript becomes available, an HTTP trigger receives
   the notification in real time (plus the timer trigger sweeps for
   anything missed).
3. Both paths enqueue the meeting; a queue trigger does the actual work —
   fetch the WebVTT transcript, parse it into speaker-labeled segments, send
   it to Claude for a structured summary + action items, and publish
   `transcript.md`, `summary.md`, `action-items.md` plus one GitHub Issue
   per action item.

**This covers meetings your org hosts/organizes.** It does **not** cover
meetings hosted by an external organization where you're a guest — see
`docs/EXTERNAL_MEETINGS.md` for what covering that would take (a
Compliance Recording Bot — a meaningfully different, larger build).

## Setup

See `docs/SETUP.md` for the full one-time walkthrough:

1. `./scripts/provision-entra-app.ps1` — Entra ID app + Graph permissions
2. `./scripts/setup-teams-policy.ps1` — tenant transcript access + auto-recording
3. Create a GitHub App (the one step with no bootstrap API — see docs/SETUP.md)
4. `./scripts/deploy.ps1` — provisions Azure infra and publishes the code

After that, `docs/AUTOMATION.md` explains exactly what runs unattended and
how failures are handled without a person watching.

## Local development

```bash
npm install
cp local.settings.json.example local.settings.json   # fill in real values
npm run build
npm start   # func start
```

## Project layout

```
infra/
  main.bicep                 Key Vault, Storage, App Insights, Function App
scripts/
  provision-entra-app.ps1    one-time Entra ID app + Graph permissions
  setup-teams-policy.ps1     one-time Teams tenant policy
  deploy.ps1                 az deployment + function publish
src/
  config.ts                  env vars + Key Vault secrets
  state/
    tableStore.ts            subscription state + processed-meeting idempotency
    queueStore.ts            hands work from HTTP/timer triggers to the queue trigger
  graph/
    auth.ts                  MSAL app-only auth + graphFetch helper
    calendar.ts              discover scheduled Teams meetings
    subscriptions.ts         create/renew Graph change-notification subscriptions
    transcripts.ts           list/fetch transcript content (WebVTT)
  processing/
    transcriptParser.ts      WebVTT -> structured speaker segments
    summarizer.ts            Claude-based summary + action item extraction
  github/
    publisher.ts             GitHub App auth; writes markdown + opens issues
  functions/
    graphWebhook.ts          HTTP trigger: Graph notification -> queue
    pollTimer.ts             Timer trigger: subscription renewal + calendar sweep -> queue
    processTranscriptQueue.ts  Queue trigger: fetch -> parse -> summarize -> publish
  pipeline.ts                shared orchestration + idempotency check
```

## Output example

For a meeting titled "Sprint Planning" on 2026-08-20, this writes to your
repo under `meetings/2026-08-20-sprint-planning/`:

- `transcript.md` — full speaker-labeled transcript
- `summary.md` — overview, key points, decisions, open questions
- `action-items.md` — table of owner / description / due date

...plus one GitHub Issue per action item (toggle with
`CREATE_ISSUES_FOR_ACTION_ITEMS`).

## Security & compliance notes

- Transcripts contain everything said in a meeting, including by external
  participants. Treat the GitHub repo as sensitive — private repo, access
  control, and check your org's recording/consent policy before enabling
  this broadly.
- Teams requires that participants be shown a transcription/recording
  indicator; this is a platform behavior, not something this code controls,
  but confirm it's active in the meetings you're monitoring.
- Secrets (Entra client secret, Anthropic key, GitHub App private key,
  webhook `clientState`) live in Key Vault, referenced by the Function App's
  managed identity — never in plaintext app settings or source control.
- The Entra ID client secret still expires (2 years, per
  `provision-entra-app.ps1`) — Microsoft doesn't offer non-expiring app
  secrets. Everything else (GitHub auth, Graph subscriptions) renews itself.
