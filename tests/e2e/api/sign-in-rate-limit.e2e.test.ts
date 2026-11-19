/**
 * E2E: the real server process (built API, real Postgres, production limits from loadConfig)
 * refuses password guessing with 429 and tells the client when to retry (findings register S9).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, databaseReachable, startApi, type RunningApi } from "../support/server.js";

const reachable = await databaseReachable();

describe.skipIf(!reachable)("E2E: sign-in is rate limited on the real server", () => {
  let api: RunningApi;
  const email = `e2e-${randomUUID()}@example.com`;
  const password = "a long enough password";
  const login = (pw: string) =>
    fetch(`${api.url}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: pw }) });

  beforeAll(async () => {
    api = await startApi();
    expect((await call(api.url, "POST", "/v1/auth/register", { email, password })).status).toBe(201);
  }, 120_000);
  afterAll(async () => api?.stop());

  it("positive control: the right password signs in", async () => {
    expect((await login(password)).status).toBe(200);
  });

  it("five wrong passwords, then the account is refused with 429 and a Retry-After", async () => {
    for (let i = 0; i < 5; i++) expect((await login(`wrong password ${i}`)).status).toBe(401);
    const refused = await login(password);
    expect(refused.status).toBe(429);
    const retryAfter = Number(refused.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
  });
});
