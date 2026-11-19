# «NN» · «feature name» — manual test

**What this proves, in one sentence:** «…»
**Timebox:** «15» minutes. **Written after review of:** «commit or PR».

## Setup

- Start: `npm run db:up`, then `npm run dev:api` and `npm run dev:web` in separate terminals.
- Open «URL». Use «browser»; for a second family use a second browser, not a tab.
- Stop both servers when you finish.

## Steps

Each step says exactly where to click, what you should see (concretely enough to be wrong), and which
bug it would catch.

| # | Do | You should see | Catches |
|---|---|---|---|
| 1 | «Missions → "The map is broken!" → …» | «…» | «…» |

## Must NOT work

What must be refused or must not happen matters more than the happy path.

| # | Try | Expected refusal |
|---|---|---|

## Break it on purpose

Stop the API (or switch the browser offline) and repeat the key steps. Every panel must still say
something true: an error, an offline notice, or "not saved", never a misleading empty state.

## Known and accepted (not bugs)

Deliberate behaviours, so nobody files them as defects. Link the findings-register row for each.
