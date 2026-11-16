/**
 * Browser launch + pixel helpers for E2E tests that render WebGL (3D Explorer, ADR-0008).
 *
 * Headless Chromium has no GPU in CI, so WebGL runs on SwiftShader (software). We pin the
 * flags instead of relying on the default, so a developer laptop with a GPU and the CI
 * runner render through the same path and a Chromium default change cannot silently
 * switch WebGL off.
 */
import { chromium, type Browser, type Locator, type Page } from "playwright";

export const SOFTWARE_WEBGL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] as const;

export function launchWebglChromium(extraArgs: readonly string[] = []): Promise<Browser> {
  return chromium.launch({ args: [...SOFTWARE_WEBGL_ARGS, ...extraArgs] });
}

export interface PixelStats {
  width: number;
  height: number;
  /** Number of different RGB colours (alpha ignored), capped at 4096. */
  distinctColors: number;
  /** Mean per-channel variance of RGB, 0 for a flat image. */
  variance: number;
  /** Fraction of pixels that differ from the top-left pixel. */
  nonBackgroundRatio: number;
}

/** Summarise RGBA pixels. Pure: used to decide "this canvas is not blank". */
export function pixelStats(rgba: ArrayLike<number>, width: number, height: number): PixelStats {
  const n = width * height;
  if (n === 0 || rgba.length < n * 4) throw new Error(`pixelStats: expected ${n * 4} bytes, got ${rgba.length}`);
  const colors = new Set<number>();
  const sum = [0, 0, 0];
  const sumSq = [0, 0, 0];
  const bg = [rgba[0]!, rgba[1]!, rgba[2]!];
  let nonBackground = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    if (colors.size < 4096) colors.add((r << 16) | (g << 8) | b);
    sum[0]! += r; sum[1]! += g; sum[2]! += b;
    sumSq[0]! += r * r; sumSq[1]! += g * g; sumSq[2]! += b * b;
    if (r !== bg[0] || g !== bg[1] || b !== bg[2]) nonBackground++;
  }
  const variance = [0, 1, 2].reduce((acc, c) => acc + (sumSq[c]! / n - (sum[c]! / n) ** 2), 0) / 3;
  return { width, height, distinctColors: colors.size, variance, nonBackgroundRatio: nonBackground / n };
}

/**
 * Pixels of an element as the USER sees them (the composited frame), via a screenshot.
 * This works for WebGL canvases created with `preserveDrawingBuffer: false` (three.js's
 * default), where reading the canvas from script after the frame returns blank.
 */
export async function screenshotPixels(page: Page, target: Locator): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const png = await target.screenshot({ type: "png" });
  // Decode the PNG in the page (no decoder dependency) and bring the raw bytes back as base64:
  // passing a large number[] through evaluate() is ~100x slower.
  const decoded = await page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { data: btoa(binary), width: c.width, height: c.height };
  }, png.toString("base64"));
  return { rgba: new Uint8Array(Buffer.from(decoded.data, "base64")), width: decoded.width, height: decoded.height };
}
