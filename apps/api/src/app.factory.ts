/**
 * Composition root. All adapters (store, AI grader, content) are injected here,
 * which is what lets tests, local dev and production run the SAME application
 * code with different infrastructure.
 */
import "reflect-metadata";
import { Logger, Module, type DynamicModule, type INestApplication, type LoggerService, type LogLevel } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
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
import { AI_GRADER, CONFIG, CONTENT, STORE } from "./tokens.js";

export interface CreateAppOptions {
  config?: Partial<AppConfig>;
  store: Store;
  aiGrader: AiGrader | null;
  /** Folder of content-pack JSON files. Defaults to the packs in @dunialab/content. */
  packsDir?: string;
  logger?: false | LoggerService | LogLevel[];
}

@Module({})
class AppModule {
  static forRoot(config: AppConfig, store: Store, aiGrader: AiGrader | null, content: ContentRegistry): DynamicModule {
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
      ],
    };
  }
}

export async function createApp(opts: CreateAppOptions): Promise<INestApplication> {
  const config: AppConfig = { ...CONFIG_DEFAULTS, ...opts.config };
  const log = new Logger("DuniaLab");
  const content = ContentRegistry.fromDirectory(opts.packsDir ?? config.packsDir ?? ContentRegistry.defaultDirectory(), {
    allowDraft: config.allowDraftContent,
    warn: (m) => log.warn(m),
  });

  const app = await NestFactory.create(AppModule.forRoot(config, opts.store, opts.aiGrader, content), {
    logger: opts.logger ?? ["error", "warn", "log"],
    bodyParser: true,
  });
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
