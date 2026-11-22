# DuniaLab - weekly feature delivery plan

**Planning snapshot: 19 November 2026.**
**Status: proposed schedule, not approval to change the MVP or start unreviewed features.**

Source of truth: [product definition](product-definition.md).
Current defects and decisions: [findings register](../engineering/findings-register.md).
Implementation context: [technical guide](../technical-guide.md), [architecture](../architecture/README.md)
and [3D Explorer brief](../briefs/3d-explorer.md).

## 1. What this plan assumes

- The founder confirmed **30-40 focused engineering hours per week** and asked for a realistic
  forecast, rather than forcing all work into January.
- That time includes specification, implementation, tests, review, documentation and integration.
  Plan about 3-4 days of implementation and the rest for those checks, not five days of new features.
- One engineer owns one main delivery stream. Agents can assist, but are not additional independent
  engineers with unlimited integration capacity.
- Teacher review, voice recording, artwork/printing, legal advice and school recruitment need their
  own owners. Their work can overlap engineering; it cannot be assumed completed by an agent.
- Weeks are Monday-Sunday. W1 is already partly elapsed. W6-W7 deliberately carry lighter work
  around the holidays; confirm actual founder and contractor availability.
- D1-D7 remain **awaiting founder decisions** in the register. Slots below reserve capacity for
  the chosen design; they do not approve a retention period, session design, PIN policy or tier change.
- The present MVP still includes **Tiers A, B and C**, six missions, bilingual narration, two
  take-home challenges, spaced review, parent reports and a basic teacher class table.
- New architectural choices get a reviewed brief and the required ADR/diagram updates when built.
  This planning document does not itself introduce a component or data flow.

### Forecast, not a deadline promise

| Milestone | Proposed window | What it means |
|---|---|---|
| Web learning release candidate | W11-W12: 25 Jan-7 Feb 2027 | Candidate for a web-first pilot **only if D2 explicitly authorises that scope**, all relevant safety/content/operations gates pass, and outstanding work fits |
| Full A/B/C MVP release candidate | W16: 1-7 Mar 2027 | Central planning estimate with the Unity work retained; not a promise that the device spike or review will find no rework |
| Full-MVP contingency | W17-W18: 8-21 Mar 2027 | Reserved for device, integration, content or review failures; delays to decisions/providers can push it further |

**End of January is not a credible commitment for the complete current MVP on the evidence
available.** It is a conditional target for the web slice. Adding Unity earlier requires moving
other work, adding a capable engineer with clear ownership, or approving a smaller pilot scope.
Do not call web 3D "Tier B" or silently replace the Tier B device gate.

These are coarse engineering estimates, not measured velocity. Reforecast after the Tier B spike
and after two weeks of completed, reviewed work. Do not make schools a date promise from this table.

## 2. Already built: do not rebuild these

This baseline combines code inspection and the current register. The inspected HEAD was `dd54291`;
many 19 November changes were still uncommitted. Existing tests are cited as evidence locations,
not as a claim that the full suite was rerun for this documentation task. "Built" does not mean deployed.

| Capability | Current baseline | Remaining work |
|---|---|---|
| Monorepo, API, Postgres and pure packages | Present; [technical guide](../technical-guide.md) and [architecture](../architecture/README.md) | Production configuration, packaged-image checks and recovery rehearsal |
| Curriculum schema and six missions | [Kenya Explorer pack](../../packages/content/packs/kenya-explorer.json) has six bilingual draft missions, four tasks each | Teacher approval, final wording/rubrics, recorded audio, physical-map alignment |
| Mission/explanation loop | [Mission session](../../packages/mission/src/session.ts), web tasks, one-hint/follow-up flow and local checker exist | Resume, review entry point, wellbeing behaviour and Unity UI |
| Mastery and summary rules | TS rules, C# mastery conformance, [review queue](../../packages/mastery/src/review.ts) and [weekly summary](../../packages/mastery/src/report.ts) exist | Deliver due reviews; recover progress on another device; send meaningful parent reports |
| Web 2D experience | Interactive map, missions, parent area, camera device check | Offline reopening, profile unlock, full recovery, narration |
| Web 3D phases 0-2 | Generated assets, lazy viewer, rise/orbit, labels, static lakes/rivers; [brief](../briefs/3d-explorer.md) | Show river, offline 3D, adaptive performance and real-phone evidence; not Unity AR |
| Production approval handling | S1 recorded fixed; [pack selection](../../apps/web/src/lib/pack-selection.ts), build-time validation and production E2E exist | The actual pack is still draft; only teacher approval can unblock child delivery |
| Client sessions and rate limiting | S7-S9 recorded fixed; stale-response boundary, protected-call expiry handling and credential limits | Server-revocable sessions; shared limiter only if deployment becomes multi-instance |
| Storage and batched uploads | R1/R2/R4/R7 recorded fixed; [queue](../../apps/web/src/lib/queue.ts), [sync helper](../../apps/web/src/lib/sync.ts), shared request limits | Complete transactional concurrency, fresh-device recovery and genuine offline restart |
| Test/review foundations | T1/T3/T4/T7/T8 recorded fixed; required-DB gate, root test typecheck, LFS check, safer diagnostics and bundle improvement | Production-image smoke, device/recovery gates and completed manual walkthrough |

