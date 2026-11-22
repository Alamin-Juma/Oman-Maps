/**
 * The build's pack selection: see validatedPacks() in vite.config.ts. Offered packs in full,
 * withheld packs by id only (findings register S1, CR2).
 */
declare module "virtual:dunialab-packs" {
  import type { PackSelection } from "./lib/pack-selection.js";
  const selection: PackSelection;
  export default selection;
}
