/**
 * Camera device check (Tier B / Tier A precursor).
 *
 * Child safety (product definition): "No camera image leaves the device." This module is
 * pure decision logic — it holds no stream, does no I/O and has no network dependency.
 * The component owns the MediaStream and draws frames to a local <canvas> only.
 *
 * The two failures that actually happen on a pilot phone:
 *  1. the page was opened by LAN IP over plain HTTP, so the camera API does not exist
 *     (browsers expose it only in a secure context; localhost is exempt);
 *  2. the parent refused the permission prompt.
 */
import type { Locale, LocalizedText } from "@dunialab/content";

export interface CameraEnvironment {
  /** `window.isSecureContext`. */
  secureContext: boolean;
  /** Whether `navigator.mediaDevices.getUserMedia` exists. */
  hasCameraApi: boolean;
  /** `location.hostname`, used only to explain *why* an address is insecure. */
  hostname: string;
}

export type CameraVerdict =
  | { usable: true }
  | { usable: false; reason: "insecure-origin" | "no-camera-api"; detail: LocalizedText };

/** Hosts browsers treat as secure even over plain HTTP. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopback(hostname: string): boolean {
  return LOOPBACK.has(hostname) || hostname.endsWith(".localhost");
}

export function cameraSupport(env: CameraEnvironment): CameraVerdict {
  if (env.secureContext && env.hasCameraApi) return { usable: true };

  if (!env.secureContext && !isLoopback(env.hostname)) {
    return {
      usable: false,
      reason: "insecure-origin",
      detail: {
        en: `This page is open at an address browsers do not trust with a camera (${env.hostname || "unknown host"}). Open it over HTTPS, or on this computer at localhost.`,
        sw: `Ukurasa huu umefunguliwa kwa anwani ambayo vivinjari havikubali kutumia kamera (${env.hostname || "mwenyeji usiojulikana"}). Fungua kwa HTTPS, au kwenye kompyuta hii kwa localhost.`,
      },
    };
  }

  return {
    usable: false,
    reason: "no-camera-api",
    detail: {
      en: "This browser does not offer camera access. Try Chrome on Android.",
      sw: "Kivinjari hiki hakina uwezo wa kutumia kamera. Jaribu Chrome kwenye Android.",
    },
  };
}

const FAILURES: Record<string, LocalizedText> = {
  NotAllowedError: {
    en: "Camera permission was refused. Allow the camera for this site in the browser's address-bar icon, then try again.",
    sw: "Ruhusa ya kamera ilikataliwa. Ruhusu kamera kwa tovuti hii kwenye aikoni ya upau wa anwani, kisha jaribu tena.",
  },
  NotFoundError: {
    en: "No camera was found on this device.",
    sw: "Hakuna kamera iliyopatikana kwenye kifaa hiki.",
  },
  NotReadableError: {
    en: "The camera could not be started. Another app may be using it — close it and try again.",
    sw: "Kamera haikuweza kuanza. Programu nyingine inaweza kuwa inaitumia — ifunge na ujaribu tena.",
  },
  OverconstrainedError: {
    en: "This device has no back camera. Retrying with any available camera.",
    sw: "Kifaa hiki hakina kamera ya nyuma. Tunajaribu tena kwa kamera yoyote inayopatikana.",
  },
  SecurityError: {
    en: "The browser blocked the camera for this page. Open the page over HTTPS.",
    sw: "Kivinjari kilizuia kamera kwa ukurasa huu. Fungua ukurasa kwa HTTPS.",
  },
};

const UNKNOWN: LocalizedText = {
  en: "The camera could not be started on this device. Check the browser's site permissions and try again.",
  sw: "Kamera haikuweza kuanza kwenye kifaa hiki. Angalia ruhusa za tovuti kwenye kivinjari na ujaribu tena.",
};

/** Turn a DOMException-like rejection from getUserMedia into guidance a parent can act on. */
export function cameraFailure(error: unknown, locale: Locale): string {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  return (FAILURES[name] ?? UNKNOWN)[locale];
}

/** Retrying without the rear-camera constraint is worth it only for this failure. */
export function shouldRetryWithAnyCamera(error: unknown): boolean {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  return name === "OverconstrainedError";
}
