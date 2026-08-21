# Covering Meetings Hosted by External Organizations

The pipeline in this repo relies on Microsoft Graph's `callTranscript` API,
which is scoped to meetings **your tenant organizes**. If a monitored user
is a guest in a meeting hosted by another company's Teams tenant, your
app's Graph permissions don't reach that meeting's transcript — you have no
admin relationship with the host tenant.

To genuinely follow a user into *any* Teams call regardless of who's
hosting, you need a different mechanism: a **Teams Compliance Recording
Bot**. Unlike this repo's approach, it doesn't ask Teams for a transcript
after the fact — it gets invited into the call itself as a participant and
receives the raw media stream directly.

## How it differs architecturally

| | This repo (Graph transcript API) | Compliance Recording Bot |
|---|---|---|
| Trigger | Meeting scheduled in your tenant | Policy assigned to a *user* |
| Works for external-hosted meetings | No | Yes — rides along with the user |
| Requires | Graph app permissions + tenant toggle | Azure Bot + Graph Communications Bot Media SDK (.NET) |
| Gets | Finished transcript (VTT) after the fact | Raw audio stream in real time |
| Transcription | Teams' own | You run your own STT (e.g. Azure Speech) |
| Build complexity | Low — HTTP calls | High — media SDK, certs, low-latency stream handling |

## What building it involves

1. Register an Azure Bot + Graph Communications application; get org
   admin consent for `Calls.AccessMedia.All`, `Calls.JoinGroupCall.All`.
2. Create a `CsTeamsComplianceRecordingPolicy`, register the bot as its
   `ComplianceRecordingApplication`, then `Grant-CsTeamsComplianceRecordingPolicy`
   to each user you want covered. From then on, Teams automatically invites
   the bot into every call/meeting that user joins — internal or external.
3. Use the **Graph Communications Bot Media SDK** (.NET only) to receive
   raw audio frames per participant.
4. Pipe audio to a streaming STT service (Azure Speech Services is the
   natural fit — supports diarization).
5. Feed the resulting transcript into the same `processing/summarizer.ts`
   and `github/publisher.ts` modules from this repo — those two pieces are
   reusable regardless of how the transcript was produced.
6. Display the mandatory recording/consent banner — required by the
   platform whenever a compliance recording bot is active, and worth a
   legal review given some jurisdictions require two-party consent for
   recording, which matters when external participants are on the call.

Starting point: Microsoft's own sample —
`microsoft-graph-comms-samples/Samples/V1.0Samples/LocalMediaSamples/PolicyRecordingBot`
on GitHub. It scaffolds the call-join and media-receipt plumbing; the
actual recording/transcription logic is intentionally left for you to
implement, same as the STT + summarization steps above.

This is a meaningfully larger build (real-time media infra, not just REST
calls) — worth scoping as its own project phase once the transcript-API
pipeline in this repo is validated end-to-end on internal meetings.
