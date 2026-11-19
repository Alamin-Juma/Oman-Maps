import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  /** If absent, the API runs on the in-memory store (dev only; refused in production). */
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32).optional(),
  /** If absent, explanation checks use the offline rubric checker only. */
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  CONSENT_POLICY_VERSION: z.string().default("2026-11"),
  PACKS_DIR: z.string().optional(),
  UTC_OFFSET_MINUTES: z.coerce.number().int().default(180),
  /** Explicit override for local/staging E2E. Never set this in real production. */
  ALLOW_DRAFT_CONTENT: z.enum(["true", "false"]).optional(),
  /**
   * Set when the API runs behind a reverse proxy, so rate limits see each visitor's address rather
   * than the proxy's (Express "trust proxy": a hop count such as 1, or "true"). Unset by default.
   */
  TRUST_PROXY: z.string().optional(),
});

export interface RateLimits {
  /** Wrong passwords per account before sign-in is refused for a while. */
  loginFailuresPerAccount: { max: number; windowMs: number };
  /** Sign-in attempts per network address. Generous: a whole school may share one address. */
  loginAttemptsPerAddress: { max: number; windowMs: number };
  /** New accounts per network address. */
  registrationsPerAddress: { max: number; windowMs: number };
}

const MINUTE = 60_000;

/** Production limits (findings register S9). */
export const DEFAULT_RATE_LIMITS: RateLimits = {
  loginFailuresPerAccount: { max: 5, windowMs: 15 * MINUTE },
  loginAttemptsPerAddress: { max: 30, windowMs: 15 * MINUTE },
  registrationsPerAddress: { max: 10, windowMs: 60 * MINUTE },
};

export interface AppConfig {
  env: "development" | "test" | "production";
  port: number;
  databaseUrl?: string;
  jwtSecret: string;
  aiEnabled: boolean;
  aiModel: string;
  aiConfidenceThreshold: number;
  aiTimeoutMs: number;
  consentPolicyVersion: string;
  packsDir?: string;
  utcOffsetMinutes: number;
  /** Draft (not teacher-approved) packs may be served only outside production. */
  allowDraftContent: boolean;
  rateLimits: RateLimits;
  /** Express "trust proxy" setting; undefined = do not trust forwarded addresses. */
  trustProxy?: string | number | boolean;
}

const DEV_JWT_SECRET = "dev-only-secret-change-me-dev-only-secret";

export const CONFIG_DEFAULTS: AppConfig = {
  env: "development",
  port: 3000,
  jwtSecret: DEV_JWT_SECRET,
  aiEnabled: false,
  aiModel: "claude-opus-5-5",
  aiConfidenceThreshold: 0.75,
  aiTimeoutMs: 8000,
  consentPolicyVersion: "2026-11",
  utcOffsetMinutes: 180,
  allowDraftContent: true,
  rateLimits: DEFAULT_RATE_LIMITS,
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = Env.parse(env);
  const production = e.NODE_ENV === "production";
  // Real data => real secret. The public dev secret is only for in-memory, local-only runs.
  if ((production || e.DATABASE_URL) && !e.JWT_SECRET) {
    throw new Error("JWT_SECRET (>= 32 chars) is required in production or whenever DATABASE_URL is set");
  }
  if (production && !e.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    ...(e.DATABASE_URL ? { databaseUrl: e.DATABASE_URL } : {}),
    jwtSecret: e.JWT_SECRET ?? DEV_JWT_SECRET,
    aiEnabled: Boolean(e.ANTHROPIC_API_KEY),
    aiModel: e.AI_MODEL,
    aiConfidenceThreshold: e.AI_CONFIDENCE_THRESHOLD,
    aiTimeoutMs: e.AI_TIMEOUT_MS,
    consentPolicyVersion: e.CONSENT_POLICY_VERSION,
    ...(e.PACKS_DIR ? { packsDir: e.PACKS_DIR } : {}),
    utcOffsetMinutes: e.UTC_OFFSET_MINUTES,
    allowDraftContent: e.ALLOW_DRAFT_CONTENT ? e.ALLOW_DRAFT_CONTENT === "true" : !production,
    rateLimits: DEFAULT_RATE_LIMITS,
    ...(e.TRUST_PROXY ? { trustProxy: parseTrustProxy(e.TRUST_PROXY) } : {}),
  };
}

function parseTrustProxy(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}
