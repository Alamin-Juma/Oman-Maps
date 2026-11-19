import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import type { Feature, Locale } from "@dunialab/content";
import type { AttemptEvent } from "@dunialab/mastery";
import { KenyaMap } from "./components/KenyaMap.js";
import { MissionPlayer } from "./components/MissionPlayer.js";
import { ProgressPanel } from "./components/ProgressPanel.js";
import { FamilyPanel } from "./components/FamilyPanel.js";
import { CameraCheck } from "./components/CameraCheck.js";
import { DuniaApi, type Profile } from "./lib/api.js";
import { PACK_SELECTION, PACKS, t } from "./lib/packs.js";
import { browserStorage, EventQueue } from "./lib/queue.js";
import { readGuestId, rotateGuestId } from "./lib/guest.js";
import { device3d } from "./lib/device3d.js";
import { has3d, supports3d } from "./three/plan.js";
import { ThreeBoundary } from "./components/ThreeBoundary.js";
import { SessionScope } from "./lib/session.js";

const Viewer3D = lazy(() => import("./three/Viewer3D.js"));

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
  const [view3d, setView3d] = useState<{ featureId: string | null } | null>(null);
  const [device] = useState(device3d);
  const [reveal, setReveal] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [guestId, setGuestId] = useState(() => readGuestId(storage));
  const [cameraCheck, setCameraCheck] = useState(
    () => new URLSearchParams(window.location.search).get("check") === "camera",
  );
  const tapHandler = useRef<((f: Feature) => void) | null>(null);

  const queue = useMemo(() => new EventQueue(storage), []);
  // One parent's sign-in on this shared phone (findings register S7, S8): ending it drops any
  // answer still in flight, and an expired sign-in signs out cleanly with a message.
  const session = useMemo(() => new SessionScope(), []);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const expireSession = useRef<() => void>(() => {});
  const setToken = (tk: string | null) => {
    setTokenState(tk);
    if (tk) storage.setItem("dunialab.token", tk);
    else storage.removeItem("dunialab.token");
  };
  const api = useMemo(
    () => new DuniaApi(API_URL, () => token, undefined, undefined, () => expireSession.current()),
    [token],
  );
  const onEvents = useCallback(
    (events: AttemptEvent[]) => {
      if (!pack) return;
      queue.add(pack.id, events);
      setVersion((v) => v + 1);
    },
    [queue, pack],
  );

  if (!pack) {
    // Truthful empty state: say WHY there are no lessons (findings register S1, E4).
    const waiting = PACK_SELECTION.withheld.length;
    return (
      <main className="empty" role="status">
        {waiting > 0 ? (
          <>
            <p>No approved lessons yet: {waiting} lesson pack{waiting === 1 ? " is" : "s are"} waiting for teacher approval.</p>
            <p lang="sw">Hakuna masomo yaliyoidhinishwa bado: yanasubiri kuidhinishwa na mwalimu.</p>
          </>
        ) : (
          <p>No lesson packs found.</p>
        )}
      </main>
    );
  }
  const activeProfileId = profile?.id ?? guestId;
  const events = queue.all(pack.id, activeProfileId);
  void version;

  const endSession = () => {
    session.end();
    setToken(null);
    setProfile(null);
    setMissionId(null);
    setGuestId(rotateGuestId(storage));
  };
  const signOut = () => {
    endSession();
    setSessionNotice(null);
  };
  expireSession.current = () => {
    if (tokenRef.current === null) return; // several requests can fail together: end the session once
    tokenRef.current = null;
    endSession();
    setSessionNotice(
      locale === "sw"
        ? "Muda wa kuingia umekwisha. Tafadhali ingia tena. Maendeleo ya mtoto kwenye simu hii yako salama."
        : "Your sign-in has ended. Please sign in again. Progress on this phone is safe.",
    );
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
            <select value={pack.id} onChange={(e) => { setPackId(e.target.value); setMissionId(null); setSelected(null); setView3d(null); }}>
              {PACKS.map((p) => <option key={p.id} value={p.id}>{t(p.title, locale)} · Grade {p.grade}</option>)}
            </select>
          )}
          <button className="chip" onClick={() => setLocale(locale === "en" ? "sw" : "en")} aria-label="language">
            {locale === "en" ? "Kiswahili" : "English"}
          </button>
          {supports3d(device) && !missionId && <button className="chip" onClick={() => setView3d({ featureId: null })}>3D</button>}
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
      {queue.notSaved && (
        // Findings register R1: never let progress disappear silently.
        <p className="draft" role="alert">
          {locale === "sw"
            ? "Maendeleo hayajahifadhiwa kwenye simu hii (hifadhi imejaa au imezuiwa). Yatabaki hadi ufunge ukurasa huu: sawazisha sasa au futa nafasi."
            : "Progress is not saved on this phone (storage is full or blocked). It is kept until you close this page: sync now, or free some space."}
        </p>
      )}
      {queue.recoveredDamaged > 0 && (
        // Findings register R2: damaged saved data was set aside, not silently dropped.
        <p className="draft" role="status">
          {locale === "sw"
            ? `Sehemu ${queue.recoveredDamaged} ya maendeleo yaliyohifadhiwa iliharibika na imewekwa kando. Mengine yako salama.`
            : `${queue.recoveredDamaged} damaged saved item${queue.recoveredDamaged === 1 ? " was" : "s were"} set aside. The rest of the progress is safe.`}
        </p>
      )}

      <main className="layout">
        <div className="map-wrap">
          {view3d ? <ThreeBoundary key={`${pack.id}:${view3d.featureId ?? "all"}`} locale={locale} onClose={() => setView3d(null)}>
            <Suspense fallback={<section className="panel"><p role="status">{locale === "sw" ? "Inapakia 3D..." : "Loading 3D..."}</p>
              <button onClick={() => setView3d(null)}>{locale === "sw" ? "Rudi kwenye ramani" : "Back to map"}</button></section>}>
              <Viewer3D pack={pack} featureId={view3d.featureId} locale={locale} onClose={() => setView3d(null)}
                onSelect={(featureId) => setView3d({ featureId })} />
            </Suspense>
          </ThreeBoundary> : <>
          <KenyaMap pack={pack} locale={locale} revealId={reveal} onFeatureTap={onTap} />
          {selected && !missionId && (
            <div className="fact">
              <strong>{t(selected.name, locale)}</strong>
              {selected.facts.map((f, i) => <p key={i}>{t(f, locale)}</p>)}
              {supports3d(device) && has3d(selected) && <button onClick={() => setView3d({ featureId: selected.id })}>
                {locale === "sw" ? "Tazama katika 3D" : "See in 3D"}
              </button>}
              <button className="link" onClick={() => setSelected(null)}>×</button>
            </div>
          )}
          </>}
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
                    <button key={m.id} className="mission" onClick={() => { setView3d(null); setSelected(null); setReveal(null); setMissionId(m.id); }}>
                      <span>{t(m.title, locale)}</span>
                      <span className="muted">{m.minutes} min</span>
                    </button>
                  ))}
                </div>
              ))}
            </section>
          )}
          <ProgressPanel pack={pack} events={events} locale={locale} />
          {sessionNotice && <p className="banner try" role="alert">{sessionNotice}</p>}
          <FamilyPanel
            key={session.current}
            api={api}
            queue={queue}
            pack={pack}
            locale={locale}
            token={token}
            setToken={(tk) => { setSessionNotice(null); setToken(tk); }}
            onSignOut={signOut}
            guestId={guestId}
            profile={profile}
            setProfile={session.guard((p: Profile | null) => { setProfile(p); setVersion((v) => v + 1); })}
          />
        </aside>
      </main>
    </div>
  );
}
