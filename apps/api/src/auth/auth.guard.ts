import {
  createParamDecorator,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

export interface AuthedParent {
  parentId: string;
}

@Injectable()
export class ParentAuthGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; parent?: AuthedParent }>();
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(token);
      if (payload.typ !== "parent") throw new Error("wrong token type");
      req.parent = { parentId: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

/** Injects the authenticated parent into a handler parameter. */
export const Parent = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthedParent => {
  return ctx.switchToHttp().getRequest<{ parent: AuthedParent }>().parent;
});
