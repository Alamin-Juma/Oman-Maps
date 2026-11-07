# 0006. Feature → unit → E2E test-driven workflow

- **Status:** Accepted
- **Date:** 2026-11-07

## Context
The founder asked for a model where a feature test validates what we are building first, unit tests drive the code,
and an E2E test validates the slice works, recorded as a standing rule.

## Decision
Mandatory for every feature, fix and rule change. Full rule: [docs/engineering/testing-workflow.md](../engineering/testing-workflow.md).
1. Feature test in `tests/features/` (Given/When/Then, public API only), written first and seen red.
2. Unit tests beside the code drive the implementation.
3. E2E test in `tests/e2e/` against the real running system (built server or Docker image + Postgres).

## Consequences
- Feature tests double as executable product requirements, traceable to quotes from the product definition.
- E2E needs Docker locally; tests skip with a clear message when Postgres is absent, and CI always runs them.
