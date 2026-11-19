/** Content packs validated by the build: see validatedPacks() in vite.config.ts. */
declare module "virtual:dunialab-packs" {
  import type { ContentPack } from "@dunialab/content";
  const packs: ContentPack[];
  export default packs;
}
