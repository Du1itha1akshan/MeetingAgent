# Meeting Agent

Emails a summary of each JRC Software meeting, written by Claude from the
meeting's Fireflies.ai transcript, to the JRC staff who attended. The email's
**View Details** button opens a page with the summary, action items and
transcript.

## How it works

1. Fireflies.ai records and transcribes the meeting, exports the transcript to
   OneDrive (`meetingassistant@jrcsoftware.com`, folder *Fireflies Transcripts*)
   and sends a webhook.
2. The Logic App `meetingagent-logic-app` finds the transcript, asks Claude for a
   summary and action items, saves the meeting to blob storage as
   `meetings/<meeting_id>.json`, emails the meeting's JRC participants and moves
   the transcript to *Processed Transcripts*.
3. The email's **View Details** link, `/meeting/<meeting_id>/<hash>`, opens the
   Static Web App. Its API checks that the hash is SHA-256(meeting ID +
   `meeting-link-secret`) and returns the saved meeting: the title and transcript
   from Fireflies, and Claude's summary with the action items split out.

The Logic App is edited and published in the Azure portal; its definition isn't
kept in this repo.

## Azure resources

All in resource group `dev-jrc-meeting-agent-rg-aue`:

| Resource | Purpose |
|---|---|
| `meetingagent-logic-app` | The workflow above |
| `meetingagent-kv` | Secrets the Logic App reads: `fireflies-api-key`, `anthropic-api-key`, `github-access-token`, `meeting-link-secret` |
| `meetingagentstor`, container `meetings` | One JSON file per meeting: written by the Logic App with its managed identity, read by the site's API |
| `meetingagentstor`, container `meeting-status` | One JSON file per meeting with the action item statuses people have changed and the time of each task's last follow-up email, written by the site's API |
| `meetingagent-followup-logic-app` | Sends follow-up emails when someone clicks Follow up on a task (Consumption, Australia East, built in the portal) |
| `meetingagent-web` | Static Web App for the meeting details page (Free plan, East Asia) |

The Logic App's managed identity has **Storage Blob Data Contributor** on the
`meetings` container. On the Free plan the site's API can't use a managed
identity, so it uses shared access signatures instead:

- `MEETINGS_READ_SAS`: read-only, `meetings` container
- `MEETING_STATUS_SAS`: read and write, `meeting-status` container only, so it
  can't change or remove the meetings themselves

Both expire after a year; run the deploy script again before then to renew them.

**Action item statuses.** Changing a status on the page saves it straight away.
The status file holds only items someone has changed
(`{ "items": [ { "index", "task", "status" } ], "updatedAt" }`); any other item
shows as Open. An entry applies only while both its row number and task text
still match the meeting. Anyone with a meeting's link can change its statuses,
and who changed them isn't recorded.

**Follow-up emails.** Clicking Follow up on a task (disabled for Done tasks and
tasks with no owner) calls `POST /api/meetings/{id}/action-items/{index}/follow-up`.
The page only says which task; the API builds the subject and body itself (task,
due date and Overdue in Sri Lanka time, status, meeting, View Details button) and
calls `meetingagent-followup-logic-app` at `FOLLOWUP_TRIGGER_URL` with
`{ ownerName, subject, html }`. The Logic App:

1. *Follow_up_request* (HTTP, POST, schema validation on) receives the request.
2. *Search_by_full_name* (Office 365 Users, Search for users (V2)) and the
   *JRC_full_name_matches* filter keep people whose display name is exactly the
   owner's name and whose email ends in `@jrcsoftware.com`.
3. If that isn't exactly one person, it does the same by first name
   (*Search_by_first_name*, *JRC_first_name_matches*, matching `givenName`).
4. If one person was found, *Send an email (V2)* sends from
   meetingassistant@jrcsoftware.com and it answers 200; otherwise it answers 404
   and nothing is sent. If a search or the send fails, no response runs and the
   API gets an error.

The API records the time (`followUps` in the status file) only when the Logic
App answers 200; the page shows it as "Last follow-up" under the button, and
hides it until a follow-up has been sent. Anyone with the meeting's link can send
follow-ups. Each email costs about AUD 0.0004–0.0006 (Office 365 connector
actions); the other steps are built-in and free.

## Set up

1. Create and publish `meetingagent-followup-logic-app` (steps above) in
   Australia East, using the existing `office365` connection and an Office 365
   Users connection signed in as meetingassistant@jrcsoftware.com. The deploy
   script stops if it or its `Follow_up_request` trigger is missing.

   Then create the Static Web App, the `meetings` and `meeting-status` containers
   and the site's settings.
   The script prints the site's address and checks whether the Logic App can
   write to the container.

   ```powershell
   ./scripts/deploy-staticwebapp.ps1
   ```

2. If the script says the Logic App can't save meetings yet, someone with Owner
   or User Access Administrator on the resource group runs the
   `az role assignment create` command it prints. This is needed once; the role
   can take a few minutes to take effect.

3. Deploy the page and its API with the Static Web Apps CLI
   (`npm install -g @azure/static-web-apps-cli`). The deployment token is in the
   portal under *Overview > Manage deployment token*. Without `--env production`
   the CLI deploys to a preview environment instead of the live site.

   ```powershell
   Push-Location api; npm install --omit=dev; Pop-Location
   swa deploy ./web --api-location ./api --env production --deployment-token <token>
   ```

4. In the Logic App, the step *Save meeting details* saves each meeting before
   the email is sent, signing in with the Logic App's managed identity, and the
   parameter `view_details_base_url` is `https://<site address>/meeting/`.

To run the page and API locally, put `FUNCTIONS_WORKER_RUNTIME` (`node`),
`MEETING_LINK_SECRET`, `MEETINGS_CONTAINER_URL`, `MEETINGS_READ_SAS`,
`MEETING_STATUS_CONTAINER_URL`, `MEETING_STATUS_SAS`, `FOLLOWUP_TRIGGER_URL` and
`VIEW_DETAILS_BASE_URL` in `api/local.settings.json` (ignored by git) and run
`swa start ./web --api-location ./api`. Without the two status settings the
page still loads, but every item shows as Open and saving fails; without
`FOLLOWUP_TRIGGER_URL`, Follow up fails. A local session uses the real
containers and Logic App, so follow-ups sent from it are real emails.

## Repo layout

```
api/
  src/meeting.js             checks the link, reads the saved meeting, splits Claude's summary,
                             reads and saves action item statuses, sends follow-ups
  src/functions/meetings.js  GET  /api/meetings/{id}
                             PUT  /api/meetings/{id}/action-items/{index}/status
                             POST /api/meetings/{id}/action-items/{index}/follow-up
infra/
  staticwebapp.bicep         the Static Web App, both containers and site settings
scripts/
  deploy-staticwebapp.ps1    deploys infra/staticwebapp.bicep
web/
  index.html, styles.css     the meeting details page
  app.js                     loads the meeting from the API, renders it and saves status changes
  staticwebapp.config.json   API runtime, and serves the page at /meeting/<meeting_id>/<hash>
meetings/                    notes published by earlier versions of the agent (no longer updated)
```
