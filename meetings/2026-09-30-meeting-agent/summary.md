# Meeting Agent - Recording & Storage Discussion

**Date:** 2026-09-30T11:00:00.0000000

## Overview
The team had a brief meeting to discuss the setup and behavior of a meeting recording agent. The conversation centered on how the agent tracks user IDs within a meeting group and concerns about storage limitations affecting video upload after recording. The team noted that Office 365 storage had been reduced from 1TB to approximately 10GB, causing upload failures.

## Key Points
- The meeting agent does not need to join the call directly; it only needs to be inside the meeting group to track the particular user ID session.
- Recordings are typically uploaded to Office 365, but a recent storage limit reduction is causing upload failures.
- Storage was reduced from 1TB to approximately 10GB, meaning recorded videos may be saved locally on the machine but fail to upload.
- A previous call had already experienced this upload failure issue.

## Decisions
- The team decided to proceed and observe what happens with the recording upload given the current storage constraints.

## Open Questions
- Will the recording upload succeed given the reduced Office 365 storage limit (10GB), or will it fail as experienced in a prior call?
- Is there a plan to address the storage limitation to ensure future recordings can be uploaded successfully?
