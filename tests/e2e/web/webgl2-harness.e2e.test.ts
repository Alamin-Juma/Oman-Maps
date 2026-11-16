/**
 * E2E harness check (3D Explorer, Phase 0 spike kept as a real test; ADR-0008).
 *
 * Every later 3D test ("the mountain is on screen", "the river is flowing") depends on four
 * facts about OUR E2E browser. If one stops being true, this file fails first and says which:
 *
 *  1. headless Chromium gives us a WebGL2 context, on the software renderer CI also uses;
 *  2. what we draw is what we read back (exact colours, in-page readPixels);
 *  3. a canvas with `preserveDrawingBuffer: false` (three.js's default) reads back BLANK from
 *     script after the frame, but a screenshot still sees it — so 3D tests must use screenshots;
 *  4. animation frames run, and Playwright's clock can drive them deterministically.
 *
 * It also records what the software renderer can do and how slow it is, so 3D E2E tests are
 * written with realistic sizes and timeouts.
 */
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchWebglChromium, pixelStats, screenshotPixels } from "../support/browser.js";

/** Runs in the page: paints the left half red and the right half blue on a WebGL2 canvas. */
const PAINT_HALVES = `
  window.paintHalves = (canvas, attrs) => {
    const gl = canvas.getContext("webgl2", attrs);
    if (!gl) return null;
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, "#version 300 es\\nin vec2 p; out float x; void main(){ x = p.x; gl_Position = vec4(p, 0.0, 1.0); }"));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, "#version 300 es\\nprecision highp float; in float x; out vec4 o; void main(){ o = x < 0.0 ? vec4(1.0, 0.0, 0.0, 1.0) : vec4(0.0, 0.0, 1.0, 1.0); }"));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return gl;
  };
  window.readAll = (gl) => { const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px); };
`;

