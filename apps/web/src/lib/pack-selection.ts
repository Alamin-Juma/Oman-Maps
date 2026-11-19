/**
 * Which content packs the web app offers (findings register S1).
 *
 * Product rule: only `review.status = "approved"` packs ship to children in production. The API
 * already enforces this; the web app bundles packs at build time, so it must enforce it too.
 * Pure, so it is tested without a build.
 */
import type { ContentPack } from "@dunialab/content";

export interface PackSelectionOptions {
  /** A production build (`import.meta.env.PROD`). */
  production: boolean;
  /**
   * Explicitly allow unapproved packs in a production build (`VITE_ALLOW_DRAFT_CONTENT=true`),
   * for pilot rehearsals and tests. Mirrors the API's `ALLOW_DRAFT_CONTENT`.
   */
  allowDraft: boolean;
}

export interface PackSelection {
  /** Packs to offer, by grade then id. */
  packs: ContentPack[];
  /** Ids of valid packs held back because they are not approved. */
  withheld: string[];
  /** True when at least one offered pack is not approved, so the app must label it. */
  showingDrafts: boolean;
}

export function selectPacks(all: readonly ContentPack[], options: PackSelectionOptions): PackSelection {
  const draftsAllowed = !options.production || options.allowDraft;
  const packs: ContentPack[] = [];
  const withheld: string[] = [];
  for (const pack of all) {
    if (pack.review.status === "approved" || draftsAllowed) packs.push(pack);
    else withheld.push(pack.id);
  }
  packs.sort((a, b) => a.grade - b.grade || a.id.localeCompare(b.id, "en"));
  return { packs, withheld, showingDrafts: packs.some((p) => p.review.status !== "approved") };
}
