/**
 * Findings register S9: sign-up and sign-in had no rate limiting, so a password could be guessed
 * without limit. The limits must stop guessing without locking out a whole school: many parents
 * may sign in from one school network (one address), so the per-address limit is generous and the
 * tight limit is per account. Ordinary reads are never limited.
 *
 * These scenarios use the production limits (DEFAULT_RATE_LIMITS) and a controllable clock.
 */
import { afterEach, expect } from "vitest";
import { DEFAULT_RATE_LIMITS } from "@dunialab/api";
import { startApi, type TestApi } from "../support/api.js";
import { feature, scenario } from "../support/gherkin.js";

const PASSWORD = "a long enough password";
let api: TestApi | undefined;
afterEach(async () => api?.close());

/** An API with the real limits and a clock the test moves forward. */
async function apiWithClock() {
  let now = Date.UTC(2027, 0, 11, 6, 0, 0);
  api = await startApi({ rateLimits: DEFAULT_RATE_LIMITS, now: () => now });
  return { api, advance: (ms: number) => (now += ms) };
}

async function register(a: TestApi, email: string) {
  return a.call("POST", "/v1/auth/register", { email, password: PASSWORD });
}
const login = (a: TestApi, email: string, password = PASSWORD) => a.call("POST", "/v1/auth/login", { email, password });

feature("Password guessing is stopped without locking out a school", () => {
  scenario("after too many wrong passwords, even the right one is refused for a while", async ({ given, when, then, and }) => {
    const { api } = await apiWithClock();
    await given("a parent account", async () => {
      expect((await register(api, "wanjiru@example.com")).status).toBe(201);
    });
    await and("positive control: the right password works", async () => {
      expect((await login(api, "wanjiru@example.com")).status).toBe(200);
    });
    await when("someone tries wrong passwords up to the limit", async () => {
      for (let i = 0; i < DEFAULT_RATE_LIMITS.loginFailuresPerAccount.max; i++) {
        expect((await login(api, "wanjiru@example.com", `wrong password ${i}`)).status).toBe(401);
      }
    });
    await then("the next attempt is refused with 429, even with the right password", async () => {
      const r = await login(api, "wanjiru@example.com");
      expect(r.status).toBe(429);
    });
  });

  scenario("the refusal ends when the time window has passed", async ({ given, when, then }) => {
    const { api, advance } = await apiWithClock();
    await given("an account locked by wrong passwords", async () => {
      await register(api, "otieno@example.com");
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.loginFailuresPerAccount.max; i++) await login(api, "otieno@example.com", "wrong password!");
      expect((await login(api, "otieno@example.com")).status).toBe(429);
    });
    await when("the window passes", () => advance(DEFAULT_RATE_LIMITS.loginFailuresPerAccount.windowMs + 1000));
    await then("the right password works again", async () => expect((await login(api, "otieno@example.com")).status).toBe(200));
  });

  scenario("one locked account does not lock anyone else out", async ({ given, when, then }) => {
    const { api } = await apiWithClock();
    await given("two families on the same network", async () => {
      await register(api, "a@example.com");
      await register(api, "b@example.com");
    });
    await when("someone guesses at family A's password until it locks", async () => {
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.loginFailuresPerAccount.max; i++) await login(api, "a@example.com", "wrong password!");
    });
    await then("family B still signs in normally", async () => expect((await login(api, "b@example.com")).status).toBe(200));
  });

  scenario("a school network with many parents signing in is not blocked", async ({ given, when, then, and }) => {
    const { api, advance } = await apiWithClock();
    const parents = 20;
    await given(`${parents} parents with accounts, registered over a few days from the school's one address`, async () => {
      for (let i = 0; i < parents; i++) {
        expect((await register(api, `parent${i}@school.example`)).status).toBe(201);
        if ((i + 1) % DEFAULT_RATE_LIMITS.registrationsPerAddress.max === 0) advance(DEFAULT_RATE_LIMITS.registrationsPerAddress.windowMs + 1000);
      }
    });
    await when("they all sign in at the start of the day from that address", async () => {
      for (let i = 0; i < parents; i++) expect((await login(api, `parent${i}@school.example`)).status).toBe(200);
    });
    await then("everyone got in", () => {});
    await and("only a flood beyond the address limit is refused", async () => {
      const left = DEFAULT_RATE_LIMITS.loginAttemptsPerAddress.max - parents;
      for (let i = 0; i < left; i++) await login(api, `parent${i % parents}@school.example`);
      expect((await login(api, "parent0@school.example")).status).toBe(429);
    });
  }, { timeout: 60_000 }); // about 50 real password hashes

  scenario("mass sign-ups from one address are slowed down", async ({ when, then }) => {
    const { api } = await apiWithClock();
    const statuses: number[] = [];
    await when("one address creates accounts one after another", async () => {
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.registrationsPerAddress.max; i++) statuses.push((await register(api, `bulk${i}@example.com`)).status);
    });
    await then("accounts up to the limit are created, and the next is refused with 429", () => {
      expect(statuses.slice(0, -1).every((s) => s === 201)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    });
  });

  scenario("ordinary reads are never limited", async ({ when, then }) => {
    const { api } = await apiWithClock();
    const statuses: number[] = [];
    await when("the app reads the catalogue many times", async () => {
      for (let i = 0; i < 100; i++) statuses.push((await api.call("GET", "/v1/catalog")).status);
    });
    await then("every read succeeds", () => expect(statuses.every((s) => s === 200)).toBe(true));
  });
});
