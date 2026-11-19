/** DI tokens. Explicit tokens (not type metadata) keep wiring obvious and refactor-safe. */
export const CONFIG = Symbol("CONFIG");
export const STORE = Symbol("STORE");
export const AI_GRADER = Symbol("AI_GRADER");
export const CONTENT = Symbol("CONTENT");
export const ATTEMPT_LIMITER = Symbol("ATTEMPT_LIMITER");
