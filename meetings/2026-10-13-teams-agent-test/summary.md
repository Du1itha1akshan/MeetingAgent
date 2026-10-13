# Claude Code: 27 Concepts Explained (teams_agent_test)

**Date:** 2026-10-13T10:39:33.4885167Z

## Overview
The meeting consists of a presentation by Binura Ranasinghe walking through foundational concepts of Claude Code aimed at non-technical founders. The session covers what Claude Code is, how it differs from standard chatbots, how to interact with it via the terminal, how prompting works, and how to manage permissions and tool use. The goal is to give non-coders a solid mental model so they can build and automate without feeling lost.

## Key Points
- Claude Code differs from chatbots like ChatGPT in that it can take real actions on your computer — creating files, building websites, installing packages, etc.
- Claude Code runs in the terminal, but users only need to know a few commands: 'claude' to open, Ctrl+C twice to close, and '/clear' to reset memory.
- Prompts should be specific and written in plain English — the more detail provided, the better the output.
- By default, Claude Code asks for permission before significant actions; users can pre-approve safe actions (reading files, running tests, Git operations, starting a dev server) while keeping riskier actions (installing packages, deleting files, API calls) gated.
- The '--dangerously-skip-permissions' flag exists but is discouraged even by Claude Code's creator; instead, a permissions allow-list in settings.json is recommended.
- Claude Code has built-in tools — read, write, and bash — which it selects automatically based on the user's plain-English description of a goal.
- Users can ask Claude itself to configure the settings.json permissions file rather than editing it manually.

## Decisions
_None captured._

## Open Questions
- What are the remaining concepts (beyond the ~5 covered) in the full list of 27 Claude Code concepts?
- What specific concept was mentioned as making prompting 'much easier' that was deferred to later in the session?
- What is the recommended complete allow-list for the settings.json permissions file for most projects?