**Important limits to the baseline:**

- R1's memory fallback protects the current session, not work after the app closes without a
  successful save. Keep that warning truthful.
- R3 is **partially mitigated, not transactionally solved**. The queue re-reads before writing,
  but another writer can still race. W4 reserves the complete fix before relying on web learning
  as the primary pilot experience; do not wait for a learner to report lost work.
- R5 (server-to-device recovery) and R6 (mission resume) remain unfinished.
- The [Unity project](../../apps/unity/README.md) has core mastery/tier selection and AR scaffolding,
  not a delivered learner app.
- The product's "first three phases built" means phases **0, 1 and 2**. Phase 3 Show river is not built.
- A weekly summary calculation is not yet scheduled SMS/WhatsApp delivery with a suggested activity.

### The six existing missions to finish, not replace

| Mission | Existing draft | Remaining acceptance |
|---|---|---|
| 1 | The map is broken! | Teacher validates title/key/compass/scale tasks and explanation |
| 2 | Compass quest | Direction and locate tasks work on the printed map and every supported tier |
| 3 | Scale detective | Scale wording, units and map measurements are consistent |
| 4 | Expedition: the mountains | Landform facts, visual exaggeration and explanation rubric approved |
| 5 | Expedition: lakes and the Rift Valley | Lake/valley interpretation and Kiswahili wording approved |
| 6 | Expedition: rivers and the coast | River/coast tasks and explanation work without animated 3D |

All six need EN/SW text and audio QA, offline completion, correct events and equivalent mastery
across delivered clients. A future narrated river journey must not silently become a seventh MVP mission.

## 3. Decisions and external dependencies to unblock first

| Decision / dependency | Needed by | Consequence if late |
|---|---|---|
| D4: session design and expiry | Start W2 | Revocable authentication slips; school/parent work cannot be declared safe |
| D1: retention, deletion and purpose-specific consent | Before W3 | Reserve the slot, but do not invent a legal period or withdrawal policy |
| D5: shared-phone PIN, reopen and reset | Before W4 | Profile unlock and offline identity integration slip |
| D6: compatible mission resume | Before W5 | Persistence can proceed; resume behaviour waits |
| D3: AI egress/provider terms/fallback | Begin W1, resolve before external child-answer processing | Keep a safe non-egress path; an AI-disabled pilot cannot pass the external-AI quality gate |
| D7: parent/class linking and teacher access | Before W8; brief in W5 | Class table cannot be implemented safely without membership rules |
| D2: device tier scope | After W2 spike, before school dates are promised | A/B remain MVP until explicitly changed; January web-only pilot is not authorised by this plan |
| Teacher, language reviewers and voice artists | Recruit W1; scripts ready W5 | Narration/content approval moves, even if the player is ready |
| Counsel, DPIA, registration and provider/deployment review | Start W1; complete before real child data | No child pilot, regardless of engineering progress |
| Pilot schools, calendar and representative devices | Start W1-W2 | Device gates and pilot dates remain provisional |

Also resolve in the relevant brief: parent notification channel and verified recipient, how the
approximately 20-minute session cap behaves without losing work, and the two take-home activities.
These are delivery decisions inside existing promises, not permission to collect extra data.

## 4. Weekly build breakdown

Every week includes the project's **Feature -> Unit -> E2E** workflow, code review and directly
related documentation. "Done when" below is the weekly demonstration, not a replacement for those tests.
Use synthetic data until the applicable privacy prerequisites are satisfied.

### W1 - 16-22 November: finish the current round and establish the baseline

**Remaining work from 19 November:**
- Review/integrate the current approval, session-boundary, rate-limit and storage/sync changes.
  Do not schedule these implemented fixes again as new features.
