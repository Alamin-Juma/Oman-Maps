import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentPack, Feature, Locale } from "@dunialab/content";
import { createMissionSession, type ExplanationChecker, type MissionSession } from "@dunialab/mission";
import type { AttemptEvent } from "@dunialab/mastery";
import { t } from "../lib/packs.js";

interface Props {
  pack: ContentPack;
  missionId: string;
  profileId: string;
  locale: Locale;
  checker?: ExplanationChecker;
  onEvents: (events: AttemptEvent[]) => void;
  onExit: () => void;
  /** Lets the map send taps to the current locate task. */
  registerTapHandler: (fn: ((f: Feature) => void) | null) => void;
  setReveal: (featureId: string | null) => void;
}

interface Banner {
  tone: "good" | "info" | "try";
  text: string;
}

export function MissionPlayer({ pack, missionId, profileId, locale, checker, onEvents, onExit, registerTapHandler, setReveal }: Props) {
  const session = useMemo<MissionSession>(() => createMissionSession({ pack, missionId, profileId }), [pack, missionId, profileId]);
  const [, setTick] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const emitted = useRef(0);
  const state = session.state();
  const task = state.task;

  const flush = () => {
    const all = session.events();
    if (all.length > emitted.current) {
      onEvents(all.slice(emitted.current));
      emitted.current = all.length;
    }
    setTick((n) => n + 1);
  };

  // Map taps go to locate tasks only.
  useEffect(() => {
    if (task?.type === "locate" && state.phase === "task") {
      registerTapHandler((f) => {
        const r = session.answerLocate(f.id);
        setReveal(task.featureId);
        setBanner({ tone: r.correct ? "good" : "info", text: `${r.correct ? "✓ " : ""}${t(r.explanation, locale)}` });
        flush();
      });
    } else {
      registerTapHandler(null);
    }
    return () => registerTapHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, state.phase]);

  const choose = (optionId: string) => {
    const r = session.answerChoice([optionId]);
    setBanner({ tone: r.correct ? "good" : "info", text: `${r.correct ? "✓ " : ""}${t(r.explanation, locale)}` });
    flush();
  };

  const explain = async () => {
    setBusy(true);
    try {
      const { feedback, hint } = await session.answerExplain(answer, locale, checker);
      if (feedback.outcome === "accepted") setBanner({ tone: "good", text: locale === "sw" ? "✓ Maelezo mazuri!" : "✓ Great explanation!" });
      else if (feedback.outcome === "hint" && hint) setBanner({ tone: "try", text: `💡 ${t(hint.text, locale)}` });
      else setBanner({ tone: "info", text: locale === "sw" ? "Tujaribu swali hili." : "Let's try this question instead." });
      setAnswer("");
      flush();
    } finally {
      setBusy(false);
    }
  };

  if (state.phase === "done") {
    return (
      <section className="panel">
        <h2>{locale === "sw" ? "Kazi imekamilika! 🎉" : "Mission complete! 🎉"}</h2>
        {banner && <p className={`banner ${banner.tone}`}>{banner.text}</p>}
        <button className="primary" onClick={onExit}>{locale === "sw" ? "Rudi kwenye misheni" : "Back to missions"}</button>
      </section>
    );
  }

  return (
    <section className="panel">
      <header className="mission-head">
        <button className="link" onClick={onExit}>← {locale === "sw" ? "Toka" : "Exit"}</button>
        <span className="progress">{state.index + 1} / {state.total}</span>
      </header>
      <h2>{t(state.mission.title, locale)}</h2>
      {state.index === 0 && !banner && <p className="intro">{t(state.mission.intro, locale)}</p>}
      {banner && <p className={`banner ${banner.tone}`}>{banner.text}</p>}

      {task && <p className="prompt">{t(task.prompt, locale)}</p>}

      {task?.type === "choice" && (
        <div className="choices">
          {task.options.map((o) => (
            <button key={o.id} onClick={() => choose(o.id)}>{t(o.text, locale)}</button>
          ))}
        </div>
      )}

      {task?.type === "locate" && <p className="hint-text">👆 {locale === "sw" ? "Gusa kwenye ramani" : "Tap it on the map"}</p>}

      {task?.type === "explain" && (
        <div className="explain">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder={locale === "sw" ? "Andika maelezo yako..." : "Write your explanation..."}
          />
          {task.wordBank && (
            <div className="word-bank">
              {task.wordBank[locale].map((w) => (
                <button key={w} className="chip" onClick={() => setAnswer((a) => `${a}${a && !a.endsWith(" ") ? " " : ""}${w}`)}>{w}</button>
              ))}
            </div>
          )}
          <button className="primary" disabled={busy || answer.trim().length === 0} onClick={explain}>
            {busy ? "…" : locale === "sw" ? "Tuma" : "Check my answer"}
          </button>
        </div>
      )}
    </section>
  );
}
