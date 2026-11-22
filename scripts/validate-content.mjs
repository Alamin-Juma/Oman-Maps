#!/usr/bin/env node
/**
 * Validate content packs: node scripts/validate-content.mjs <pack.json | dir>...   Exits 1 on any issue.
 *
 * A tool, so it lives outside packages/content, which stays pure: schema and rules only, no files
 * and no command line (CLAUDE.md §3; findings register CR80). Needs `npm run build` first.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validatePack } from "@dunialab/content";

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: validate-content <pack.json | dir>...");
  process.exit(2);
}

const files = targets.flatMap((t) =>
  statSync(t).isDirectory()
    ? readdirSync(t).filter((f) => f.endsWith(".json")).sort().map((f) => join(t, f))
    : [t],
);

let failed = 0;
for (const file of files) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    failed++;
    console.error(`FAIL ${file}\n     not valid JSON: ${e.message}`);
    continue;
  }
  const result = validatePack(raw);
  if (result.ok) {
    const p = result.pack;
    const tasks = p.missions.reduce((n, m) => n + m.tasks.length, 0);
    console.log(`ok   ${file}  (${p.id}@${p.version}, ${p.missions.length} missions, ${tasks} tasks, review: ${p.review.status})`);
    if (p.review.status !== "approved") console.log(`     note: not teacher-approved yet; do not ship to children`);
  } else {
    failed++;
    console.error(`FAIL ${file}`);
    for (const i of result.issues) console.error(`     ${i.path}: ${i.message}`);
  }
}
process.exit(failed ? 1 : 0);
