#nullable enable
// Installs the packages DuniaLab needs, at the versions Unity verifies for THIS editor.
// We do not hard-code versions in Packages/manifest.json because AR Foundation / ARCore
// versions are tied to the editor release; letting Package Manager resolve them avoids
// "package not found" on open. After running, commit Packages/manifest.json + packages-lock.json
// so every machine gets the same versions.
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEngine;

namespace DuniaLab.Editor
{
    public static class PackageBootstrap
    {
        // Name only => Package Manager picks the version recommended for this editor.
        private static readonly string[] Required =
        {
            "com.unity.xr.arfoundation",          // Tier A: AR session, image tracking
            "com.unity.xr.arcore",                // Tier A: ARCore provider (Android)
            "com.unity.xr.management",
            "com.unity.addressables",             // downloadable content packs (30-50 MB each)
            "com.unity.render-pipelines.universal",
            "com.unity.inputsystem",
            "com.unity.localization",             // English + Kiswahili UI strings
            "com.unity.nuget.newtonsoft-json",    // parse content-pack JSON
            "com.unity.test-framework",
        };

        private static AddAndRemoveRequest? _request;

        [MenuItem("DuniaLab/Install required packages")]
        public static void Install()
        {
            Debug.Log("[DuniaLab] Installing packages: " + string.Join(", ", Required));
            _request = Client.AddAndRemove(Required, null);
            EditorApplication.update += Progress;
        }

        private static void Progress()
        {
            if (_request == null || !_request.IsCompleted) return;
            if (_request.Status == StatusCode.Success)
                Debug.Log("[DuniaLab] Packages installed. Commit Packages/manifest.json and packages-lock.json.");
            else
                Debug.LogError("[DuniaLab] Package install failed: " + _request.Error?.message);
            EditorApplication.update -= Progress;
            _request = null;
        }
    }
}