- Verify the exact reviewed revision with the required database and asset checks; record residual
  R3 risk separately from the fixed cases.
- Prepare reviewed briefs for sessions/consent, durable learning and the Tier B feasibility spike.
- Start the teacher, counsel, device-survey and pilot-school work; identify decision owners.

**Progress recorded 19 November** (details in [the ledger](../engineering/ledger.md)):
- Done: the review fixes (S1, S7, S8, S9, R1, R2, R3 with residual risk recorded, R4, R7, T7, T8) and
  **T5**: all 44 E2E tests pass against the running production Docker image, and CI now runs the API E2E
  suite against the image.
- Done: the full codebase is on the CodeRabbit review mirror (221 files, under the 300-file limit).
- New working rule: a failing test is fixed in the code, never by bending the test; every test is a
  committed file; every change gets a ledger entry (`CLAUDE.md` rules 1 and 6).

**Plan validated against the code, 21 November** (details in [the ledger](../engineering/ledger.md)):
- Confirmed still true: Show river (Phase 3) is not built; spaced review is never offered to a child
  (P1: `buildReviewQueue` is called only by `packages/mastery` and its tests); the web app has no
  service worker or cache (P2); new-device recovery (R5) and mission resume (R6) are open; the 2D map
  takes the home country from a hard-coded three-country table (P9); R3 is only partly fixed.
- Stale in this plan: section 2 says the inspected HEAD was `dd54291`. The branch is at `438c38d`
  plus uncommitted rule, ledger, CI and re-audit work. W1 is not done until that work is committed.
- The Unity project has never been opened in an editor (no `ProjectSettings/ProjectVersion.txt`),
  so W2's spike starts by pinning the toolchain. It needs a person with the editor and real phones.
- Baseline run on 21 November (build, typecheck, `npm test`): build and typecheck pass. Two feature
  tests timed out at 5 s under the full parallel run (`new-grade-is-a-content-drop`,
  `sign-in-is-rate-limited`) and pass alone. Recorded as a finding to investigate; no time limit is
  raised without evidence.
- **First the review round.** The first full code review (`docs/reviews`) is worked through
  completely, every finding registered and fixed or given a status, before any new feature starts.
  The founder's reason: building bug-free from the start costs less than fighting bugs later.

**Review round completed 22 November** (details in [the ledger](../engineering/ledger.md) and the
[findings register](../engineering/findings-register.md) §8): all 89 CodeRabbit findings have a status; 74
fixed, 2 were already fixed, 6 deferred with triggers, 7 await founder decisions (new **D8** draft override
in production, **D9** online check wait, **D10** learning-result bands; plus D3 and D7). Pulled forward on
the way: **P9** (country code in the pack) and **E5** (the whole-product walkthrough) are done, and part of
**T2** (missions played with the network cut). The Tier B spike brief must list the deferred Unity fixes
CR82-CR84 for when the project is first opened.

**Next build queue, after the review round** (each item starts with a reviewed brief, rule 5):

| Order | Item | Needs a founder decision? | Plan week it pulls forward or serves |
|---|---|---|---|
| 1 | Commit the W1 baseline and re-run the full suite with the database | No (founder asks for the commit) | W1 |
| 2 | Brief: Tier B feasibility spike (toolchain pin, three recognition approaches, measured pass/fail) | No; the spike's *run* needs Unity and phones | W2 |
| 3 | Brief: durable learning (R3 transactional queue, R5 fresh-device recovery, P2 offline shell, T2 real offline E2E; R6 resume as a slot) | Only R6 waits for D6; the PIN part waits for D5 | W4-W5 |
| 4 | Build: R3 transactional queue (two overlapping writers keep both sets of events, existing data migrates) | No | W4, pulled forward |
| 5 | Build: T2 real offline E2E (cut the network, reload, reconnect, sync), red first against today's app | No | W5, pulled forward |
| 6 | Build: R5 recovery of server progress on a fresh device | No | W5 |
| 7 | Brief: sessions and consent, written around D4 and D1 options | Yes: D4 and D1 to build | W2-W3 |
| 8 | Build: P1 spaced review in the learner flow | No | W7, pulled forward if W2-W3 wait on decisions |
| 9 | ~~Build: P9 country code in the pack, not in `KenyaMap`~~ Done 22 November (CR36) | No | W6 |

Items 4-6 and 8-9 go ahead of their weeks only while D4, D1 and D5 are unanswered, so engineering
time is not idle. They do not move any decision-dependent week earlier.

