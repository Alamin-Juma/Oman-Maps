/**
 * Composition root. All adapters (store, AI grader, content) are injected here,
 * which is what lets tests, local dev and production run the SAME application
 * code with different infrastructure.
 */
import "reflect-metadata";
import { Logger, Module, type DynamicModule, type INestApplication, type LoggerService, type LogLevel } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SYNC_MAX_EVENTS } from "@dunialab/mastery";
import { JwtModule } from "@nestjs/jwt";
import helmet from "helmet";
import { CONFIG_DEFAULTS, type AppConfig } from "./config.js";
import { AuthController } from "./auth/auth.controller.js";
import { ParentAuthGuard } from "./auth/auth.guard.js";
import { CatalogController } from "./catalog/catalog.controller.js";
import { ContentRegistry } from "./content/content-registry.js";
import { ExplanationsController } from "./explanations/explanations.controller.js";
import type { AiGrader } from "./explanations/ai-grader.js";
import { FamilyController } from "./family/family.controller.js";
import { ProgressController } from "./progress/progress.controller.js";
import type { Store } from "./store/store.js";
import { AttemptLimiter } from "./auth/attempt-limiter.js";
import { AI_GRADER, ATTEMPT_LIMITER, CONFIG, CONTENT, STORE } from "./tokens.js";

export interface CreateAppOptions {
  config?: Partial<AppConfig>;
  store: Store;
  aiGrader: AiGrader | null;
  /** Folder of content-pack JSON files. Defaults to the packs in @dunialab/content. */
  packsDir?: string;
  logger?: false | LoggerService | LogLevel[];
  /** Clock for time windows (rate limits). Tests move it forward; defaults to Date.now. */
  now?: () => number;
}

@Module({})
class AppModule {
  static forRoot(config: AppConfig, store: Store, aiGrader: AiGrader | null, content: ContentRegistry, limiter: AttemptLimiter): DynamicModule {
    return {
      module: AppModule,
      imports: [JwtModule.register({ secret: config.jwtSecret, signOptions: { expiresIn: "30d" } })],
      controllers: [AuthController, FamilyController, ProgressController, ExplanationsController, CatalogController],
      providers: [
        ParentAuthGuard,
        { provide: CONFIG, useValue: config },
        { provide: STORE, useValue: store },
        { provide: AI_GRADER, useValue: aiGrader },
        { provide: CONTENT, useValue: content },
        { provide: ATTEMPT_LIMITER, useValue: limiter },
      ],
    };
  }
}

/**
 * Largest JSON request body accepted. One event is at most about 0.5 kB under the sync schema
 * (ids of at most 100 characters), so 1 kB per event covers a full batch with room to spare,
 * while still refusing absurd payloads early.
 */
export const JSON_BODY_LIMIT_BYTES = SYNC_MAX_EVENTS * 1024;

export async function createApp(opts: CreateAppOptions): Promise<INestApplication> {
  const config: AppConfig = { ...CONFIG_DEFAULTS, ...opts.config };
  const log = new Logger("DuniaLab");
  const content = ContentRegistry.fromDirectory(opts.packsDir ?? config.packsDir ?? ContentRegistry.defaultDirectory(), {
    allowDraft: config.allowDraftContent,
    warn: (m) => log.warn(m),
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, opts.store, opts.aiGrader, content, new AttemptLimiter(opts.now)), {
    logger: opts.logger ?? ["error", "warn", "log"],
    bodyParser: true,
  });
  // The JSON body limit must fit a full sync batch (findings register R7). Express's default
  // (100 kB) was smaller than 500 events, so a full batch failed with 413 before the event count
  // was even checked. Sized from the shared limit, with room for the largest events the schema allows.
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT_BYTES });
  // Behind a reverse proxy, rate limits must see the visitor's address, not the proxy's (S9).
  if (config.trustProxy !== undefined) app.set("trust proxy", config.trustProxy);
  app.use(helmet());
  app.enableCors({ origin: true, credentials: false });
  app.enableShutdownHooks();
  // Close the store with the app (pool connections, etc.).
  const close = app.close.bind(app);
  app.close = async () => {
    await close();
    await opts.store.close();
  };
  return app;
}
