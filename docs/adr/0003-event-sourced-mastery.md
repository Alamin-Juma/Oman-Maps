# 0003. Mastery is derived from an event log by fixed rules

- **Status:** Accepted
- **Date:** 2026-11-07

## Context
- *"Fixed rules decide mastery. The AI result is one input."*
- *"Mastered = correct on two separate days, including one explanation."*
- *"Progress is recorded offline first. Events queue on the device and sync when a connection appears."*
- The phone (C#) must show mastery offline; the server (TypeScript) must agree for reports.

## Decision
- Record only **append-only AttemptEvents** (client UUID, skill, task, kind, correct, time, context).
- **Derive** skill state by replaying events through `@dunialab/mastery`. Never store mastery as a flag.
- Rules:
  - Mastered = correct on ≥ 2 distinct **local Kenyan days** (EAT, UTC+3), including ≥ 1 accepted explanation. Mastery is sticky.
  - Review = Leitner boxes `[1, 3, 7, 14, 30]` days; a correct review promotes once per day, a wrong one resets to box 0.
  - Review sessions interleave sub-strands.
- The rules are specified by `packages/mastery/fixtures/conformance.json`. TypeScript and C# must both pass every case.

## Consequences
- Sync is idempotent (`ON CONFLICT DO NOTHING` on `event_id`), and out-of-order delivery is harmless.
- Rule changes are cheap and retroactive: change the rule, replay the log.
- Device clocks can be wrong. Accepted for the MVP; if the pilot shows abuse or drift, clamp `occurredAt` to `receivedAt` on the server.