**Done when:** one reviewed baseline and one prioritised queue exist, with no ambiguity about
uncommitted work, pending decisions or whether the pack is approved.

### W2 - 23-29 November: feasibility and revocable sign-in

- Time-box a Tier B spike to approximately two engineering days: open the current Unity project,
  pin the actual toolchain, try recognition of a printed A2 target on representative devices,
  and document measured results plus licensing/build blockers. This is not a finished Tier B app.
- With D4 approved, implement server-revocable sessions and current-device/all-device sign-out.
  Define expiry, security-change revocation and migration from existing tokens.
- Keep offline learning independent of online session validation.
- Begin provider-term review and a versioned AI evaluation protocol; use synthetic examples for setup.

**Done when:** an already-issued session is demonstrably refused after revocation, and the founder
has evidence for D2. If the spike or session work exceeds this slot, reforecast rather than drop tests.

### W3 - 30 November-6 December: consent, deletion and retention

**Depends on D1/D3 and W2.**
- Build a dedicated consent screen for existing as well as new families: review, renewal and
  purpose-specific withdrawal.
- Implement confirmed account deletion and the approved retention rule, including reminder eligibility.
  Reuse the existing cascades; include derived data, pending uploads and device handling. If the policy
  requires advance notice, automatic deletion stays disabled until the W9 delivery path is proven;
  parent-requested deletion does not wait for that scheduled-message integration.
- Define live-system versus backup deletion, and stale-device behaviour that cannot recreate
  erased accounts. Specify minimal audit evidence and its own retention.
- Apply the approved external-AI boundary; no "nickname removed, therefore anonymous" claim.

**Done when:** real-Postgres tests prove deletion and withdrawal effects, synthetic retained/expired
accounts behave correctly, and the parent sees accurate local/server data outcomes.
Backup restoration is rehearsed in W11, not assumed proven here.

### W4 - 7-13 December: shared-phone identity and reliable local storage

**Depends on D5 and W3's lifecycle contract.**
- Implement the chosen local PIN unlock, switch/reopen rules, failed-attempt handling and parent reset.
- Replace the residual cross-tab read/write race with a transactional strategy and migrate existing
  valid queue data without losing ownership, sync marks or events.
- Cover full/blocked storage, damaged data, bounded recovery copies and explicit unsaved status.
- Keep identity-scoped recovery and deletion consistent; never adopt one child's events into another.

**Done when:** two overlapping writers preserve both sets of events, existing data migrates safely,
and switching/reopening enforces the approved sibling boundary offline.

### W5 - 14-20 December: download once, reopen offline, resume and recover

**Depends on W4 and D6.**
- Add the web app shell and versioned content/asset download/cache lifecycle: progress, cancellation,
  incomplete download, update and unavailable-content states.
- Persist compatible mission position and in-flight task state; resume without duplicate learning events.
- Recover authoritative progress on a fresh device and reconcile it with pending local work.
- Complete the real offline E2E: download, disconnect, play, close/reopen, reconnect, sync and retry.

**Done when:** an offline reload works from the promised downloaded content, and a recovered device
agrees with the server report without discarding its own unsynced work. Fetching new content or
server history still needs connectivity; the UI must say so.

### W6 - 21-27 December: content and physical-map completion; holiday buffer

**Lower-capacity week; final sign-off depends on reviewer availability.**
- Review all six mission scripts, rubrics, translations and narration scripts against the curriculum.
- Prepare the two teacher-approved take-home Explorer challenges, including safe instructions and
  a modest completion/reflection flow. Do not add photos, location or free AI conversation.
- Finalise A2 artwork, QR destination and map/scale consistency; obtain print proofs and quotations.
- Fix issues from W3-W5; review the school/class brief rather than start another major subsystem.

**Done when:** an explicit content/print approval checklist exists, completed items have real sign-off,
and the remaining external work has dates/owners. A holiday-delayed signature is not marked done.

### W7 - 28 December-3 January: learning-loop finish and narration

**Lower-capacity week; spill into W8 if recordings or implementation are not ready.**
- Expose the existing spaced-review queue in the learner flow; persist review-context events and
  interleave due topics using the existing mastery rules.
- Add prerecorded EN/SW narration for approved explore facts and mission content, with replay,
  language switching, readable text and missing-audio states. Include audio in offline budgets.
- Deliver the two take-home challenges and teacher-approved activity content for weekly reports.
- Implement the approved approximately 20-minute session/break behaviour without deleting progress.
  Estimated mission duration alone is not an enforced cap.

