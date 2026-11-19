import { Body, ConflictException, Controller, HttpCode, HttpException, HttpStatus, Inject, Ip, Post, Res, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { z } from "zod";
import { parse } from "../common/zod.js";
import type { AppConfig } from "../config.js";
import { EmailTakenError, type Store } from "../store/store.js";
import { ATTEMPT_LIMITER, CONFIG, STORE } from "../tokens.js";
import type { AttemptLimiter, LimitRule } from "./attempt-limiter.js";
import { hashSecret, verifySecret } from "./password.js";

/** The one thing used from the HTTP response: setting Retry-After. */
interface HeaderSink {
  setHeader(name: string, value: string): unknown;
}

const Credentials = z
  .object({
    email: z.string().email().max(254).transform((e) => e.trim().toLowerCase()),
    password: z.string().min(10).max(200),
  })
  .strict();

@Controller("v1/auth")
export class AuthController {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
  ) {}

  private token(parentId: string) {
    return this.jwt.signAsync({ sub: parentId, typ: "parent" });
  }

  /**
   * Refuse with 429 and a Retry-After header when any of the given limits is reached
   * (findings register S9). Checked BEFORE any password work, so refusals stay cheap.
   */
  private refuseIfLimited(res: HeaderSink, checks: [string, LimitRule][]) {
    const wait = Math.max(0, ...checks.map(([key, rule]) => this.limiter.retryAfterSeconds(key, rule)));
    if (wait > 0) {
      res.setHeader("Retry-After", String(wait));
      throw new HttpException("too many attempts; try again later", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  @Post("register")
  async register(@Body() body: unknown, @Ip() ip: string, @Res({ passthrough: true }) res: HeaderSink) {
    const limits = this.config.rateLimits;
    const address = `register:${ip}`;
    this.refuseIfLimited(res, [[address, limits.registrationsPerAddress]]);
    const { email, password } = parse(Credentials, body);
    this.limiter.record(address, limits.registrationsPerAddress);
    try {
      const parent = await this.store.createParent(email, await hashSecret(password));
      return { token: await this.token(parent.id) };
    } catch (err) {
      if (err instanceof EmailTakenError) throw new ConflictException("email already registered");
      throw err;
    }
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Ip() ip: string, @Res({ passthrough: true }) res: HeaderSink) {
    const limits = this.config.rateLimits;
    const { email, password } = parse(Credentials, body);
    const account = `login-account:${email}`;
    const address = `login-address:${ip}`;
    this.refuseIfLimited(res, [
      [account, limits.loginFailuresPerAccount],
      [address, limits.loginAttemptsPerAddress],
    ]);
    this.limiter.record(address, limits.loginAttemptsPerAddress);
    const parent = await this.store.findParentByEmail(email);
    // Same error for unknown email and wrong password: do not reveal which accounts exist.
    if (!parent || !(await verifySecret(password, parent.passwordHash))) {
      this.limiter.record(account, limits.loginFailuresPerAccount);
      throw new UnauthorizedException();
    }
    this.limiter.clear(account);
    return { token: await this.token(parent.id) };
  }
}
