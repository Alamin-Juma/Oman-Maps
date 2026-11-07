#nullable enable
// C# port of packages/mastery/src/types.ts.
// Plain C# 9 with no UnityEngine references: compiled by Unity (DuniaLab.Core.asmdef)
// AND by apps/unity/Core.Tests with `dotnet test`, against the shared JSON fixtures.
using System.Collections.Generic;

namespace DuniaLab.Core.Mastery
{
    public sealed class AttemptEvent
    {
        public string EventId { get; set; } = "";
        public string ProfileId { get; set; } = "";
        public string SkillId { get; set; } = "";
        public string TaskId { get; set; } = "";
        /// <summary>"choice" | "locate" | "explain" | "follow-up"</summary>
        public string Kind { get; set; } = "choice";
        public bool Correct { get; set; }
        /// <summary>ISO-8601 UTC instant from the device clock.</summary>
        public string OccurredAt { get; set; } = "";
        /// <summary>"mission" | "review"</summary>
        public string Context { get; set; } = "mission";
        /// <summary>"ai" | "local" | null</summary>
        public string? CheckedBy { get; set; }
    }

    public sealed class MasteryRules
    {
        public int MasteryDistinctDays { get; set; } = 2;
        public bool RequireExplanation { get; set; } = true;
        /// <summary>Kenya (EAT) = +180, no daylight saving.</summary>
        public int UtcOffsetMinutes { get; set; } = 180;
        public int[] ReviewIntervalsDays { get; set; } = { 1, 3, 7, 14, 30 };

        public static MasteryRules Default => new MasteryRules();
    }

    public static class SkillStatus
    {
        public const string NotStarted = "not-started";
        public const string Practising = "practising";
        public const string Mastered = "mastered";
    }

    public sealed class SkillState
    {
        public string SkillId { get; set; } = "";
        public string Status { get; set; } = SkillStatus.NotStarted;
        public int Attempts { get; set; }
        public int Correct { get; set; }
        /// <summary>Sorted distinct local days (yyyy-MM-dd) with at least one correct attempt.</summary>
        public List<string> CorrectDays { get; set; } = new List<string>();
        public bool HasCorrectExplanation { get; set; }
        public string? MasteredOn { get; set; }
        public int Box { get; set; }
        public string? LastActivityDay { get; set; }
        public string? NextReviewDay { get; set; }
    }
}