**Done when:** a returning learner receives the right due review, hears downloaded narration offline,
can take a break/resume, and receives the two approved home activities.
Do not substitute synthetic speech for the promised recorded narration without a product decision.

### W8 - 4-10 January: basic school and teacher experience

**Depends on D7, W2-W4 and the reviewed class brief.**
- Add the chosen school/class membership model and teacher authentication/access lifecycle.
- Implement parent-controlled linking, recognisable school/class confirmation, revocable invitations
  and removal, including teacher departure.
- Build the **basic class mastery table**, not the proposed full classroom management platform.
- Show honest unsynced/stale/empty/refused states; protect individual and aggregate reads consistently.

**Done when:** a teacher sees only the authorised class's nicknames and skill mastery; removal and
staff-access revocation take effect; no parent contact details or explanation text are exposed.
Schema and architecture documentation change with the implementation.

### W9 - 11-17 January: useful weekly parent reports and delivery

**Depends on W3, W5, W7 and a notification-channel decision.**
- Finish the in-app weekly summary in the parent's language: mastered skills, support needs and
  one approved activity to do together, reusing the existing summary engine.
- Add scheduled delivery using the chosen SMS or WhatsApp channel, verified destination,
  preferences/withdrawal, bounded retries and duplicate-send protection.
- Complete any D1 retention-reminder delivery and failed-delivery policy before enabling automatic
  deletion that depends on notice. Keep service notices distinct from optional learning messages.
- Use a suitably protected report link; a forwarded message must not reveal another family's data.
- Show last-sync/partial-report information instead of implying that unsent local learning is absent.

**Done when:** a synthetic family receives one scheduled message, follows the link to the right
report, and failures/opt-out/retry are tested. In-app rendering alone does not complete this week.
Provider setup and sender approval begin earlier; they may delay delivery independently of code.

### W10 - 18-24 January: assessment quality and pilot measurement

**Evaluation preparation starts W2; this is the completion gate, not the first data request.**
- Complete the approved evaluation workflow: at least 50 teacher-marked real explanations per
  rubric, AI/teacher agreement, mismatch review and cost per check, versioned by rubric/model.
- Obtain such examples only through a separately authorised, consented and time-limited study
  or appropriately approved existing dataset. Do not bypass privacy gates to assemble the dataset.
- Test unknown/low-confidence responses, timeout/failure fallback and fixed-rule mastery.
- Prepare curriculum-aligned pre/post/delayed tests, cohort procedures and a minimal measurement
  plan for completion, week-3 return, report use and actual payment.
- Prefer existing learning events and consented study records; new analytics data needs a reviewed
  purpose and DPIA update. Distinguish mission completion from simply counting task attempts.

**Done when:** the required agreement gate is measured, or explicitly remains blocked.
If external AI is disabled under an approved pilot decision, record that its gate is **not tested**,
and evaluate the local checker separately. Do not report fallback results as AI evidence.

### W11 - 25-31 January: web release candidate and operational rehearsal

**Depends on all web-path safety, learning, content and reporting gates above.**
- Run the actual production API image against Postgres: migrations, health, authorised flow and
  refused unapproved content. Inspect shipped web assets with draft overrides disabled.
- Complete the whole-product manual walkthrough after review, using a clean/recovered device,
  offline use, both family roles, teacher view and failed-network/storage cases.
- Exercise encryption/configuration, minimal audit/diagnostics, backup restoration, deletion after
  restore, rollback/forward repair and the incident/support procedure.
- Measure core missions and optional 3D separately on the representative phone set. Finish offline
  3D caching and necessary quality degradation; preserve the 2D path and delivery budgets.
- Confirm legal/content approval, map print readiness, school onboarding and release ownership.

**Done when:** a specific artifact and configuration have recorded release evidence and no unresolved
pilot blocker. This is a candidate for a **web-first pilot only if D2 has changed the scope**.
Otherwise it is a rehearsal milestone while the full MVP waits for Unity.

### W12 - 1-7 February: Unity learner UI and shared-rule conformance

**Depends on the W2 spike and D2. Retain this week unless Unity is explicitly deferred.**
- Build the usable Unity mission runner for the same choice/locate/explanation/hint/follow-up loop.
- Load validated approved content and the generated terrain through a tested reader.
- Reuse C# mastery; add shared behavioural fixtures for any mission rules now implemented in C#.
- Connect language, recorded narration, accessibility and basic navigation to the existing content.

