/**
 * Architecture rule (ADR-0004, CLAUDE.md §3): a new country is a content drop. Never branch code on
 * a pack id, grade, subject or country.
 *
 * Findings register P9 / CR36: the 2D map highlighted the home country from a table of three
 * countries written into the component, so a Rwanda pack could not highlight Rwanda without a code
 * change. The pack now carries the boundary code the map needs (`countryIsoNumeric`, the ISO 3166-1
 * numeric code that the world atlas uses).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { validatePack, type ContentPack } from "@dunialab/content";
import { isHomeBoundary } from "../../../apps/web/src/lib/map-home.js";
import { feature, scenario } from "../support/gherkin.js";

const kenya = validatePack(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../../packages/content/packs/kenya-explorer.json", import.meta.url)), "utf8")),
).pack!;

feature("A new country's map highlights its home country with no code change", () => {
  scenario("positive control: the Kenya pack highlights Kenya, and only Kenya", async ({ then }) => {
    await then("boundary 404 is home and its neighbours are not", () => {
      expect(isHomeBoundary("404", kenya)).toBe(true);
      expect(isHomeBoundary("834", kenya)).toBe(false); // Tanzania
      expect(isHomeBoundary("800", kenya)).toBe(false); // Uganda
    });
  });

  scenario("a Rwanda pack highlights Rwanda from its own data", async ({ given, when, then }) => {
    let rwanda: ContentPack = kenya;
    let valid = false;
    await given("a pack for Rwanda, a country the code has never heard of", () => {
      rwanda = { ...structuredClone(kenya), id: "rw.g5.sst.rwanda-explorer", country: "RW", countryIsoNumeric: "646" };
    });
    await when("it is validated", () => {
      valid = validatePack(rwanda).ok;
    });
    await then("it is a valid pack and the map treats Rwanda's boundary as home", () => {
      expect(valid).toBe(true);
      expect(isHomeBoundary("646", rwanda)).toBe(true);
      expect(isHomeBoundary(646, rwanda)).toBe(true); // the atlas may give a number
      expect(isHomeBoundary("404", rwanda)).toBe(false);
    });
  });

  scenario("a malformed boundary code is refused at validation", async ({ then }) => {
    await then("only a three-digit code passes", () => {
      expect(validatePack({ ...structuredClone(kenya), countryIsoNumeric: "KE" }).ok).toBe(false);
      expect(validatePack({ ...structuredClone(kenya), countryIsoNumeric: "4040" }).ok).toBe(false);
    });
  });

  scenario("the map component holds no table of countries", async ({ then }) => {
    await then("its source names no country code", () => {
      const source = readFileSync(fileURLToPath(new URL("../../../apps/web/src/components/KenyaMap.tsx", import.meta.url)), "utf8");
      expect(source).not.toMatch(/NUMERIC|"404"|\bKE:|\bTZ:|\bUG:/);
    });
  });
});
