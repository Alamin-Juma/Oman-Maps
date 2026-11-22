/**
 * Parent area: account, consent, child profiles, sync and the weekly report.
 * Consent comes before any child profile (enforced by the API too).
 */
import { useEffect, useRef, useState } from "react";
import type { ContentPack, Locale } from "@dunialab/content";
import { ApiError, type DuniaApi, type Profile, type Report } from "../lib/api.js";
import type { EventQueue } from "../lib/queue.js";
import { syncInBatches } from "../lib/sync.js";

const POLICY_VERSION = "2026-11";
const PICTURES = ["lion", "elephant", "giraffe", "zebra", "mango", "banana", "drum", "ball", "sun", "moon", "fish", "boat"];

interface Props {
  api: DuniaApi;
  queue: EventQueue;
  pack: ContentPack;
  locale: Locale;
  token: string | null;
  setToken: (t: string | null) => void;
  /** Clears the session in App (token, profile, new guest id). */
  onSignOut: () => void;
  /** Current session's guest id: its events are adopted by the first linked child. */
  guestId: string;
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;
}

/**
 * The children list is loading, failed, or loaded (possibly empty). Each looks different: a parent
 * whose list has not arrived must never be offered "Add child" (findings register CR33, E4).
 */
type ChildList = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; profiles: Profile[] };