**Done when:** a real Android build completes a mission with the same expected learning events
and mastery outcome as the web client. Passing plain C# tests alone is insufficient.

### W13 - 8-14 February: Unity offline delivery, identity and sync

**Depends on W12 and the settled W3-W5 contracts.**
- Implement downloadable content delivery, local queue, resume, PIN and permitted offline use.
- Integrate session/consent changes, batched retries, recovery and deletion semantics.
- Test app kill, interrupted download, upgrade, poor connectivity and a subsequent device recovery.
- Verify app/content budgets and permitted network destinations on Android.

**Done when:** the Unity learner can download, close, reopen offline, finish and later sync without
loss, cross-profile leakage or duplicated learning credit.

### W14 - 15-21 February: complete Tier B scan-and-pop

**Depends on W12-W13 and a successful/approved recognition approach.**
- Productionise map recognition using the actual approved print, not just a laboratory target.
- Open the right pack/3D scene; handle permission refusal, no camera, poor light, target loss and retry.
- Keep camera processing on-device; test realistic print angle, wear and budget-phone performance.
- Provide the intended Tier C fallback when the device cannot deliver the richer experience.

**Done when:** representative non-ARCore phones complete scan -> explore -> mission -> sync,
and the camera-data boundary and recognition success evidence are recorded.

### W15 - 22-28 February: complete Tier A AR

**Depends on the reusable Unity experience from W12-W14.**
- Finish ARCore capability selection, image anchoring, scale/orientation and tracking recovery.
- Reuse the same approved content, narration and mission/mastery flow.
- Handle pause/resume, unsupported hardware, permission denial and fallback to the correct tier.
- Test battery, memory, heat, touch and tracking on real supported phones; fix tier-specific regressions.

**Done when:** a supported Android phone runs the full experience on the paper map, and an unsupported
one follows a working alternative without losing progress or presenting a broken AR screen.

### W16 - 1-7 March: full-MVP release gate and pilot onboarding

- Re-run the full release gates on the integrated A/B/C artifact set, including C# conformance,
  real API/image flows, offline restart, role isolation and approved content.
- Verify all six missions, both languages, review, home activities, parent messages and teacher table.
- Complete print quality checks and school/parent onboarding; train the pilot teachers and support owner.
- Publish the known limitations, incident/deletion process and tested device list.
- Reconfirm study dates against the school calendar and all partner commitments.

**Done when:** the founder signs off the evidence, not just a test count. Start the pilot only after
the release gate passes. The full MVP reaching March makes a complete Term 1 study doubtful.

### W17-W18 - 8-21 March: reserved contingency, not extra features

Use only for failed gates, review fixes, late recordings/provider approvals, target-device failures
or integration rework. If unused, release earlier; do not fill the buffer with an editor or new missions.
If a dependency remains blocked, publish a new forecast instead of consuming safety checks.

## 5. Coverage map: every MVP promise has a delivery slot

| Product promise / prerequisite | Primary week(s) | Acceptance owner |
|---|---|---|
| Six curriculum-mapped missions, teacher-reviewed rubrics | Existing drafts; W6-W7, W16 | Teacher + founder |
| A2 printed map and QR | W1 quotes; W6 proof; W14 recognition; W16 print QA | Founder + artist/printer |
| Tier C 2D + current 3D | Existing; W5/W11 reliability and device work | Founder |
| Tier B scan-and-pop | W2 spike; W12-W14 | Founder; device testers |
| Tier A AR | W12-W13 shared client; W15 | Founder; device testers |
| Offline download/play/reopen and recovery | W4-W5 web; W13 Unity | Founder |
| English/Kiswahili narration | Scripts W6; playback W7; Unity W12 | Teacher/language reviewers + voice artists + founder |
| Spaced review and fixed mastery | Existing core; W7 web; W12 Unity | Founder + teacher |
| Two offline home challenges | W6 content; W7 delivery | Teacher + founder |
| Safe explanation checking and one approved hint | Existing core; W3 privacy; W10 evaluation | Founder + teacher + legal/provider reviewers |
| Shared-phone profiles and picture PIN | W4 web; W13 Unity | Founder after D5 |
| Consent, deletion, retention and revocable access | W2-W4; W11 restore proof | Founder + counsel |
| Weekly parent report, link and activity | Existing calculation; W7 activity; W9 delivery | Founder + teacher; provider |
| Basic teacher class mastery table | W8 | Founder + pilot teacher after D7 |
| Approximately 20-minute session cap | W7; W12 client parity | Founder + teacher; behaviour approved in brief |
| Pack extensibility across countries | Small P9 schema/rendering cleanup alongside W6, if capacity; otherwise explicit pre-expansion gate | Founder; content validator tests |
| Encryption, access, audit and recovery evidence | W3 lifecycle design; W11/W16 deployment checks | Founder + deployment/legal reviewers |
| Pilot measurement and manual billing | W10 study protocol; pilot O4 payment test below | Founder + schools + teacher |

