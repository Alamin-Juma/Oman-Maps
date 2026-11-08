/**
 * Device check: open the phone's camera, show the live view, capture one still.
 *
 * This is the Tier B ("scan-and-pop") precursor and the pilot support tool: before a
 * tester worries about map recognition, they need to know the camera opens on this phone.
 *
 * Child safety (product definition): "No camera image leaves the device." This component
 * holds the MediaStream, draws to a local <canvas>, and has no API client and no network
 * call of any kind. The captured still lives in component state and is dropped on close.
 * The e2e test asserts that no request leaves the page while the camera is open.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@dunialab/content";
import { cameraFailure, cameraSupport, shouldRetryWithAnyCamera } from "../lib/camera.js";

const COPY = {
  title: { en: "Camera check", sw: "Ukaguzi wa kamera" },
  intro: {
    en: "Point the phone at the printed map. Nothing is uploaded: the picture stays on this device.",
    sw: "Elekeza simu kwenye ramani iliyochapishwa. Hakuna kinachopakiwa: picha inabaki kwenye kifaa hiki.",
  },
  start: { en: "Start camera", sw: "Anzisha kamera" },
  capture: { en: "Take picture", sw: "Piga picha" },
  again: { en: "Retake", sw: "Piga tena" },
  stop: { en: "Stop camera", sw: "Simamisha kamera" },
  close: { en: "Close", sw: "Funga" },
  live: { en: "Camera is live", sw: "Kamera inafanya kazi" },
  captured: { en: "Captured on this device", sw: "Imepigwa kwenye kifaa hiki" },
} as const;

type Status = { kind: "idle" | "starting" | "live" } | { kind: "error"; message: string };

export function CameraCheck({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const t = <K extends keyof typeof COPY>(k: K) => COPY[k][locale];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [still, setStill] = useState<string | null>(null);
  const [info, setInfo] = useState("");

  const support = cameraSupport({
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    hasCameraApi: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    hostname: typeof location !== "undefined" ? location.hostname : "",
  });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus({ kind: "idle" });
    setInfo("");
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    setStatus({ kind: "starting" });
    setStill(null);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: "environment" } } });
      } catch (first) {
        if (!shouldRetryWithAnyCamera(first)) throw first;
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {
          /* autoplay policies: the <video> is muted and inline, so this is unexpected but harmless */
        });
      }
      const track = stream.getVideoTracks()[0];
      const s = track?.getSettings();
      setInfo([track?.label, s?.width && s?.height ? `${s.width}x${s.height}` : null].filter(Boolean).join(" · "));
      setStatus({ kind: "live" });
    } catch (error) {
      stop();
      setStatus({ kind: "error", message: cameraFailure(error, locale) });
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    setStill(canvas.toDataURL("image/jpeg", 0.85));
  };

  return (
    <section className="panel camera">
      <div className="row between">
        <h2>📷 {t("title")}</h2>
        <button className="link" onClick={onClose} aria-label={t("close")}>×</button>
      </div>
      <p className="muted">{t("intro")}</p>

      {!support.usable ? (
        <p className="draft" role="alert">{support.detail[locale]}</p>
      ) : (
        <>
          <div className="camera-view">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live camera preview, no audio track */}
            <video ref={videoRef} playsInline muted autoPlay hidden={!!still || status.kind !== "live"} />
            {still && <img src={still} alt={t("captured")} />}
            {status.kind !== "live" && !still && <div className="camera-placeholder" aria-hidden="true">📷</div>}
          </div>

          {status.kind === "live" && !still && <p className="ok" role="status">● {t("live")}{info && ` — ${info}`}</p>}
          {still && <p className="ok" role="status">✓ {t("captured")}</p>}
          {status.kind === "error" && <p className="draft" role="alert">{status.message}</p>}

          <div className="row">
            {status.kind === "live" ? (
              <>
                <button className="primary" onClick={still ? () => setStill(null) : capture}>
                  {still ? t("again") : t("capture")}
                </button>
                <button onClick={stop}>{t("stop")}</button>
              </>
            ) : (
              <button className="primary" onClick={start} disabled={status.kind === "starting"}>
                {t("start")}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
