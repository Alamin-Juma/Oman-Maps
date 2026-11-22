/**
 * Content packs in packages/content/packs are validated and bundled at build time, so Tier C works
 * offline and a new pack appears in the web app with no code change (ADR-0004). An invalid pack fails
 * the build rather than silently disappearing.
 *
 * In a production build only teacher-approved packs are offered (findings register S1), unless the
 * build sets VITE_ALLOW_DRAFT_CONTENT=true, which is for pilot rehearsals and tests and shows the
 * draft banner. The build makes the choice (lib/pack-selection.ts), so a withheld pack's content is
 * never in the shipped files.
 */
import type { ContentPack, LocalizedText, Locale } from "@dunialab/content";
// Validated and selected once by the build (vite.config.ts): the browser ships neither the
// validator nor the content of packs it does not offer (findings register CR2).
import selection from "virtual:dunialab-packs";
import type { PackSelection } from "./pack-selection.js";

export const PACK_SELECTION: PackSelection = selection;

export const PACKS: ContentPack[] = PACK_SELECTION.packs;

export const t = (text: LocalizedText, locale: Locale) => text[locale];
