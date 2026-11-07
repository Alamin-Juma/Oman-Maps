#!/usr/bin/env node
/** Usage: node dist/cli/validate.js <dir-or-file>...  Exits 1 on any issue. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validatePack } from "../validate.js";

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: validate <pack.json | dir>...");
  process.exit(2);
}

const files = targets.flatMap((t) =>
  statSync(t).isDirectory()
    ? readdirSync(t).filter((f) => f.endsWith(".json")).map((f) => join(t, f))
    : [t],
);

let failed = 0;
for (const file of files) {
  const result = validatePack(JSON.parse(readFileSync(file, "utf8")));
  if (result.ok) {
    const p = result.pack!;
    const tasks = p.missions.reduce((n, m) => n + m.tasks.length, 0);
    console.log(
      `ok   ${file}  (${p.id}@${p.version}, ${p.missions.length} missions, ${tasks} tasks, review: ${p.review.status})`,
    );
    if (p.review.status !== "approved") {
      console.log(`     note: not teacher-approved yet; do not ship to children`);
    }
  } else {
    failed++;
    console.error(`FAIL ${file}`);
    for (const i of result.issues) console.error(`     ${i.path}: ${i.message}`);
  }
}
process.exit(failed ? 1 : 0);
