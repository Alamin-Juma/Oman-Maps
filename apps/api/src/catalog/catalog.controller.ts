import { Controller, Get, Inject, NotFoundException, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { parse } from "../common/zod.js";
import type { ContentRegistry } from "../content/content-registry.js";
import type { Store } from "../store/store.js";
import { CONTENT, STORE } from "../tokens.js";

const CatalogQuery = z.object({
  country: z.string().length(2).optional(),
  grade: z.coerce.number().int().min(1).max(12).optional(),
  subject: z.string().optional(),
});

/** Public: lists content packs. A new pack appears here with no code change. */
@Controller()
export class CatalogController {
  constructor(
    @Inject(CONTENT) private readonly content: ContentRegistry,
    @Inject(STORE) private readonly store: Store,
  ) {}

  @Get("v1/catalog")
  catalog(@Query() query: unknown) {
    return this.content.catalog(parse(CatalogQuery, query));
  }

  /** Full pack JSON for clients (web Tier C; Unity uses Addressables bundles of the same file). */
  @Get("v1/packs/:id")
  pack(@Param("id") id: string) {
    const loaded = this.content.get(id);
    if (!loaded) throw new NotFoundException("pack not found");
    return loaded.pack;
  }

  @Get("health")
  health() {
    return { status: "ok", store: this.store.kind, packs: this.content.size };
  }
}
