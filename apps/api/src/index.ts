/** Public surface of the API package (used by tests and future tooling). */
export { createApp, type CreateAppOptions } from "./app.factory.js";
export { loadConfig, CONFIG_DEFAULTS, DEFAULT_RATE_LIMITS, type AppConfig, type RateLimits } from "./config.js";
export { AttemptLimiter, type LimitRule } from "./auth/attempt-limiter.js";
export { InMemoryStore } from "./store/memory.store.js";
export { PostgresStore } from "./store/postgres.store.js";
export type { Store } from "./store/store.js";
export { ContentRegistry } from "./content/content-registry.js";
export { ClaudeGrader } from "./explanations/claude.grader.js";
export { decideFeedback } from "./explanations/decide.js";
export type { AiGrade, AiGrader, AiGradeInput } from "./explanations/ai-grader.js";
export { runMigrations } from "./db/migrate.js";
