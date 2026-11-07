import { Logger } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { ClaudeGrader } from "./explanations/claude.grader.js";
import { InMemoryStore } from "./store/memory.store.js";
import { PostgresStore } from "./store/postgres.store.js";

const log = new Logger("Bootstrap");
const config = loadConfig();

let store;
if (config.databaseUrl) {
  await runMigrations(config.databaseUrl);
  store = new PostgresStore(config.databaseUrl);
} else {
  log.warn("DATABASE_URL not set: using the IN-MEMORY store. Data is lost on restart.");
  store = new InMemoryStore();
}

const aiGrader = config.aiEnabled ? new ClaudeGrader({ model: config.aiModel, timeoutMs: config.aiTimeoutMs }) : null;
if (!aiGrader) log.warn("ANTHROPIC_API_KEY not set: explanation checks use the offline rubric checker only.");

const app = await createApp({ config, store, aiGrader });
await app.listen(config.port, "0.0.0.0");
log.log(`DuniaLab API on :${config.port} (store=${store.kind}, ai=${aiGrader ? config.aiModel : "off"})`);
