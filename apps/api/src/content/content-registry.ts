/**
 * Content registry: the seam that makes new grades/subjects/countries a
 * CONTENT DROP rather than a code change (ADR-0004).
 *
 * It loads every *.json pack in a folder, validates each one fully, and serves
 * them by id. Nothing else in the API knows which packs exist.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { indexTasks, validatePack, type ContentPack, type TaskRef } from "@dunialab/content";

export interface CatalogEntry {
  id: string;
  version: string;
  title: ContentPack["title"];
  country: string;
  grade: number;
  subject: string;
  reviewStatus: ContentPack["review"]["status"];
  missions: number;
}

interface Loaded {
  pack: ContentPack;
  tasks: Map<string, TaskRef>;
  skillIds: string[];
}

export class ContentRegistry {
  private readonly packs = new Map<string, Loaded>();

  constructor(packs: ContentPack[]) {
    for (const pack of packs) {
      if (this.packs.has(pack.id)) throw new Error(`duplicate content pack id "${pack.id}"`);
      this.packs.set(pack.id, { pack, tasks: indexTasks(pack), skillIds: pack.skills.map((s) => s.id) });
    }
  }

  /** The packs shipped in @dunialab/content. */
  static defaultDirectory(): string {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve("@dunialab/content/packs/kenya-explorer.json"));
  }

  /**
   * Load and validate every pack in `dir`. An invalid pack stops startup:
   * shipping a broken mission to a child is worse than not starting.
   */
  static fromDirectory(dir: string, opts: { allowDraft: boolean; warn?: (m: string) => void }): ContentRegistry {
    const packs: ContentPack[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const result = validatePack(JSON.parse(readFileSync(join(dir, file), "utf8")));
      if (!result.ok) {
        const detail = result.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n");
        throw new Error(`content pack ${file} is invalid:\n${detail}`);
      }
      const pack = result.pack!;
      if (pack.review.status !== "approved" && !opts.allowDraft) {
        opts.warn?.(`skipping ${pack.id}: review status "${pack.review.status}" (only approved packs are served in production)`);
        continue;
      }
      packs.push(pack);
    }
    return new ContentRegistry(packs);
  }

  get size(): number {
    return this.packs.size;
  }

  get(packId: string): Loaded | undefined {
    return this.packs.get(packId);
  }

  catalog(filter: { country?: string; grade?: number; subject?: string } = {}): CatalogEntry[] {
    return [...this.packs.values()]
      .map(({ pack }) => pack)
      .filter(
        (p) =>
          (!filter.country || p.country === filter.country.toUpperCase()) &&
          (filter.grade === undefined || p.grade === filter.grade) &&
          (!filter.subject || p.subject.toLowerCase() === filter.subject.toLowerCase()),
      )
      .sort((a, b) => a.country.localeCompare(b.country) || a.grade - b.grade || a.id.localeCompare(b.id))
      .map((p) => ({
        id: p.id,
        version: p.version,
        title: p.title,
        country: p.country,
        grade: p.grade,
        subject: p.subject,
        reviewStatus: p.review.status,
        missions: p.missions.length,
      }));
  }
}
