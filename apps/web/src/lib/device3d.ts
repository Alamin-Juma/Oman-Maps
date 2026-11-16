import type { DeviceInfo } from "../three/plan.js";

interface ProbeCanvas {
  getContext(kind: "webgl2"): { getExtension(name: "WEBGL_lose_context"): { loseContext(): void } | null } | null;
}

export function probeDevice3d(createCanvas: () => ProbeCanvas, memory?: number): DeviceInfo {
  const context = createCanvas().getContext("webgl2");
  context?.getExtension("WEBGL_lose_context")?.loseContext();
  return { webgl2: context !== null, ...(memory === undefined ? {} : { deviceMemoryGB: memory }) };
}

let device: DeviceInfo | undefined;
export function device3d(): DeviceInfo {
  const nav: Navigator & { deviceMemory?: number } = navigator;
  return device ??= probeDevice3d(() => document.createElement("canvas"), nav.deviceMemory);
}
