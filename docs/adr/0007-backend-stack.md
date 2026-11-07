# 0007. Backend stack

- **Status:** Accepted
- **Date:** 2026-11-07

## Decision
| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 LTS, ESM everywhere | Matches the dev machine; one module system across packages, API and web |
| Language | TypeScript 7 (native compiler), `strict`, `noUncheckedIndexedAccess` | Fast builds; strictness catches the bugs that hurt children's trust |
| Framework | NestJS 12 | Named in the product definition; DI makes ports/adapters explicit |
| DI style | Explicit `@Inject(TOKEN)` everywhere | Does not depend on decorator type metadata; refactor-safe |
| Validation | zod 4, `.strict()` request schemas | One schema language for content packs and HTTP; unknown fields (e.g. `dateOfBirth`) are rejected |
| Database | PostgreSQL 17 | Named in the product definition; JSON, constraints, mature hosting |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL migrations in `apps/api/drizzle`) | Thin, typed, SQL-first; no codegen step at runtime |
| Passwords / PINs | Node `crypto.scrypt` | Memory-hard, no native addon to build |
| Auth | JWT (parent tokens, 30 days) | Simple for the MVP. Device-bound child sessions and refresh tokens before scale |
| Tests | Vitest 5 | Fast, ESM-native, one runner for features, unit and E2E |
| Packaging | Docker (`docker/api.Dockerfile`, Debian slim) | TS 7 ships glibc binaries; same image locally and in production |

## Consequences
- Dev loop: `npm run db:up && npm run dev:api`.
- Hosting choice (region, data residency for Kenyan children's data) is open and needs the data protection lawyer's input.
