/**
 * Which boundary on the 2D basemap is the pack's home country (findings register P9, CR36).
 *
 * The world atlas names countries by their ISO 3166-1 numeric code. The pack carries that code
 * (`countryIsoNumeric`), so a new country needs a content drop, never an edit here. A pack without
 * the code highlights nothing rather than guessing.
 */
import type { ContentPack } from "@dunialab/content";

export function isHomeBoundary(boundaryId: string | number | undefined, pack: Pick<ContentPack, "countryIsoNumeric">): boolean {
  return pack.countryIsoNumeric !== undefined && boundaryId !== undefined && String(boundaryId) === pack.countryIsoNumeric;
}
