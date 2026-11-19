/**
 * E2E (tooling): database-backed tests FAIL, not skip, when the database is required.
 *
 * Locally, the database E2E suites skip with a warning when Postgres is not running, so nobody
 * needs Docker for a quick check. In CI that skip would read as a pass, and the skipped tests are
 * the ones that prove a stranger is refused and a family's data stays theirs (findings register
 * T1). With E2E_REQUIRE_DB=1, which CI sets, a missing database must fail the run.
 *
 * Both directions are tested, so the guard is proven to change the outcome (positive control:
 * without the flag the same run skips and passes).
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LAUNCHER = fileURLToPath(new URL("../../../scripts/vitest.mjs", import.meta.url));
const SUITE = "tests/e2e/api/family-learning-journey.e2e.test.ts";
/** A password that must never be printed. */
const SECRET = "s3cret-pw-must-not-print";

/** A port with nothing listening on it: take a free one, then release it. */
async function deadPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function runSuite(extraEnv: Record<string, string>): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
    delete env.E2E_API_URL; // must exercise the database check, not an external API
    if (!("E2E_REQUIRE_DB" in extraEnv)) delete env.E2E_REQUIRE_DB;
    const child = spawn(process.execPath, [LAUNCHER, "run", "--project", "e2e", SUITE], { cwd: ROOT, env });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output }));
  });
}

describe("E2E (tooling): a missing database fails the run when it is required", () => {
  it("without E2E_REQUIRE_DB, a missing database skips the suite (local convenience)", async () => {
    const port = await deadPort();
    const result = await runSuite({ DATABASE_URL: `postgres://nobody:${SECRET}@127.0.0.1:${port}/none` });
    expect(result.output).toMatch(/Skipping E2E/);
    expect(result.output).not.toContain(SECRET);
    expect(result.output).toMatch(/skipped/i);
    expect(result.status).toBe(0);
  }, 120_000);

  it("with E2E_REQUIRE_DB=1, a missing database fails the run and says why", async () => {
    const port = await deadPort();
    const result = await runSuite({ DATABASE_URL: `postgres://nobody:${SECRET}@127.0.0.1:${port}/none`, E2E_REQUIRE_DB: "1" });
    expect(result.output).toMatch(/E2E_REQUIRE_DB/);
    expect(result.output).toMatch(/not reachable/);
    expect(result.status).not.toBe(0);
    // The message names the database but never its password (findings register T7).
    expect(result.output).toMatch(/127\.0\.0\.1/);
    expect(result.output).not.toContain(SECRET);
  }, 120_000);
});
