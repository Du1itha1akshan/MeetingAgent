# Zoru Team Scrum

**Date:** 2026-10-06T04:30:00.0000000

## Overview
The Zoru team held their daily scrum standup where each team member shared their previous day's work, current tasks, and any blockers. Key topics included a pending staging release, an upgrade of the ElevenLabs voice integration to V4, ongoing bug fixes, and a discussion about QA tooling research. No major blockers were reported across the team.

## Key Points
- A staging release is pending clarifications from Lakshan (Bashika/DEV team) before it can be raised.
- Isuru upgraded the ElevenLabs integration to V4, which includes improved human-like voice with emotions and expressions; a PR is raised with a couple of changes remaining before it can be merged to staging for testing.
- Two bugs remain on the voice integration: one related to language, and one where the conversation does not translate to the customer's language mid-conversation.
- Lakshan worked on issue #1384 (app to reject account deletion) and is continuing implementation; Usanka noted the ticket is not close to completion yet.
- Himeth completed an Alert deep-link ticket for the mobile application and submitted a PR; today focusing on QA-raised bugs.
- Chanuka (QA) is finishing remaining test scenarios for ticket #386 (analytics dashboard) and closing bugs on the support module.
- Chanuka researched QA tooling for end-to-end automation, test case management, and QA planning; a suitable tool has not yet been identified.
- Heshan tested ticket #1081 and is currently testing ticket #1350.
- Savindi closed issue #236 and started working on issue #1020 (customer inquiry and business inquiry submissions).
- Hasindu started working on ticket #1116 (client discount retention).
- Sameera fixed assigned bugs yesterday and is continuing with more bug fixes today.
- Kaveendra completed work related to the support module and is continuing with additional tasks today.
- Binura is continuing ongoing work with no blockers.
- Hansani is continuing with bug fixing and implementation work.

## Decisions
- A small testing session for voice incoming and outgoing calls should be planned once the PR for the ElevenLabs V4 integration is merged to staging.

## Open Questions
- Which QA tool will be selected for end-to-end automation and test case management?
- Is the mid-conversation language translation bug a valid issue or expected behavior?
- When will the staging release be raised once clarifications are provided?