P9 must not branch on a country in application code. Use a content-driven contract and update the
schema/diagram/tests when implemented. It is not a reason to build new-country content during this MVP.

## 6. Non-engineering work runs alongside the weekly builds

| When | Owner and deliverable |
|---|---|
| W1-W2 | Founder recruits teacher/language reviewers, artist and voice artists; starts 30-parent survey and 20-model device coverage plan; secures school contacts |
| W1-W3 onward | Counsel/founder prepare DPIA, registration and transfer/provider arrangements; schools' responsibilities and agreements; no assumed approval date |
| W2-W6 | Teacher maps outcomes and rubrics; founder obtains A2 print quotes at 500/5,000 copies, commissioned artwork/proof and QR deployment plan |
| W2-W10 | Teacher/research owner prepares authorised evaluation data, pre/post/delayed assessment and comparison-class protocol |
| W5-W8 | Approved scripts recorded in EN/SW, edited, checked and packaged; failed recordings are retried, not silently omitted |
| W8-release | Confirm schools, devices, teacher training, support contacts, verified parent notification destinations and actual term dates |
| Before taking pilot money | Founder writes invoice/manual M-Pesa recording, reconciliation, correction/refund and access-entitlement process; no automated payment gateway |
| In parallel, without blocking core code | Founder checks trademark availability and market/customer assumptions listed in the product's open questions |

Phone-model survey data and evaluation records need the approved study handling and retention,
not an unreviewed analytics table. No technical readiness claim substitutes for legal or teacher sign-off.

## 7. Pilot calendar: relative to a passed release gate

Do not attach fixed school dates until the release and school-calendar gates are satisfied.

| Pilot week | Activity and evidence |
|---|---|
| U1 | Begin three-week usability pilot: two schools, 40-60 learners; consent, onboarding, device/core-task success and support issues |
| U2 | Observe mission completion, report access and practical classroom/parent friction; repair only essential issues and record the version |
| U3 | Measure unprompted week-3 return, close usability findings and decide whether the outcomes study is ready |
| Between U and O | One week of fixes/review, as specified in the product; freeze and record the evaluated version |
| O1 | Start six-week outcomes pilot: four schools, approximately eight classes; baseline assessment and agreed class allocation |
| O2-O3 | Track completion and return with the approved minimal dataset; weekly teacher/AI mismatch review if AI is enabled |
| O4 | Offer treatment parents month 2 at KES 249; record actual payments and reconcile. Seek paid Term 2 school commitments subject to the real calendar |
| O5-O6 | Continue the defined intervention and obtain the immediate post-test; record implementation changes and missing observations |
| O7-O9 | Wait the required three weeks after the post-test; delayed test and final learning/payment/teacher-interest analysis |

For calendar arithmetic this plan assumes the post-test is at O6. Confirm that interpretation with
the teacher/study owner. The full sequence then takes **13 weeks after release**, including the
usability pilot, repair week and delayed follow-up.

Even a web release at the end of January pushes that complete sequence into roughly May; a March
release pushes it into June or later. Therefore **"pilot in Term 1" cannot mean every study stage and
delayed result will finish in Term 1** under this sequence. Confirm term dates and agree a realistic
study calendar; do not shorten the delayed test or silently overlap cohorts to fit a slide.

Preserve the existing go/fix/stop thresholds:

- Tier B or better on at least 80% of pilot phones, unless an explicit D2 decision changes that hypothesis.
- At least 70% complete three missions; at least 50% return in week 3 without prompting.
- Delayed-test gain at least 10 percentage points against comparison classes.
- AI/teacher agreement at least 85%, when testing the external AI.
- At least three of four pilot teachers request the next module.
- At least 20% of treatment parents pay KES 249 for month 2; at least two schools sign a paid licence.

Use all corresponding stop/fix thresholds and decision rules in the product definition. An
untested gate is not a pass, and this small study is a directional signal, not statistical proof.

## 8. Features after MVP: a separate, unapproved queue

