/**
 * E2E (tooling): tests run from a Windows terminal whose folder has a lower-case drive
 * letter (`c:\dev\...`), which is how VS Code opens its terminal.
 *
 * Without scripts/vitest.mjs, Vitest is loaded twice there (once as c:\, once as C:\) and
 * every test fails with "Vitest failed to find the runner". This test starts the real
 * launcher exactly as npm does from such a folder and expects a real feature test to pass.
 * It also runs Vitest the old, direct way as a control, and reports whether the underlying
 * problem still exists (if it no longer does, the launcher can be retired).
 *
 * Windows only: drive letters do not exist elsewhere, so the suite is skipped on CI (Linux).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/[\\/]$/, "");
const lowerDrive = (p: string) => p.replace(/^[A-Za-z]:/, (d) => d.toLowerCase());
const SMALL_FEATURE = "tests/features/content/3d-data-budget.feature.test.ts";
const ARGS = ["run", "--project", "features", SMALL_FEATURE];

function run(entry: string) {
  const result = spawnSync(process.execPath, [entry, ...ARGS], { cwd: lowerDrive(ROOT), encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe.skipIf(process.platform !== "win32")("E2E (tooling): tests run from a lower-case drive-letter folder", () => {
  it("passes through scripts/vitest.mjs when started from c:\\...", () => {
    const viaLauncher = run(lowerDrive(`${ROOT}\\scripts\\vitest.mjs`));
    expect(viaLauncher.output).not.toMatch(/failed to find the runner|reading 'config'/);
    expect(viaLauncher.output).toMatch(/Tests\s+4 passed/);
    expect(viaLauncher.status).toBe(0);
  }, 120_000);

  it("control: starting Vitest directly through a lower-case path shows whether the problem still exists", () => {
    const direct = run(lowerDrive(`${ROOT}\\node_modules\\vitest\\vitest.mjs`));
    const stillBroken = direct.status !== 0;
    console.info(
      stillBroken
        ? "[vitest-launcher] control failed as expected: the launcher is still needed."
        : "[vitest-launcher] control PASSED: Vitest no longer double-loads; scripts/vitest.mjs can be retired.",
    );
    // Informational only: an upstream fix must not break our build.
    expect(typeof stillBroken).toBe("boolean");
  }, 120_000);
});
