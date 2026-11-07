import { describe, expect, it } from "vitest";
import { hashSecret, verifySecret } from "../src/auth/password.js";
import { loadConfig } from "../src/config.js";

describe("password hashing", () => {
  it("verifies the right secret and rejects the wrong one", async () => {
    const h = await hashSecret("correct horse battery");
    expect(h).toMatch(/^scrypt\$16384\$/);
    expect(await verifySecret("correct horse battery", h)).toBe(true);
    expect(await verifySecret("wrong horse battery", h)).toBe(false);
  });

  it("salts: the same secret hashes differently each time", async () => {
    expect(await hashSecret("x".repeat(12))).not.toBe(await hashSecret("x".repeat(12)));
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifySecret("a", "bcrypt$whatever")).toBe(false);
  });
});

describe("loadConfig", () => {
  it("defaults to the offline checker and draft content outside production", () => {
    const c = loadConfig({});
    expect(c.aiEnabled).toBe(false);
    expect(c.allowDraftContent).toBe(true);
    expect(c.aiModel).toBe("claude-opus-5-5");
  });

  it("enables the AI only when an API key is present", () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: "sk-test" }).aiEnabled).toBe(true);
  });

  it("refuses to boot production without a real secret and database", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "s".repeat(40) })).toThrow(/DATABASE_URL/);
  });

  it("never serves draft content in production", () => {
    const c = loadConfig({ NODE_ENV: "production", JWT_SECRET: "s".repeat(40), DATABASE_URL: "postgres://u:p@h:5432/d" });
    expect(c.allowDraftContent).toBe(false);
  });

  it("allows draft content in production mode only with an explicit override (local E2E)", () => {
    const prod = { NODE_ENV: "production", JWT_SECRET: "s".repeat(40), DATABASE_URL: "postgres://u:p@h:5432/d" } as const;
    expect(loadConfig({ ...prod, ALLOW_DRAFT_CONTENT: "true" }).allowDraftContent).toBe(true);
    expect(loadConfig({ ...prod, ALLOW_DRAFT_CONTENT: "false" }).allowDraftContent).toBe(false);
  });
});
