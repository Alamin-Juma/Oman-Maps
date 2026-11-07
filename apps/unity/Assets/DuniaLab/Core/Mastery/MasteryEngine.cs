#nullable enable
// C# port of packages/mastery/src/engine.ts + days.ts.
// The TypeScript engine and this one MUST agree on packages/mastery/fixtures/conformance.json.
// Change a fixture first, then both implementations.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace DuniaLab.Core.Mastery
{
    public static class Days
    {
        public static string LocalDay(string isoUtc, int utcOffsetMinutes)
        {
            var instant = DateTimeOffset.Parse(isoUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
            return instant.UtcDateTime.AddMinutes(utcOffsetMinutes).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        public static string AddDays(string day, int n)
        {
            var d = DateTime.ParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
            return d.AddDays(n).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        public static long Instant(string isoUtc) =>
            DateTimeOffset.Parse(isoUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal).ToUnixTimeMilliseconds();
    }

    public static class MasteryEngine
    {
        /// <summary>Deterministic order: by instant, then eventId (ordinal), matching the TS engine.</summary>
        public static List<AttemptEvent> Sort(IEnumerable<AttemptEvent> events) =>
            events
                .OrderBy(e => Days.Instant(e.OccurredAt))
                .ThenBy(e => e.EventId, StringComparer.Ordinal)
                .ToList();

        /// <summary>De-duplicate by eventId, keeping the first occurrence (sync may re-send).</summary>
        public static List<AttemptEvent> Dedupe(IEnumerable<AttemptEvent> events)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            return events.Where(e => seen.Add(e.EventId)).ToList();
        }

        public static Dictionary<string, SkillState> ComputeSkillStates(
            IEnumerable<AttemptEvent> events,
            MasteryRules? rules = null,
            IEnumerable<string>? skillIds = null)
        {
            rules ??= MasteryRules.Default;
            var states = new Dictionary<string, SkillState>(StringComparer.Ordinal);
            var lastPromotionDay = new Dictionary<string, string?>(StringComparer.Ordinal);

            if (skillIds != null)
                foreach (var id in skillIds) states[id] = new SkillState { SkillId = id };

            foreach (var e in Sort(Dedupe(events)))
            {
                if (!states.TryGetValue(e.SkillId, out var s))
                {
                    s = new SkillState { SkillId = e.SkillId };
                    states[e.SkillId] = s;
                }
                lastPromotionDay.TryGetValue(e.SkillId, out var promoted);
                lastPromotionDay[e.SkillId] = Apply(s, promoted, e, rules);
            }
            return states;
        }

        /// <returns>The updated "last promotion day" for this skill.</returns>
        private static string? Apply(SkillState s, string? lastPromotionDay, AttemptEvent e, MasteryRules rules)
        {
            var day = Days.LocalDay(e.OccurredAt, rules.UtcOffsetMinutes);
            var maxBox = rules.ReviewIntervalsDays.Length - 1;

            s.Attempts += 1;
            if (e.Correct)
            {
                s.Correct += 1;
                if (!s.CorrectDays.Contains(day))
                {
                    s.CorrectDays.Add(day);
                    s.CorrectDays.Sort(StringComparer.Ordinal);
                }
                if (e.Kind == "explain") s.HasCorrectExplanation = true;
            }

            if (e.Context == "review")
            {
                if (e.Correct)
                {
                    if (lastPromotionDay != day)
                    {
                        s.Box = Math.Min(s.Box + 1, maxBox);
                        lastPromotionDay = day;
                    }
                }
                else
                {
                    s.Box = 0;
                }
            }

            s.LastActivityDay = day;
            s.NextReviewDay = Days.AddDays(day, rules.ReviewIntervalsDays[s.Box]);

            var mastered = s.CorrectDays.Count >= rules.MasteryDistinctDays
                           && (!rules.RequireExplanation || s.HasCorrectExplanation);

            if (s.Status != SkillStatus.Mastered)
            {
                s.Status = mastered ? SkillStatus.Mastered : SkillStatus.Practising;
                if (mastered) s.MasteredOn = day;
            }
            return lastPromotionDay;
        }
    }
}
