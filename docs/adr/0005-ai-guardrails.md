# 0005. AI guardrails: choose among approved outcomes, behind a port, with offline fallback

- **Status:** Accepted
- **Date:** 2026-11-07

## Context
- *"AI service: a hosted LLM behind our own API, given only the approved rubric and the mission. Output limited to one of a fixed set of feedback types. No free conversation."*
- *"Below the threshold the child gets a multiple-choice follow-up instead."*
- *"A single privacy incident with children would end the company."*
- Pilot gate: ≥ 85% AI-teacher agreement on explanations.

## Decision
1. **Port + adapter.** Controllers depend on `AiGrader`; `ClaudeGrader` is one adapter (Anthropic SDK, structured outputs via `betaZodOutputFormat`, server-side refusal fallback enabled).
2. **The model can only reference ids.** It returns `{verdict, criteriaMet[], hintId, confidence, unsafe}`. It never writes text a child sees. Hint wording is teacher-written.
3. **`decideFeedback` is the guardrail**, a pure, unit-tested function:
   - unsafe → multiple-choice follow-up + teacher flag;
   - confidence < threshold (default 0.75) or off-topic → follow-up;
   - "meets" only counts if enough **known** criteria are cited;
   - unknown criteria/hint ids are discarded; at most one hint, then the follow-up.
4. **Minimal input.** Task, rubric, approved hints, exemplar, locale and answer. No profile id, nickname or school. Enforced by a feature test.
5. **Offline fallback everywhere.** No key, timeout (8 s), refusal or error → the deterministic on-device rubric checker, with the same three outcomes.
6. **Model:** `claude-opus-5-5` at `effort: low` by default (configurable via `AI_MODEL`). Cost per check is to be measured in the pilot against the "< 10% of revenue per learner" target. Trying a smaller model is a pricing decision for the founder, made with eval data.

## Consequences
- Swapping provider = new adapter. Changing the threshold = config.
- Explanation text is not stored in the MVP; building the 50+ answer teacher-marked eval set needs a separate consented dataset.
- An eval harness (AI vs teacher agreement) is required before the pilot. Tracked in the technical guide roadmap.
