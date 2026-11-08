import { describe, expect, it } from "vitest";
import { cameraFailure, cameraSupport, isLoopback, shouldRetryWithAnyCamera } from "../src/lib/camera.js";

const env = (over: Partial<Parameters<typeof cameraSupport>[0]> = {}) =>
  cameraSupport({ secureContext: true, hasCameraApi: true, hostname: "localhost", ...over });

describe("cameraSupport", () => {
  it("is usable in a secure context with the API present", () => {
    expect(env().usable).toBe(true);
  });

  it("reports an insecure LAN origin and names the host in the guidance", () => {
    const v = env({ secureContext: false, hasCameraApi: false, hostname: "192.168.1.42" });
    expect(v).toMatchObject({ usable: false, reason: "insecure-origin" });
    expect(v.usable === false && v.detail.en).toContain("192.168.1.42");
  });

  it("falls back to a host-less message when the hostname is empty", () => {
    const v = env({ secureContext: false, hasCameraApi: false, hostname: "" });
    expect(v.usable === false && v.detail.en).toContain("unknown host");
    expect(v.usable === false && v.detail.sw).toContain("mwenyeji");
  });

  it("blames the browser, not the address, when loopback has no camera API", () => {
    const v = env({ secureContext: false, hasCameraApi: false, hostname: "127.0.0.1" });
    expect(v).toMatchObject({ usable: false, reason: "no-camera-api" });
  });

  it("reports no-camera-api when the context is secure but the API is missing", () => {
    expect(env({ hasCameraApi: false })).toMatchObject({ usable: false, reason: "no-camera-api" });
  });
});

describe("isLoopback", () => {
  it.each(["localhost", "127.0.0.1", "[::1]", "::1", "web.localhost"])("accepts %s", (h) => {
    expect(isLoopback(h)).toBe(true);
  });

  it.each(["192.168.1.42", "dunialab.example", "", "notlocalhost.example"])("rejects %s", (h) => {
    expect(isLoopback(h)).toBe(false);
  });
});

describe("cameraFailure", () => {
  it("maps each known failure to distinct, code-free guidance", () => {
    const names = ["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError", "SecurityError"];
    const messages = names.map((name) => cameraFailure({ name }, "en"));
    expect(new Set(messages).size).toBe(names.length);
    for (const [i, m] of messages.entries()) expect(m).not.toContain(names[i]!);
  });

  it("falls back to generic guidance for unknown and malformed errors", () => {
    const generic = cameraFailure({ name: "WeirdNewError" }, "en");
    expect(generic).toMatch(/could not be started/);
    expect(cameraFailure(null, "en")).toBe(generic);
    expect(cameraFailure("boom", "en")).toBe(generic);
    expect(cameraFailure(undefined, "en")).toBe(generic);
  });

  it("translates every failure", () => {
    for (const name of ["NotAllowedError", "NotFoundError", "WeirdNewError"]) {
      expect(cameraFailure({ name }, "sw")).not.toBe(cameraFailure({ name }, "en"));
    }
  });
});

describe("shouldRetryWithAnyCamera", () => {
  it("retries only when the rear-camera constraint was the problem", () => {
    expect(shouldRetryWithAnyCamera({ name: "OverconstrainedError" })).toBe(true);
    expect(shouldRetryWithAnyCamera({ name: "NotAllowedError" })).toBe(false);
    expect(shouldRetryWithAnyCamera(null)).toBe(false);
  });
});
