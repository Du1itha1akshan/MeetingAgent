# meetingagent_webhook_test3

**Date:** 2026-10-12T08:43:00Z

## Overview
The meeting appears to be a presentation or demonstration comparing two AI models, referred to as 'Sonnet' and 'Opus', across several real-world tasks. The speaker, Binura Ranasinghe, evaluated the models on textual knowledge, hallucination rates, and a complex creative coding task involving building a 3D game set in Rivendell from Lord of the Rings. The session concluded with a brief reflection on benchmark validity and which model is worth paying for depending on use case.

## Key Points
- Both models were run in a core desktop app in 'coworker mode' with no prompts answered along the way, relying solely on pre-given prompts.
- Sonnet scored higher on textual knowledge at 66% against Opus, and was less likely to hallucinate (47% less likely to make up answers than Opus).
- In a test where the model was not told certain information, Sonnet left a gap while Opus fabricated an answer, illustrating a key behavioral difference.
- The most complex task involved building a 3D game set in Rivendell using Tolkien's descriptions, with free 3D assets, textures from Polyhaven, and multiple agents running simultaneously.
- Sonnet produced a more traditional, cartoonish Tolkien-style game environment, while Opus produced a more realistic, modern-looking environment with 3,500 trees across five species and more detailed terrain.
- Opus followed the books' layout more closely (zigzag path, narrow stone bridge with railing), but had limitations such as inability to enter buildings.
- Across four tested jobs, Opus performed better on SQL tasks and the original game, while the school app task was roughly comparable.

## Decisions
_None captured._

## Open Questions
- Which model (Sonnet or Opus) is worth paying for, given it depends on the user's specific use case?
- Do the benchmarks consistently hold up across a wider range of real-world tasks beyond the four tested?
