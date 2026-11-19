/**
 * The family phone is shared, so the end of a parent's sign-in must be a clean boundary.
 *
 * Findings register:
 *   S8 - an expired sign-in showed a raw "401" and the app stayed "signed in";
 *   S7 - an answer that arrived after sign-out could put the previous family's data back on screen.
 *
 * Rules: a 401 from a protected call ends the session (signed out, with a clear message); a 401
 * from the sign-in form is just a wrong password; a 403 is a refusal, not a sign-out; anything
 * still in flight from an ended session is dropped.
 */
import { expect } from "vitest";
import { ApiError, DuniaApi } from "../../../apps/web/src/lib/api.js";
import { SessionScope } from "../../../apps/web/src/lib/session.js";
import { feature, scenario } from "../support/gherkin.js";

/** A server that answers every request with the given status. */
const answering = (status: number): typeof fetch =>
  (async () => new Response(JSON.stringify({ message: "nope" }), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

function apiAnswering(status: number) {
  let expired = 0;
  const api = new DuniaApi("http://api.test", () => "a-token", answering(status), 6000, () => expired++);
  return { api, expiredCalls: () => expired };
}

feature("Signing out, or an expired sign-in, is a clean boundary on a shared phone", () => {
  scenario("when the server says the sign-in has expired, the app is told so", async ({ given, when, then, and }) => {
    const { api, expiredCalls } = apiAnswering(401);
    let error: unknown;
    await given("a parent whose sign-in has expired on the server", () => {});
    await when("the app loads the family's children", async () => {
      error = await api.profiles().catch((e) => e);
    });
    await then("the app's session-expired handler runs, so it can sign out and explain", () => expect(expiredCalls()).toBe(1));
    await and("the request still fails as a 401, so nothing pretends it worked", () => {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(401);
    });
  });

  scenario("a wrong password at sign-in is not an expired session", async ({ when, then }) => {
    const { api, expiredCalls } = apiAnswering(401);
    await when("a parent types the wrong password", async () => {
      await api.login("parent@example.com", "wrong password!").catch(() => {});
      await api.register("parent@example.com", "wrong password!").catch(() => {});
    });
    await then("the session handler does not run; the form shows the error instead", () => expect(expiredCalls()).toBe(0));
  });

  scenario("a refusal (403) does not sign anyone out", async ({ when, then }) => {
    const { api, expiredCalls } = apiAnswering(403);
    await when("the server refuses a request the parent is not allowed to make", async () => {
      await api.consent("2026-11").catch(() => {});
    });
    await then("the parent stays signed in", () => expect(expiredCalls()).toBe(0));
  });

  scenario("an answer that arrives after sign-out is dropped", async ({ given, when, then, and }) => {
    const session = new SessionScope();
    const shown: string[] = [];
    let lateAnswer: (names: string) => void = () => {};
    await given("a request for the family's children made while signed in", () => {
      lateAnswer = session.guard((names: string) => shown.push(names));
    });
    await and("positive control: an answer in the same session is shown", () => {
      session.guard((names: string) => shown.push(names))("Amani");
      expect(shown).toEqual(["Amani"]);
    });
    await when("the parent signs out before the answer arrives", () => session.end());
    await then("the late answer does not reach the screen", () => {
      lateAnswer("Amani, Baraka");
      expect(shown).toEqual(["Amani"]);
    });
  });
});
