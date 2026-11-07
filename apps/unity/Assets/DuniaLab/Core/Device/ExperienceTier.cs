#nullable enable
// Experience tiers (product definition, "Three experience tiers"):
//   A: Full AR       - phones certified for ARCore
//   B: Scan and pop  - any Android phone with a camera and about 3 GB of RAM or more
//   C: 2D map        - everything else (and laptops / the web)
// All tiers share one mission and mastery layer, so results are comparable.
namespace DuniaLab.Core.Device
{
    public enum ExperienceTier
    {
        A_FullAr,
        B_ScanAndPop,
        C_FlatMap,
    }

    public sealed class DeviceCapabilities
    {
        public bool HasCamera { get; set; }
        /// <summary>Result of ARCore availability check (AR Foundation ARSession.CheckAvailability).</summary>
        public bool ArCoreSupported { get; set; }
        public int SystemMemoryMb { get; set; }
        /// <summary>Parent/teacher override, e.g. to force the 2D map on a struggling phone.</summary>
        public ExperienceTier? ForcedTier { get; set; }
    }

    public static class TierSelector
    {
        /// <summary>"about 3 GB": Android reports a little less than the marketed RAM.</summary>
        public const int TierBMinMemoryMb = 2800;

        public static ExperienceTier Select(DeviceCapabilities d)
        {
            if (d.ForcedTier.HasValue) return d.ForcedTier.Value;
            if (!d.HasCamera) return ExperienceTier.C_FlatMap;
            if (d.ArCoreSupported) return ExperienceTier.A_FullAr;
            return d.SystemMemoryMb >= TierBMinMemoryMb ? ExperienceTier.B_ScanAndPop : ExperienceTier.C_FlatMap;
        }
    }
}