export function FamilyPanel({ api, queue, pack, locale, token, setToken, onSignOut, guestId, profile, setProfile }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consented, setConsented] = useState(false);
  const [children, setChildren] = useState<ChildList>({ kind: "loading" });
  const [reloadChildren, setReloadChildren] = useState(0);
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  /** A report and the child and pack it belongs to (findings register CR34). */
  const [report, setReport] = useState<{ scope: string; data: Report } | null>(null);
  /** One sign-in or sign-up at a time: a second press must not send a second request (CR6). */
  const [signingIn, setSigningIn] = useState(false);
  const signingInRef = useRef(false);
  const scope = profile ? `${profile.id}|${pack.id}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const profiles = children.kind === "ready" ? children.profiles : [];

  const run = async (fn: () => Promise<void>) => {
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.status}: ${e.message}` : (e as Error).message || "Network error: are you online?");
    }
  };

  useEffect(() => {
    if (!token) return;
    let current = true;
    setChildren({ kind: "loading" });
    api.profiles().then(
      (list) => current && setChildren({ kind: "ready", profiles: list }),
      (e: unknown) => current && setChildren({ kind: "failed", message: e instanceof ApiError ? `${e.status}: ${e.message}` : "Network error: are you online?" }),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reloadChildren]);

  /** Run one sign-in or sign-up; further presses are ignored until it finishes. */
  const signInWith = (request: () => Promise<{ token: string }>) => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setSigningIn(true);
    void run(async () => setToken((await request()).token)).finally(() => {
      signingInRef.current = false;
      setSigningIn(false);
    });
  };

  if (!token) {
    return (
      <section className="panel">
        <h3>{locale === "sw" ? "Eneo la mzazi" : "Parent area"}</h3>
        <p className="muted">{locale === "sw" ? "Ingia ili kuhifadhi maendeleo na kuona ripoti ya wiki." : "Sign in to back up progress and see the weekly report."}</p>
        <input type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <input type="password" placeholder={locale === "sw" ? "nenosiri (herufi 10+)" : "password (10+ characters)"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <div className="row">
          <button className="primary" disabled={signingIn} onClick={() => signInWith(() => api.login(email, password))}>{locale === "sw" ? "Ingia" : "Sign in"}</button>
          <button disabled={signingIn} onClick={() => signInWith(() => api.register(email, password))}>{locale === "sw" ? "Fungua akaunti" : "Create account"}</button>
        </div>
        {msg && <p className="banner try">{msg}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <h3>{locale === "sw" ? "Eneo la mzazi" : "Parent area"}</h3>

      {children.kind === "loading" && (
        <p className="muted" role="status">{locale === "sw" ? "Inapakia watoto..." : "Loading children..."}</p>
      )}
      {children.kind === "failed" && (
        <div className="stack">
          <p className="banner try" role="alert">
            {locale === "sw" ? "Hatukuweza kupakia watoto wako." : "We could not load your children."} {children.message}
          </p>
          <button onClick={() => setReloadChildren((n) => n + 1)}>{locale === "sw" ? "Jaribu tena" : "Try again"}</button>
        </div>
      )}

      {children.kind === "ready" && profiles.length === 0 && (
        <div className="stack">
          <label className="consent">
            <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
            <span>
              {locale === "sw"
                ? "Mimi ni mzazi/mlezi. Nakubali DuniaLab ihifadhi jina la utani, darasa na matokeo ya kujifunza ya mtoto wangu tu."
                : "I am the parent/guardian. I agree DuniaLab stores only my child's nickname, grade and learning results."}
            </span>
          </label>
          <input placeholder={locale === "sw" ? "Jina la utani la mtoto" : "Child's nickname"} value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} />
          <p className="muted">{locale === "sw" ? "Chagua picha 3 za siri:" : "Pick 3 secret pictures:"} {pin.join(" · ")}</p>
          <div className="word-bank">
            {PICTURES.map((p) => (
              <button key={p} className={`chip ${pin.includes(p) ? "on" : ""}`} onClick={() => setPin((x) => (x.includes(p) ? x.filter((y) => y !== p) : x.length < 3 ? [...x, p] : x))}>{p}</button>
            ))}
          </div>
          <button
            className="primary"
            disabled={!consented || !nickname || pin.length !== 3}
            onClick={() =>
              run(async () => {
                await api.consent(POLICY_VERSION);
                const p = await api.addProfile(nickname, pack.grade, pin);
                setChildren({ kind: "ready", profiles: [p] });
                queue.adoptGuestEvents(guestId, p.id);
                setProfile(p);
              })
            }
          >
            {locale === "sw" ? "Ongeza mtoto" : "Add child"}
          </button>
        </div>
      )}

      {profiles.length > 0 && (
        <div className="stack">
          <select aria-label={locale === "sw" ? "Mtoto" : "Child"} value={profile?.id ?? ""} onChange={(e) => { const p = profiles.find((x) => x.id === e.target.value) ?? null; if (p) queue.adoptGuestEvents(guestId, p.id); setProfile(p); }}>
            <option value="">{locale === "sw" ? "Chagua mtoto" : "Choose child"}</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.nickname} (Grade {p.grade})</option>)}
          </select>
          {profile && (
            <div className="row">
              <button
                className="primary"
                onClick={() =>
                  run(async () => {
                    // In batches the server accepts; a failure part-way keeps what was sent (findings register R4).
                    const r = await syncInBatches(queue, api, pack.id, profile.id);
                    if (r.error && r.sent === 0) throw r.error;
                    const done = `${locale === "sw" ? "Imesawazishwa" : "Synced"}: ${r.accepted} new, ${r.duplicates} already saved`;
                    const left =
                      r.remaining > 0
                        ? locale === "sw"
                          ? `. ${r.remaining} bado zinasubiri; jaribu tena muunganisho ukirudi.`
                          : `. ${r.remaining} still waiting; try again when the connection is back.`
                        : "";
                    setMsg(done + left);
                  })
                }
              >
                {locale === "sw" ? "Sawazisha" : "Sync now"} ({queue.unsynced(pack.id, profile.id).length})
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    const asked = scope;
                    const data = await api.report(profile.id, pack.id, locale);
                    // A late answer for a child or pack no longer selected is dropped (CR34).
                    if (asked !== null && asked === scopeRef.current) setReport({ scope: asked, data });
                  })
                }
              >
                {locale === "sw" ? "Ripoti ya wiki" : "Weekly report"}
              </button>
            </div>
          )}
        </div>
      )}

      {report && report.scope === scope && (
        <div className="report">
          <h4>{report.data.profile.nickname}: {report.data.fromDay} → {report.data.toDay}</h4>
          <p>
            {locale === "sw" ? "Ujuzi uliofahamika wiki hii" : "Skills mastered this week"}: <strong>{report.data.skillsMasteredThisWeek}</strong> ·{" "}
            {locale === "sw" ? "Siku za kujifunza" : "Active days"}: <strong>{report.data.activeDays}</strong>
          </p>
          <ul className="skills">
            {report.data.lines.filter((l) => l.status !== "not-started").map((l) => (
              <li key={l.skillId}>
                <span>{l.label}</span>
                <span className={`status ${l.status}`}>{l.masteredThisWeek ? "★ " : ""}{l.status}{l.needsSupport ? (locale === "sw" ? " · inahitaji msaada" : " · needs support") : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && <p className="banner info">{msg}</p>}
      <button
        className="link"
        onClick={() => {
          // Shared device: nothing from this parent may carry over to the next one,
          // in particular the consent tick (consent must be a fresh, explicit act).
          setChildren({ kind: "loading" });
          setConsented(false);
          setNickname("");
          setPin([]);
          setPassword("");
          setEmail("");
          setReport(null);
          setMsg(null);
          onSignOut();
        }}
      >
        {locale === "sw" ? "Toka" : "Sign out"}
      </button>
    </section>
  );
}
