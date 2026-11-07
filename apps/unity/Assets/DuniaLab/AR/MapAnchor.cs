#nullable enable
// Tier A: anchors the 3D Kenya terrain to the printed A2 map using AR Foundation image tracking.
// This assembly compiles only when AR Foundation >= 6 is installed (defineConstraints in DuniaLab.AR.asmdef),
// so the project still opens cleanly before running "DuniaLab > Install required packages".
//
// STATUS: scaffold, not yet run in an editor. Verify against the installed AR Foundation version
// (ARTrackedImageManager.trackablesChanged is the AR Foundation 6 event).
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace DuniaLab.AR
{
    [RequireComponent(typeof(ARTrackedImageManager))]
    public sealed class MapAnchor : MonoBehaviour
    {
        [Tooltip("Name of the reference image for the printed map (e.g. ke-explorer-a2-v1 = pack printTarget.id).")]
        [SerializeField] private string printTargetId = "ke-explorer-a2-v1";

        [Tooltip("3D terrain prefab for the content pack. Loaded from Addressables in production.")]
        [SerializeField] private GameObject terrainPrefab = null!;

        private ARTrackedImageManager _manager = null!;
        private GameObject? _terrain;

        private void Awake() => _manager = GetComponent<ARTrackedImageManager>();
        private void OnEnable() => _manager.trackablesChanged.AddListener(OnChanged);
        private void OnDisable() => _manager.trackablesChanged.RemoveListener(OnChanged);

        private void OnChanged(ARTrackablesChangedEventArgs<ARTrackedImage> args)
        {
            foreach (var image in args.added) Place(image);
            foreach (var image in args.updated) Place(image);
        }

        private void Place(ARTrackedImage image)
        {
            if (image.referenceImage.name != printTargetId) return;

            if (_terrain == null)
            {
                _terrain = Instantiate(terrainPrefab, image.transform);
                // The printed sheet's physical size (A2 = 0.594 x 0.420 m) maps to the terrain's footprint.
                _terrain.transform.localScale = new Vector3(image.size.x, image.size.x, image.size.y);
            }
            // Hide while tracking is lost so the terrain never floats away from the paper.
            _terrain.SetActive(image.trackingState == TrackingState.Tracking);
        }
    }
}
