/**
 * E2E (tooling): the E2E harness itself (tests/e2e/support/server.ts) must not leak a password,
 * hang on a stalled server, or hang on a server that already died (findings register CR14, CR53, CR54).
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { stopChild, waitForHealth, withoutPassword } from "../support/server.js";

const SECRET = "s3cret-pw-must-not-print";

describe("E2E harness", () => {
  it("never prints a password, whether in the user part or as ?password= (CR14)", () => {
    expect(withoutPassword(`postgres://nobody:${SECRET}@127.0.0.1:5433/db`)).not.toContain(SECRET);
    const queryForm = withoutPassword(`postgres://nobody@127.0.0.1:5433/db?password=${SECRET}&sslmode=disable`);
    expect(queryForm).not.toContain(SECRET);
    expect(queryForm).toContain("127.0.0.1"); // positive control: still names the database
    expect(queryForm).toContain("sslmode=disable");
  });

  it("gives up on a server that accepts the connection but never answers, on time (CR54)", async () => {
    const stalled: Server = createServer(() => {
      /* never respond */
    });
    await new Promise<void>((r) => stalled.listen(0, "127.0.0.1", r));
    const { port } = stalled.address() as { port: number };
    const started = Date.now();
    try {
      await expect(waitForHealth(`http://127.0.0.1:${port}`, 1500)).rejects.toThrow(/did not become healthy/);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      stalled.closeAllConnections();
      stalled.close();
    }
  });

  it("stops at once when the server has already died from a signal (CR53)", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await new Promise((r) => child.once("spawn", r));
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await exited;
    const started = Date.now();
    await stopChild(child);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("positive control: stops a live server and waits for it to exit", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await new Promise((r) => child.once("spawn", r));
    await stopChild(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});
