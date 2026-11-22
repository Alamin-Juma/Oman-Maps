/**
 * E2E harness. Two modes:
 *  1. E2E_API_URL is set  -> test an already-running API (e.g. the Docker image:
 *     `docker compose --profile app up -d --build`, then E2E_API_URL=http://localhost:3000).
 *  2. otherwise           -> spawn the BUILT server (apps/api/dist/main.js) against
 *     DATABASE_URL (default: the docker compose Postgres on :5433).
 * If Postgres is unreachable:
 *  - locally, the suite is SKIPPED and says so on stderr (nobody needs Docker for a quick check);
 *  - with E2E_REQUIRE_DB=1 (set in CI), the run FAILS. A skip reads as a pass in every summary,
 *    and the skipped tests are the ones proving strangers are refused (findings register T1).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://dunialab:dunialab@localhost:5433/dunialab";
const MAIN = fileURLToPath(new URL("../../../apps/api/dist/main.js", import.meta.url));

export async function databaseReachable(): Promise<boolean> {
  if (process.env.E2E_API_URL) return true;
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    const where = `Postgres not reachable at ${withoutPassword(DATABASE_URL)}`;
    if (process.env.E2E_REQUIRE_DB === "1") {
      throw new Error(`[e2e] ${where}, and E2E_REQUIRE_DB=1 requires it: failing instead of skipping.`);
    }
    // stderr, not console.warn: Vitest drops console output from a file whose tests all skip,
    // which made this skip invisible.
    process.stderr.write(`[e2e] ${where}; run \`npm run db:up\`. Skipping E2E (set E2E_REQUIRE_DB=1 to fail instead).\n`);
    return false;
  }
}

/**
 * A database address safe to print: the password is replaced (findings register T7), including a
 * password given as a query parameter, which the pg driver also accepts (CR14).
 */
export function withoutPassword(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    for (const key of [...parsed.searchParams.keys()]) if (key.toLowerCase() === "password") parsed.searchParams.set(key, "***");
    return parsed.toString();
  } catch {
    return "<unparseable database address>";
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export interface RunningApi {
  url: string;
  /** Restart the server process (only in spawn mode). Proves state lives in Postgres. */
  restart?: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Poll /health until it answers or `ms` pass. Each request carries the remaining time as its own
 * deadline, so a server that accepts the connection and never answers cannot hold the loop (CR54).
 */
export async function waitForHealth(url: string, ms = 20_000) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(Math.max(1, until - Date.now())) });
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`API did not become healthy at ${url}: ${last}`);
}

/**
 * Stop a child process and wait for it to exit. A child that already exited, normally OR from a
 * signal (then `exitCode` stays null and `signalCode` is set), is done: waiting for its "exit"
 * event, which has already fired, would hang forever (findings register CR53).
 */
export async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill();
  await exited;
}

export async function startApi(): Promise<RunningApi> {
  if (process.env.E2E_API_URL) {
    const url = process.env.E2E_API_URL.replace(/\/$/, "");
    await waitForHealth(url);
    return { url, stop: async () => {} };
  }

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let output = "";

  const launch = async () => {
    output = "";
    child = spawn(process.execPath, [MAIN], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        DATABASE_URL,
        JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123",
        ANTHROPIC_API_KEY: "", // E2E never calls a paid model; the offline checker answers.
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    try {
      await waitForHealth(url);
    } catch (e) {
      child.kill();
      throw new Error(`${(e as Error).message}\n--- server output ---\n${output}`);
    }
  };

  const stop = async () => {
    if (child) await stopChild(child);
  };

  await launch();
  return { url, restart: async () => (await stop(), await launch()), stop };
}

export async function call<T = any>(base: string, method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}
