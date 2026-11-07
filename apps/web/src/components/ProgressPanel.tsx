import type { ContentPack, Locale } from "@dunialab/content";
import { computeSkillStates, type AttemptEvent } from "@dunialab/mastery";
import { t } from "../lib/packs.js";

/** Mastery status per skill, computed on the device from local events. Never a percentage. */
export function ProgressPanel({ pack, events, locale }: { pack: ContentPack; events: AttemptEvent[]; locale: Locale }) {
  const states = computeSkillStates(events, undefined, pack.skills.map((s) => s.id));
  const label = { "not-started": locale === "sw" ? "Bado" : "Not started", practising: locale === "sw" ? "Inafanyiwa mazoezi" : "Practising", mastered: locale === "sw" ? "Imeeleweka" : "Mastered" };
  return (
    <section className="panel">
      <h3>{locale === "sw" ? "Maendeleo yangu" : "My progress"}</h3>
      <ul className="skills">
        {pack.skills.map((s) => {
          const st = states[s.id]!;
          return (
            <li key={s.id}>
              <span>{t(s.parentLabel, locale)}</span>
              <span className={`status ${st.status}`}>{label[st.status]}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
