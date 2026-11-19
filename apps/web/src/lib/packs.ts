/**
 * Content packs in packages/content/packs are validated and bundled at build time, so Tier C works
 * offline and a new pack appears in the web app with no code change (ADR-0004). An invalid pack fails
 * the build rather than silently disappearing.
 *
 * In a production build only teacher-approved packs are offered (findings register S1), unless the
 * build sets VITE_ALLOW_DRAFT_CONTENT=true, which is for pilot rehearsals and tests and shows the
 * draft banner. See lib/pack-selection.ts.
 */
import type { ContentPack, LocalizedText, Locale } from "@dunialab/content";
// Validated once by the build (vite.config.ts), so the browser does not ship the validator.
import validPacks from "virtual:dunialab-packs";
import { selectPacks } from "./pack-selection.js";

const valid: ContentPack[] = validPacks;

export const PACK_SELECTION = selectPacks(valid, {
  production: import.meta.env.PROD,
  allowDraft: import.meta.env.VITE_ALLOW_DRAFT_CONTENT === "true",
});

export const PACKS: ContentPack[] = PACK_SELECTION.packs;

export const t = (text: LocalizedText, locale: Locale) => text[locale];