describe("E2E harness: headless Chromium renders WebGL2 and we can read the pixels back", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await launchWebglChromium();
  });

  afterAll(async () => {
    await browser?.close();
  });

  const freshPage = async (canvases: string) => {
    page = await browser.newPage();
    await page.setContent(`<body style="margin:0;background:#fff">${canvases}</body>`);
    await page.addScriptTag({ content: PAINT_HALVES });
    return page;
  };

  it("provides a WebGL2 context on the software renderer, with the capabilities 3D needs", async () => {
    await freshPage(`<canvas id="c" width="64" height="64"></canvas>`);
    const caps = await page.evaluate(() => {
      const gl = (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2");
      if (!gl) return null;
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        renderer: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number,
        floatLinear: !!gl.getExtension("OES_texture_float_linear"),
        colorBufferFloat: !!gl.getExtension("EXT_color_buffer_float"),
        uintIndices: true, // core in WebGL2: meshes above 65,535 vertices are allowed
      };
    });
    expect(caps, "WebGL2 context was not created in headless Chromium").not.toBeNull();
    console.info("[webgl2-harness] capabilities:", JSON.stringify(caps));
    // Same software path locally and in CI, so 3D E2E results do not depend on the machine's GPU.
    expect(caps!.renderer).toMatch(/SwiftShader/i);
    // Our largest baked texture is 4096 px (ADR-0009).
    expect(caps!.maxTextureSize).toBeGreaterThanOrEqual(4096);
  });

  it("reads back exactly the colours that were drawn", async () => {
    await freshPage(`<canvas id="c" width="64" height="32"></canvas>`);
    const rgba = await page.evaluate(() => {
      const w = window as unknown as { paintHalves: (c: Element | null, a?: object) => unknown; readAll: (gl: unknown) => number[] };
      return w.readAll(w.paintHalves(document.getElementById("c")));
    });
    const at = (x: number, y: number) => rgba.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4);
    expect(at(8, 16)).toEqual([255, 0, 0, 255]); // left half: red
    expect(at(56, 16)).toEqual([0, 0, 255, 255]); // right half: blue
    const stats = pixelStats(rgba, 64, 32);
    expect(stats.distinctColors).toBe(2);
    expect(stats.nonBackgroundRatio).toBeCloseTo(0.5, 1);
  });

  it("sees a default (non-preserved) WebGL canvas through a screenshot, where script read-back is blank", async () => {
    await freshPage(`<canvas id="c" width="64" height="32" style="display:block"></canvas>`);
    const afterFrame = await page.evaluate(async () => {
      const w = window as unknown as { paintHalves: (c: Element | null, a?: object) => unknown; readAll: (gl: unknown) => number[] };
      const gl = w.paintHalves(document.getElementById("c"), { preserveDrawingBuffer: false });
      // Let the browser present the frame; the drawing buffer is then cleared.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return w.readAll(gl);
    });
    // The pitfall, pinned: reading from script after the frame gives a flat, empty buffer.
    expect(pixelStats(afterFrame, 64, 32).distinctColors).toBe(1);

    // The route 3D tests must use: the composited frame, as the child would see it.
    const shot = await screenshotPixels(page, page.locator("#c"));
    const stats = pixelStats(shot.rgba, shot.width, shot.height);
    expect(shot.width).toBe(64);
    expect(stats.distinctColors).toBeGreaterThanOrEqual(2);
    expect(stats.variance).toBeGreaterThan(1000);
    const px = (x: number, y: number) => Array.from(shot.rgba.slice((y * shot.width + x) * 4, (y * shot.width + x) * 4 + 3));
    expect(px(8, 16)).toEqual([255, 0, 0]);
    expect(px(56, 16)).toEqual([0, 0, 255]);
  });

  it("tells a blank canvas from a drawn one", async () => {
    await freshPage(`<canvas id="blank" width="64" height="32" style="display:block"></canvas>`);
    await page.evaluate(() => {
      const gl = (document.getElementById("blank") as HTMLCanvasElement).getContext("webgl2")!;
      gl.clearColor(0.2, 0.3, 0.4, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    const shot = await screenshotPixels(page, page.locator("#blank"));
    const stats = pixelStats(shot.rgba, shot.width, shot.height);
    expect(stats.distinctColors).toBe(1);
    expect(stats.variance).toBe(0);
    expect(stats.nonBackgroundRatio).toBe(0);
  });

  it("runs animation frames in real time", async () => {
    await freshPage(`<canvas id="c" width="16" height="16"></canvas>`);
    const frames = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let count = 0;
          const start = performance.now();
          const tick = () => {
            count++;
            if (performance.now() - start >= 500) resolve(count);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    console.info(`[webgl2-harness] animation frames in 500 ms: ${frames}`);
    expect(frames).toBeGreaterThanOrEqual(10);
  });

  it("lets Playwright's clock drive an animation deterministically", async () => {
    page = await browser.newPage();
    await page.clock.install({ time: new Date("2027-01-11T06:00:00Z") });
    await page.setContent(`<div id="flow" data-flow-progress="0"></div>`);
    // A stand-in for "Show river": progress goes 0 -> 1 over 4 simulated seconds.
    await page.evaluate(() => {
      const el = document.getElementById("flow")!;
      const start = performance.now();
      const tick = () => {
        const progress = Math.min(1, (performance.now() - start) / 4000);
        el.dataset.flowProgress = progress.toFixed(3);
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const progress = async () => Number(await page.locator("#flow").getAttribute("data-flow-progress"));

    await page.clock.runFor(2000);
    const half = await progress();
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);

    await page.clock.runFor(2500);
    expect(await progress()).toBe(1);
  });

  it("renders a terrain-sized mesh fast enough for E2E on the software renderer", async () => {
    // 257 x 257 vertices = 131,072 triangles: the size of one terrain tile at medium quality.
    await freshPage(`<canvas id="c" width="800" height="600" style="display:block"></canvas>`);
    const ms = await page.evaluate(() => {
      const canvas = document.getElementById("c") as HTMLCanvasElement;
      const gl = canvas.getContext("webgl2")!;
      const N = 257;
      const positions = new Float32Array(N * N * 3);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const i = (y * N + x) * 3;
          positions[i] = (x / (N - 1)) * 2 - 1;
          positions[i + 1] = (y / (N - 1)) * 2 - 1;
          positions[i + 2] = Math.sin(x * 0.11) * Math.cos(y * 0.07);
        }
      const indices = new Uint32Array((N - 1) * (N - 1) * 6);
      let k = 0;
      for (let y = 0; y < N - 1; y++)
        for (let x = 0; x < N - 1; x++) {
          const a = y * N + x;
          indices.set([a, a + 1, a + N, a + 1, a + N + 1, a + N], k);
          k += 6;
        }
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, "#version 300 es\nin vec3 p; out float h; void main(){ h = p.z; gl_Position = vec4(p.xy, p.z * 0.1, 1.0); }"));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float; in float h; out vec4 o; void main(){ o = vec4(0.5 + 0.5 * h, 0.6, 0.3, 1.0); }"));
      gl.linkProgram(program);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      gl.enable(gl.DEPTH_TEST);
      const frames = 10;
      const start = performance.now();
      const one = new Uint8Array(4);
      for (let f = 0; f < frames; f++) {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); // forces the frame to finish
      }
      return (performance.now() - start) / frames;
    });
    console.info(`[webgl2-harness] 131k-triangle frame at 800x600 on SwiftShader: ${ms.toFixed(1)} ms`);
    // Generous: this guards against "unusably slow", it is not a performance target.
    expect(ms).toBeLessThan(1500);
    const shot = await screenshotPixels(page, page.locator("#c"));
    expect(pixelStats(shot.rgba, shot.width, shot.height).distinctColors).toBeGreaterThan(50);
  });
});
