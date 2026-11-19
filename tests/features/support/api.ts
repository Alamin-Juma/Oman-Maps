/**
 * Boots the real Nest application in-process with the in-memory store and a
 * scripted AI grader, so feature tests exercise the public HTTP contract
 * without Docker. E2E tests (tests/e2e) use Postgres and the built server instead.
 */
import { createApp, InMemoryStore, type AiGrader, type RateLimits } from "@dunialab/api";

/**
 * Feature tests register many parents from one address (127.0.0.1). Unless a test is ABOUT rate
 * limits (it then passes the real DEFAULT_RATE_LIMITS), use limits no test reaches.
 */
const UNREACHED = { max: 1_000_000, windowMs: 60_000 };
const NO_PRACTICAL_LIMITS: RateLimits = {
  loginFailuresPerAccount: UNREACHED,
  loginAttemptsPerAddress: UNREACHED,
  registrationsPerAddress: UNREACHED,
};

export interface TestApi {
  url: string;
  close: () => Promise<void>;
  call: <T = any>(method: string, path: string, body?: unknown, token?: string) => Promise<{ status: number; body: T }>;
}

export async function startApi(
  opts: { aiGrader?: AiGrader; packsDir?: string; rateLimits?: RateLimits; now?: () => number } = {},
): Promise<TestApi> {
  const app = await createApp({
    config: {
      jwtSecret: "test-secret-test-secret-test-secret",
      aiConfidenceThreshold: 0.75,
      utcOffsetMinutes: 180,
      rateLimits: opts.rateLimits ?? NO_PRACTICAL_LIMITS,
    },
    ...(opts.now ? { now: opts.now } : {}),
    store: new InMemoryStore(),
    ...(opts.packsDir ? { packsDir: opts.packsDir } : {}),
    aiGrader: opts.aiGrader ?? null,
    logger: false,
  });
  await app.listen(0, "127.0.0.1");
  const url = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  return {
    url,
    close: () => app.close(),
    call: async (method, path, body, token) => {
      const res = await fetch(`${url}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined };
    },
  };
}

/** Register a parent who has accepted the current consent policy; return their token. */
export async function consentedParentToken(api: TestApi) {
  const token = await parentToken(api);
  const c = await api.call("POST", "/v1/consents", { policyVersion: "2026-11", accepted: true }, token);
  if (c.status !== 201) throw new Error(`consent failed: ${c.status}`);
  return token;
}

/** Register a parent and return their token. */
export async function parentToken(api: TestApi, email = `parent-${Math.random().toString(36).slice(2)}@example.com`) {
  const r = await api.call<{ token: string }>("POST", "/v1/auth/register", { email, password: "correct horse battery" });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}
