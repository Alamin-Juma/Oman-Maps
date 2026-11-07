import { Body, ConflictException, Controller, HttpCode, Inject, Post, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { z } from "zod";
import { parse } from "../common/zod.js";
import { EmailTakenError, type Store } from "../store/store.js";
import { STORE } from "../tokens.js";
import { hashSecret, verifySecret } from "./password.js";

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
  ) {}

  private token(parentId: string) {
    return this.jwt.signAsync({ sub: parentId, typ: "parent" });
  }

  @Post("register")
  async register(@Body() body: unknown) {
    const { email, password } = parse(Credentials, body);
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
  async login(@Body() body: unknown) {
    const { email, password } = parse(Credentials, body);
    const parent = await this.store.findParentByEmail(email);
    // Same error for unknown email and wrong password: do not reveal which accounts exist.
    if (!parent || !(await verifySecret(password, parent.passwordHash))) throw new UnauthorizedException();
    return { token: await this.token(parent.id) };
  }
}
