# Manual test guides

Automated tests prove the pieces; a person clicking proves the product. Every serious bug in the
earlier project these practices come from was found by someone clicking after a green test suite.

**Rules:**
- A guide is written **after code review**, from what shipped, not from the brief. By then you know
  which shortcuts were taken and which findings were declined; those are where a tester should look.
- One guide per feature: `NN-feature.md`, copied from [`_template.md`](_template.md).
- One standing walkthrough, `00-walkthrough.md`: one child from guest play to the parent's report and
  the 3D view. Run it before every release and every demo. *(To be written next, from the running app;
  findings register E5.)*
- The person testing starts the app themselves, and stops it afterwards.

## The kinds of "nothing on screen", and how to tell them apart

Telling these apart is the most useful thing a tester can report.

| What you see | What it means | How to tell |
|---|---|---|
| A refusal message, **no retry button** | **Refused.** The rule is working | You are signed in as someone not allowed to see it |
| An error message **with a retry button** | **Failed.** A request did not complete | Retry sometimes works; the API log has the error |
| "Nothing here yet" plus what makes something appear | **Genuinely empty.** The load worked | The count shows `0`, not `—` |
| "Not saved on this phone" | **Storage failed.** Progress is only in memory | Private browsing, or a full phone |
| A refusal for something you know you are allowed | **Possibly a stale server.** An old process is still answering | Check for a leftover API process on port 3000 and restart it from the current build. Do not change code to work around it |

## Accounts and setup

There are no fixed test accounts. Create a parent account in the app; use made-up names only, never a
real child's. Use separate browsers (not tabs) to act as two different families, because tabs share
one sign-in.
