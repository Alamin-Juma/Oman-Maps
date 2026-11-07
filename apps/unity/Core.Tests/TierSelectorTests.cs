using DuniaLab.Core.Device;
using NUnit.Framework;

namespace DuniaLab.Core.Tests
{
    public class TierSelectorTests
    {
        [Test]
        public void ArCoreCertifiedPhoneGetsFullAr() =>
            Assert.That(TierSelector.Select(new DeviceCapabilities { HasCamera = true, ArCoreSupported = true, SystemMemoryMb = 2000 }),
                Is.EqualTo(ExperienceTier.A_FullAr));

        [Test]
        public void ThreeGigabytePhoneWithoutArCoreGetsScanAndPop() =>
            Assert.That(TierSelector.Select(new DeviceCapabilities { HasCamera = true, ArCoreSupported = false, SystemMemoryMb = 2850 }),
                Is.EqualTo(ExperienceTier.B_ScanAndPop));

        [Test]
        public void LowMemoryPhoneGetsFlatMap() =>
            Assert.That(TierSelector.Select(new DeviceCapabilities { HasCamera = true, ArCoreSupported = false, SystemMemoryMb = 1900 }),
                Is.EqualTo(ExperienceTier.C_FlatMap));

        [Test]
        public void NoCameraAlwaysGetsFlatMap() =>
            Assert.That(TierSelector.Select(new DeviceCapabilities { HasCamera = false, ArCoreSupported = true, SystemMemoryMb = 8000 }),
                Is.EqualTo(ExperienceTier.C_FlatMap));

        [Test]
        public void ParentOverrideWins() =>
            Assert.That(TierSelector.Select(new DeviceCapabilities { HasCamera = true, ArCoreSupported = true, ForcedTier = ExperienceTier.C_FlatMap }),
                Is.EqualTo(ExperienceTier.C_FlatMap));
    }
}
