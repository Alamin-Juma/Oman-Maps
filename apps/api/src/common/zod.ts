import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";

/** Parse untrusted input; reply 400 with field-level issues on failure. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new BadRequestException({
      message: "invalid request",
      issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return r.data;
}
