import { afterEach, describe, expect, it, vi } from "vitest";
import { assetsBase, loadManifest, runLimited } from "../src/three/load.js";
import { probeDevice3d } from "../src/lib/device3d.js";

afterEach(() => vi.unstubAllGlobals());

describe("3D loading", () => {
  it("uses the deployment base and encodes a pack id as one path segment", () => {
    expect(assetsBase("demo pack", "/school/")).toBe("/school/content-assets/demo%20pack/3d/");
  });

  it("rejects failed HTTP and invalid manifests with a recoverable message", async () => {
    for (const response of [new Response("", { status: 404 }), Response.json({})]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(loadManifest("demo", new AbortController().signal)).rejects.toThrow("3D is not available for this map yet");
    }
  });

  it("limits simultaneous file loads to four and preserves order", async () => {
    let active = 0;
    let peak = 0;
    const result = await runLimited(Array.from({ length: 11 }, (_, i) => async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return i;
    }));
    expect(peak).toBe(4);
    expect(result).toEqual(Array.from({ length: 11 }, (_, i) => i));
  });

  it("waits for in-flight loads to settle before reporting failure", async () => {
    let finished = false;
    await expect(runLimited([
      async () => { throw new Error("failed"); },
      async () => { await new Promise((r) => setTimeout(r, 10)); finished = true; },
    ])).rejects.toThrow("failed");
    expect(finished).toBe(true);
  });
});

describe("3D device probe", () => {
  it("releases the probe context and preserves reported memory", () => {
    const loseContext = vi.fn();
    const getContext = vi.fn().mockReturnValue({ getExtension: () => ({ loseContext }) });
    expect(probeDevice3d(() => ({ getContext }), 2)).toEqual({ webgl2: true, deviceMemoryGB: 2 });
    expect(getContext).toHaveBeenCalledWith("webgl2");
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("keeps the 2D fallback when WebGL2 is absent", () => {
    expect(probeDevice3d(() => ({ getContext: () => null }))).toEqual({ webgl2: false });
  });
});
