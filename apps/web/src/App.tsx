import { useCallback, useMemo, useRef, useState } from "react";
import type { Feature, Locale } from "@dunialab/content";
import type { AttemptEvent } from "@dunialab/mastery";
import { KenyaMap } from "./components/KenyaMap.js";
import { MissionPlayer } from "./components/MissionPlayer.js";
import { ProgressPanel } from "./components/ProgressPanel.js";
import { FamilyPanel } from "./components/FamilyPanel.js";
import { CameraCheck } from "./components/CameraCheck.js";
import { DuniaApi, type Profile } from "./lib/api.js";
import { PACKS, t } from "./lib/packs.js";
import { browserStorage, EventQueue } from "./lib/queue.js";
import { readGuestId, rotateGuestId } from "./lib/guest.js";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";
const storage = browserStorage();

export function App() {
  const [locale, setLocale] = useState<Locale>("en");
  const [packId, setPackId] = useState(PACKS[0]?.id ?? "");
  const pack = PACKS.find((p) => p.id === packId) ?? PACKS[0];
  const [missionId, setMissionId] = useState<string | null>(null);
  const [token, setTokenState] = useState<string | null>(() => storage.getItem("dunialab.token"));
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<Feature | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [guestId, setGuestId] = useState(() => readGuestId(storage));
  const [cameraCheck, setCameraCheck] = useState(
    () => new URLSearchParams(window.location.search).get("check") === "camera",
  );
  const tapHandler = useRef<((f: Feature) => void) | null>(null);

  const queue = useMemo(() => new EventQueue(storage), []);
  const setToken = (tk: string | null) => {
    setTokenState(tk);
    if (tk) storage.setItem("dunialab.token", tk);
    else storage.removeItem("dunialab.token");
  };
  const api = useMemo(() => new DuniaApi(API_URL, () => token), [token]);
  const onEvents = useCallback(
    (events: AttemptEvent[]) => {
      if (!pack) return;
      queue.add(pack.id, events);
      setVersion((v) => v + 1);
    },
    [queue, pack],
  );

  if (!pack) return <main className="empty">No content packs found.</main>;
  const activeProfileId = profile?.id ?? guestId;
  const events = queue.all(pack.id, activeProfileId);
  void version;

  const signOut = () => {
    setToken(null);
    setProfile(null);
    setMissionId(null);
    setGuestId(rotateGuestId(storage));
  };

  const onTap = (f: Feature) => {
    if (tapHandler.current) tapHandler.current(f);
    else setSelected(f);
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">🌍</span> DuniaLab <span className="tier">Tier C · 2D</span>
        </div>
        <div className="row">
          {PACKS.length > 1 && (
            <select value={pack.id} onChange={(e) => { setPackId(e.target.value); setMissionId(null); }}>
              {PACKS.map((p) => <option key={p.id} value={p.id}>{t(p.title, locale)} · Grade {p.grade}</option>)}
            </select>
          )}
          <button className="chip" onClick={() => setLocale(locale === "en" ? "sw" : "en")} aria-label="language">
            {locale === "en" ? "Kiswahili" : "English"}
          </button>
          <button
            className={cameraCheck ? "chip on" : "chip"}
            onClick={() => setCameraCheck((v) => !v)}
            aria-label={locale === "sw" ? "Ukaguzi wa kamera" : "Camera check"}
          >
            📷
          </button>
        </div>
      </header>

      {pack.review.status !== "approved" && (
        <p className="draft">Draft content: not yet teacher-approved. For development and pilot preparation only.</p>
      )}

      <main className="layout">
        <div className="map-wrap">
          <KenyaMap pack={pack} locale={locale} revealId={reveal} onFeatureTap={onTap} />
          {selected && !missionId && (
            <div className="fact">
              <strong>{t(selected.name, locale)}</strong>
              {selected.facts.map((f, i) => <p key={i}>{t(f, locale)}</p>)}
              <button className="link" onClick={() => setSelected(null)}>×</button>
            </div>
          )}
        </div>

        <aside className="side">
          {cameraCheck && <CameraCheck locale={locale} onClose={() => setCameraCheck(false)} />}
          {missionId ? (
            <MissionPlayer
              key={`${missionId}:${activeProfileId}`}
              pack={pack}
              missionId={missionId}
              profileId={activeProfileId}
              locale={locale}
              {...(token ? { checker: api.checkerFor(pack.id) } : {})}
              onEvents={onEvents}
              onExit={() => { setMissionId(null); setReveal(null); }}
              registerTapHandler={(fn) => (tapHandler.current = fn)}
              setReveal={setReveal}
            />
          ) : (
            <section className="panel">
              <h2>{locale === "sw" ? "Misheni" : "Missions"}</h2>
              <p className="muted">{locale === "sw" ? "Gusa ramani kuchunguza, au chagua misheni." : "Tap the map to explore, or pick a mission."}</p>
              {pack.subStrands.filter((s) => s.inMvp).map((ss) => (
                <div key={ss.id} className="substrand">
                  <h4>{ss.code} {t(ss.title, locale)}</h4>
                  {pack.missions.filter((m) => m.subStrandId === ss.id).map((m) => (
                    <button key={m.id} className="mission" onClick={() => { setSelected(null); setReveal(null); setMissionId(m.id); }}>
                      <span>{t(m.title, locale)}</span>
                      <span className="muted">{m.minutes} min</span>
                    </button>
                  ))}
                </div>
              ))}
            </section>
          )}
          <ProgressPanel pack={pack} events={events} locale={locale} />
          <FamilyPanel
            api={api}
            queue={queue}
            pack={pack}
            locale={locale}
            token={token}
            setToken={setToken}
            onSignOut={signOut}
            guestId={guestId}
            profile={profile}
            setProfile={(p) => { setProfile(p); setVersion((v) => v + 1); }}
          />
        </aside>
      </main>
    </div>
  );
}
