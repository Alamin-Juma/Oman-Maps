# 00. Whole-product walkthrough (web, Tier C and the 3D view)

**Run it:** before every release and every demo. **Takes:** about 20 minutes.
**Written:** 22 November 2026, after the first CodeRabbit review round (findings register §8), from
what the app does now. Update it whenever a screen it visits changes.

One child plays as a guest, a parent signs up and links the phone, progress syncs and appears in the
weekly report, and the 3D view opens. Each step says what you should see; anything else is a finding.
Use made-up names only.

## Before you start

```bash
npm install && npm run build
npm run db:up                                   # Postgres on :5433
npx playwright install chromium                 # only for the automated suite
npm run dev:api                                 # terminal 1: API on http://localhost:3000
VITE_ALLOW_DRAFT_CONTENT=true npm run dev:web   # terminal 2: web on http://localhost:5173
```

The Kenya pack is still a teacher **draft**, so the web app needs `VITE_ALLOW_DRAFT_CONTENT=true` to
offer it. A **production** build without that setting must offer no lessons and say they are waiting
for teacher approval (step 9 checks it). Stop both servers and `npm run db:down` when you finish.

## Steps

| # | Do | You should see | If not |
|---|---|---|---|
| 1 | Open http://localhost:5173 in a private window | The 2D Kenya map, the Missions list, a yellow "Draft content" banner, "Parent area" with Sign in | No banner: the build is not a rehearsal build. Blank page: check the browser console |
| 2 | Tap Mount Kenya on the map | A fact card with "See in 3D" (on a phone with WebGL2) | No "See in 3D": the device check says this phone cannot run 3D; the 2D path must still work |
| 3 | Pick **The map is broken!**; answer The title, In the key, The compass | A green tick or the teacher's explanation after each answer, and the counter moves 1/4 to 4/4 | A stuck counter or a double jump is a bug (findings register CR26) |
| 4 | Turn the network off (browser devtools: Offline). Type "Without a key I cannot tell what the symbols mean and without a scale I cannot work out the distance" and press Check my answer | "Great explanation!" at once, then "Mission complete!" | A wait of seconds while offline, or an error, is a bug: missions never wait on the network |
| 5 | Back to missions; turn the network on | The progress panel shows "Knows the parts of a map: Practising" | Progress missing after the network returns is a bug |
| 6 | Parent area: Create account with a made-up email and a 10+ character password. Press Create account twice quickly | One account is made; the panel moves on once | Two requests, or an error from the second press, is a bug (CR6) |
| 7 | Tick consent, nickname "Amani", pick three pictures, Add child | The child selector (named "Child" for screen readers) shows Amani; "Sync now (4)" | "Add child" shown while the list is still loading, or after a failed load, is a bug (CR33) |
| 8 | Sync now, then Weekly report | "Synced: 4 new, 0 already saved", then a report headed "Amani:" | Switching to another child must hide this report (CR34) |
| 9 | Sign out, then sign in with a second account in the same window | Consent unticked, no children from the first family, the guest progress not offered to the new family | Any trace of the first family is a serious bug (S7, CR8) |
| 10 | Map: tap Mount Kenya, See in 3D | Terrain rises, labels appear, "Map data" credits Copernicus; Back to map returns to 2D | A blank canvas with no message is a bug; a clear "3D unavailable" with the 2D map is correct |
| 11 | Camera check (camera icon): Start camera, then close the panel before it opens | No camera light stays on after closing | A camera left on is a bug (CR12) |
| 12 | Stop the dev web server. Build for production without drafts: `npm run build -w @dunialab/web` and `npx vite preview` in `apps/web` | "No approved lessons yet: 1 lesson pack is waiting for teacher approval" | Any lesson shown is a release blocker (S1, CR2) |

## What to report

The step number, what you saw, a screenshot, and whether the API terminal printed an error. The
"kinds of nothing on screen" table in [README.md](README.md) tells refused, failed, empty and not
saved apart; say which one you saw.
