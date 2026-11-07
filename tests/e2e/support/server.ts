/**
 * E2E harness. Two modes:
 *  1. E2E_API_URL is set  -> test an already-running API (e.g. the Docker image:
 *     `docker compose --profile app up -d --build`, then E2E_API_URL=http://localhost:3000).
 *  2. otherwise           -> spawn the BUILT server (apps/api/dist/main.js) against
 *     DATABASE_URL (default: the docker compose Postgres on :5433).
 * If Postgres is unreachable the suite is skipped with a clear message (CI always provides it).
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
    console.warn(`[e2e] Postgres not reachable at ${DATABASE_URL}; run \`npm run db:up\`. Skipping E2E.`);
    return false;
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

async function waitForHealth(url: string, ms = 20_000) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`API did not become healthy at ${url}: ${last}`);
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
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((r) => child!.once("exit", r));
    child.kill();
    await exited;
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
