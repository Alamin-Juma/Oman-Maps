/**
 * Every content pack in packages/content/packs is bundled at build time, so Tier C works
 * offline and a new pack appears in the web app with no code change (ADR-0004).
 */
import { validatePack, type ContentPack, type LocalizedText, type Locale } from "@dunialab/content";

const modules = import.meta.glob<{ default: unknown }>("../../../../packages/content/packs/*.json", { eager: true });

export const PACKS: ContentPack[] = Object.values(modules)
  .map((m) => validatePack(m.default))
  .filter((r) => r.ok)
  .map((r) => r.pack!)
  .sort((a, b) => a.grade - b.grade || a.id.localeCompare(b.id));

export const t = (text: LocalizedText, locale: Locale) => text[locale];