The product's proposed roadmap is not an instruction to squeeze every attractive idea into W1-W16.
In particular, W11 includes offline/performance essentials; the complete visual-polish wish list
and a narrated river story need their own capacity. Reuse the existing renderer, not another globe stack.

The blocks below are **rough sequencing allowances after the relevant pilot go decision**, not
calendar commitments or approved feature briefs. "G1" means the first build week after that decision.
Re-estimate at each block; no engineering work starts just because its tentative week arrived.

| Proposed build block | Feature breakdown | Exit gate |
|---|---|---|
| G1-G2 | Complete Show river: source-to-mouth animation, camera follow, reduced-motion alternative; optional device-appropriate visual polish | Real-phone frame rate and delivery budgets; no mission depends on 3D |
| G3-G4 | Journey of the Tana: teacher-approved narration, prediction pauses and explanation; integrate into or explicitly revise the six-mission structure | Reviewed learning outcome, offline playback and no unapproved seventh mission |
| G5-G6 | Slice the land: a child-selected transect and height profile; layer visibility only where the task needs it | Correct scale/units, usable touch interaction and a tested learning task |
| G7-G8 | "How it happened" Rift Valley story, then other landforms only if justified | Teacher-approved explanation sequence and measured learner comprehension |
| G9 | Local content-sharing feasibility spike: Wi-Fi Direct/Bluetooth/platform support and transfer budgets | Demonstrated transfer on target phones; content only, no learner-progress sharing |
| G10-G12 | One phone teaches the class, **only if the spike supports the estimate**: discovery, version/integrity checks, interruption/retry and classroom handout flow | Whole-class distribution within a lesson; compatibility and licensing reviewed |
| G13-G14 | Full teacher class view and classroom presentation mode; saved lesson views/annotations scoped to approved lessons | Teacher usability evidence; access isolation; separately estimate a Unity desktop target if selected |
| G15-G16 | Pack-editor prototype: staff authoring, validation, preview, review/approval and version publishing | A teacher/content designer produces a valid pack without editing application code |

Other product ideas remain a gated backlog, rather than fictitious weekly promises:

| Feature / expansion | Start trigger and first work |
|---|---|
| Remaining Grade 5 sub-strands | Teacher confirms demand and mapping; build location/position and weather/climate content, with packaged seasonal examples and sliders where needed |
| Grade 6 East Africa | Approved content budget and measured reuse; new pack, translation, narration, review and device/asset-budget checks |
| Parent-selected county | Learning value demonstrated and DPIA updated; no automatic GPS collection |
| Colour your own map | On-device capture/colour-transfer feasibility, print/lighting tests, then a bounded learner trial; no camera upload |
| Point your phone | Explicit change to the current location rule plus legal/DPIA review; prove on-device, non-stored location handling before any rollout |
| Broader pack editor | Prototype demonstrates staff value; extend curriculum workflow and publishing, not learner-data access |
| Grade 7 Africa/projector-smartboard product | School demand, curriculum team and suitable presentation target; do not reuse Grade 5 content merely because the screen is larger |
| Science/agriculture, Tanzania/Uganda, additional languages | Separate teacher/curriculum partners and cost case; validated content drops with any genuinely reusable interaction extension reviewed first |
| In-app payments | Explicit gateway decision; server-owned amounts, idempotency, pending/uncertain states, verified callbacks, reconciliation and refunds before charging |

## 9. Weekly planning and completion rules

1. Start the week with a reviewed [feature brief](../briefs/_template.md), named acceptance scenarios
   and resolved prerequisite decisions. Carry unfinished work forward before starting optional work.
2. Implement feature tests first, then unit code, then real-system E2E. Shared TS/C# rules change
   through shared fixtures; build/typecheck/content and delivery-budget gates remain mandatory.
3. Update architecture/schema diagrams and ADRs for architectural changes. Update product decisions
   in the source of truth and statuses in the register; this schedule does not replace either.
4. Close with a demonstration, exact tested revision/artifact and remaining risks. A rule written,
   a mocked flow or a passing core test is not a shipped user experience.
5. Keep one main engineering stream. If a week slips, move its dependent weeks or obtain an explicit
   scope/capacity decision. Do not weaken a gate, hide skipped tests or spend contingency on extras.
6. Review actual capacity and contractor dependencies each week. At W2, W5 and W11 publish an updated
   forecast, with explicit reasons for movement.

**Next action:** finish/review the current baseline, approve the W2 brief and obtain D4; start the
bounded Tier B spike and external dependency work. Do not restart already implemented fixes.
