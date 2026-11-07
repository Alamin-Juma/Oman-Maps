using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using DuniaLab.Core.Mastery;
using NUnit.Framework;

namespace DuniaLab.Core.Tests
{
    /// <summary>
    /// Runs packages/mastery/fixtures/conformance.json against the C# engine.
    /// The TypeScript engine runs the same file (packages/mastery/test/engine.test.ts).
    /// </summary>
    public class MasteryConformanceTests
    {
        private static readonly JsonSerializerOptions Json = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

        private sealed class Fixture
        {
            public MasteryRules Rules { get; set; } = new MasteryRules();
            public List<Case> Cases { get; set; } = new List<Case>();
        }

        public sealed class Case
        {
            public string Name { get; set; } = "";
            public List<AttemptEvent> Events { get; set; } = new List<AttemptEvent>();
            public Dictionary<string, JsonElement> Expected { get; set; } = new Dictionary<string, JsonElement>();
            public override string ToString() => Name;
        }

        private static Fixture Load()
        {
            var path = Path.Combine(AppContext.BaseDirectory, "fixtures", "conformance.json");
            return JsonSerializer.Deserialize<Fixture>(File.ReadAllText(path), Json)!;
        }

        public static IEnumerable<Case> Cases() => Load().Cases;

        [TestCaseSource(nameof(Cases))]
        public void Conforms(Case c)
        {
            var rules = Load().Rules;
            var states = MasteryEngine.ComputeSkillStates(c.Events, rules);

            foreach (var kv in c.Expected)
            {
                Assert.That(states.ContainsKey(kv.Key), $"missing skill {kv.Key}");
                var s = states[kv.Key];
                var exp = kv.Value;

                if (exp.TryGetProperty("status", out var status)) Assert.That(s.Status, Is.EqualTo(status.GetString()), "status");
                if (exp.TryGetProperty("attempts", out var attempts)) Assert.That(s.Attempts, Is.EqualTo(attempts.GetInt32()), "attempts");
                if (exp.TryGetProperty("box", out var box)) Assert.That(s.Box, Is.EqualTo(box.GetInt32()), "box");
                if (exp.TryGetProperty("nextReviewDay", out var next)) Assert.That(s.NextReviewDay, Is.EqualTo(next.GetString()), "nextReviewDay");
                if (exp.TryGetProperty("masteredOn", out var on))
                    Assert.That(s.MasteredOn, Is.EqualTo(on.ValueKind == JsonValueKind.Null ? null : on.GetString()), "masteredOn");
                if (exp.TryGetProperty("correctDays", out var days))
                    Assert.That(s.CorrectDays, Is.EqualTo(days.EnumerateArray().Select(d => d.GetString()).ToList()), "correctDays");
            }
        }
    }
}
