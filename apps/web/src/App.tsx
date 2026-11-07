import { useCallback, useMemo, useRef, useState } from "react";
import type { Feature, Locale } from "@dunialab/content";
import type { AttemptEvent } from "@dunialab/mastery";
import { KenyaMap } from "./components/KenyaMap.js";
import { MissionPlayer } from "./components/MissionPlayer.js";
import { ProgressPanel } from "./components/ProgressPanel.js";
import { FamilyPanel } from "./components/FamilyPanel.js";
import { DuniaApi, type Profile } from "./lib/api.js";
import { PACKS, t } from "./lib/packs.js";
import { browserStorage, EventQueue } from "./lib/queue.js";
import { uuid } from "@dunialab/mission";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";
const storage = browserStorage();
const GUEST_KEY = "dunialab.guestId";

/**
 * Offline play needs an id before any parent links the device: a per-session GUEST id.
 * Guest events are adopted once by the first child the parent links; a new guest id is
 * issued on sign-out so the next family can never adopt this family's guest play.
 */
function readGuestId(): string {
  let id = storage.getItem(GUEST_KEY);
  if (!id) {
    id = uuid();
    storage.setItem(GUEST_KEY, id);
  }
  return id;
}

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
  const [guestId, setGuestId] = useState(readGuestId);
  const tapHandler = useRef<((f: Feature) => void) | null>(null);

  const queue = useMemo(() => new EventQueue(storage), []);
  const setToken = (tk: string | null) => {
    setTokenState(tk);
    try {
      if (tk) storage.setItem("dunialab.token", tk);
      else window.localStorage.removeItem("dunialab.token");
    } catch {
      /* storage blocked */
    }
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
    const fresh = uuid();
    storage.setItem(GUEST_KEY, fresh);
    setGuestId(fresh);
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
