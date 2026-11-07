/**
 * Parent area: account, consent, child profiles, sync and the weekly report.
 * Consent comes before any child profile (enforced by the API too).
 */
import { useEffect, useState } from "react";
import type { ContentPack, Locale } from "@dunialab/content";
import { ApiError, type DuniaApi, type Profile, type Report } from "../lib/api.js";
import type { EventQueue } from "../lib/queue.js";

const POLICY_VERSION = "2026-11";
const PICTURES = ["lion", "elephant", "giraffe", "zebra", "mango", "banana", "drum", "ball", "sun", "moon", "fish", "boat"];

interface Props {
  api: DuniaApi;
  queue: EventQueue;
  pack: ContentPack;
  locale: Locale;
  token: string | null;
  setToken: (t: string | null) => void;
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;
}

export function FamilyPanel({ api, queue, pack, locale, token, setToken, profile, setProfile }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consented, setConsented] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.status}: ${e.message}` : (e as Error).message || "Network error: are you online?");
    }
  };

  useEffect(() => {
    if (token) void run(async () => setProfiles(await api.profiles()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) {
    return (
      <section className="panel">
        <h3>{locale === "sw" ? "Eneo la mzazi" : "Parent area"}</h3>
        <p className="muted">{locale === "sw" ? "Ingia ili kuhifadhi maendeleo na kuona ripoti ya wiki." : "Sign in to back up progress and see the weekly report."}</p>
        <input type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <input type="password" placeholder={locale === "sw" ? "nenosiri (herufi 10+)" : "password (10+ characters)"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <div className="row">
          <button className="primary" onClick={() => run(async () => setToken((await api.login(email, password)).token))}>{locale === "sw" ? "Ingia" : "Sign in"}</button>
          <button onClick={() => run(async () => setToken((await api.register(email, password)).token))}>{locale === "sw" ? "Fungua akaunti" : "Create account"}</button>
        </div>
        {msg && <p className="banner try">{msg}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <h3>{locale === "sw" ? "Eneo la mzazi" : "Parent area"}</h3>

      {profiles.length === 0 && (
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
                setProfiles([p]);
                setProfile(p);
                queue.reassignProfile(p.id);
              })
            }
          >
            {locale === "sw" ? "Ongeza mtoto" : "Add child"}
          </button>
        </div>
      )}

      {profiles.length > 0 && (
        <div className="stack">
          <select value={profile?.id ?? ""} onChange={(e) => { const p = profiles.find((x) => x.id === e.target.value) ?? null; setProfile(p); if (p) queue.reassignProfile(p.id); }}>
            <option value="">{locale === "sw" ? "Chagua mtoto" : "Choose child"}</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.nickname} (Grade {p.grade})</option>)}
          </select>
          {profile && (
            <div className="row">
              <button
                className="primary"
                onClick={() =>
                  run(async () => {
                    queue.reassignProfile(profile.id);
                    const pending = queue.unsynced(pack.id);
                    const r = await api.sync(profile.id, pack.id, pending);
                    queue.markSynced(pending.map((e) => e.eventId));
                    setMsg(`${locale === "sw" ? "Imesawazishwa" : "Synced"}: ${r.accepted} new, ${r.duplicates} already saved`);
                  })
                }
              >
                {locale === "sw" ? "Sawazisha" : "Sync now"} ({queue.unsynced(pack.id).length})
              </button>
              <button onClick={() => run(async () => setReport(await api.report(profile.id, pack.id, locale)))}>{locale === "sw" ? "Ripoti ya wiki" : "Weekly report"}</button>
            </div>
          )}
        </div>
      )}

      {report && (
        <div className="report">
          <h4>{report.profile.nickname}: {report.fromDay} → {report.toDay}</h4>
          <p>
            {locale === "sw" ? "Ujuzi uliofahamika wiki hii" : "Skills mastered this week"}: <strong>{report.skillsMasteredThisWeek}</strong> ·{" "}
            {locale === "sw" ? "Siku za kujifunza" : "Active days"}: <strong>{report.activeDays}</strong>
          </p>
          <ul className="skills">
            {report.lines.filter((l) => l.status !== "not-started").map((l) => (
              <li key={l.skillId}>
                <span>{l.label}</span>
                <span className={`status ${l.status}`}>{l.masteredThisWeek ? "★ " : ""}{l.status}{l.needsSupport ? (locale === "sw" ? " · inahitaji msaada" : " · needs support") : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && <p className="banner info">{msg}</p>}
      <button className="link" onClick={() => { setToken(null); setProfile(null); setReport(null); }}>{locale === "sw" ? "Toka" : "Sign out"}</button>
    </section>
  );
}
