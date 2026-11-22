import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain .mjs script without type declarations
import { listeningPort } from "../scripts/listening-port.mjs";

describe("listeningPort (findings register CR41)", () => {
  it("reports the port the server actually listens on, when Vite moved off a busy one", () => {
    expect(listeningPort({ httpServer: { address: () => ({ port: 5174 }) }, config: { server: { port: 5173 } } })).toBe(5174);
  });

  it("falls back to the configured port when no address is known", () => {
    expect(listeningPort({ httpServer: { address: () => null }, config: { server: { port: 5173 } } })).toBe(5173);
  });
});
