#!/usr/bin/env node
/**
 * Vitest launcher. Every test script in this repo goes through it.
 *
 * Why: on Windows a terminal can sit in `c:\dev\...` (lower-case drive letter; VS Code does
 * this). npm then starts Vitest through a lower-case path, Node loads Vitest's files as
 * `file:///c:/...`, but Vite resolves the same files to their true case `file:///C:/...` for
 * the tests. Vitest ends up loaded twice and every test fails with
 * "Vitest failed to find the runner" / "Cannot read properties of undefined (reading 'config')".
 *
 * Fix: start Vitest's entry file through its true-case path, from the true-case working
 * directory. `realpathSync.native` asks the operating system for the real spelling.
 * On Linux and macOS this changes nothing.
 *
 * Usage: node scripts/vitest.mjs run --project features    (same arguments as `vitest`)
 * Proof: tests/e2e/tooling/vitest-launcher.e2e.test.ts
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const cwd = realpathSync.native(process.cwd());
const entry = realpathSync.native(join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"));

const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { cwd, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
