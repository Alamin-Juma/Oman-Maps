/**
 * Product definition:
 *   Tier B ("scan-and-pop") needs the phone's camera; Tier A needs it for AR.
 *   "No camera image leaves the device."
 *
 * Before any of that, a parent or pilot tester must be able to answer one question on a
 * real phone: does the camera open at all? This specifies the device check that answers it,
 * including the two failures that actually happen in the field — an insecure LAN address
 * (the camera API is unavailable, with no prompt) and a refused permission.
 */
import { expect } from "vitest";
import { cameraSupport, cameraFailure } from "../../../apps/web/src/lib/camera.js";
import { feature, scenario } from "../support/gherkin.js";

feature("Device check: can this phone open its camera?", () => {
  scenario("the camera is available on a phone served over HTTPS", async ({ given, when, then }) => {
    let verdict = cameraSupport({ secureContext: false, hasCameraApi: false, hostname: "" });
    await given("a pilot phone opening the app over HTTPS", () => {});
    await when("the device check runs", () => {
      verdict = cameraSupport({ secureContext: true, hasCameraApi: true, hostname: "dunialab.example" });
    });
    await then("the check offers to start the camera", () => expect(verdict.usable).toBe(true));
  });

  scenario("a phone on a plain-HTTP LAN address is told to use HTTPS, not shown a dead button", async ({ given, when, then, and }) => {
    let verdict = cameraSupport({ secureContext: true, hasCameraApi: true, hostname: "" });
    await given("a phone opening the dev server by LAN IP over plain HTTP", () => {});
    await when("the device check runs", () => {
      verdict = cameraSupport({ secureContext: false, hasCameraApi: false, hostname: "192.168.1.42" });
    });
    await then("the camera is reported unusable for this address, not broken", () => {
      expect(verdict.usable).toBe(false);
      expect(verdict.usable === false && verdict.reason).toBe("insecure-origin");
    });
    await and("the guidance names HTTPS so the tester can fix it", () => {
      expect(verdict.usable === false && verdict.detail.en).toMatch(/https/i);
      expect(verdict.usable === false && verdict.detail.sw).not.toHaveLength(0);
    });
  });

  scenario("the laptop's own localhost counts as secure, so the check works with no certificate", async ({ given, when, then }) => {
    let verdict = cameraSupport({ secureContext: true, hasCameraApi: true, hostname: "" });
    await given("a developer running the app on their laptop at localhost", () => {});
    await when("the device check runs", () => {
      verdict = cameraSupport({ secureContext: true, hasCameraApi: true, hostname: "localhost" });
    });
    await then("the camera is usable", () => expect(verdict.usable).toBe(true));
  });

  scenario("a refused permission is explained in the parent's language, never as an error code", async ({ given, when, then, and }) => {
    let refused = cameraFailure(new Error("x"), "en");
    await given("a parent who tapped 'Block' on the camera prompt", () => {});
    await when("the device check reports the failure", () => {
      refused = cameraFailure({ name: "NotAllowedError" }, "en");
    });
    await then("the message tells them permission was refused and how to allow it", () => {
      expect(refused).toMatch(/permission/i);
      expect(refused).not.toMatch(/NotAllowedError/);
    });
    await and("the same failure is available in Kiswahili", () => {
      expect(cameraFailure({ name: "NotAllowedError" }, "sw")).not.toBe(refused);
    });
  });

  scenario("a phone with no usable camera is distinguished from a blocked one", async ({ given, when, then, and }) => {
    await given("the device check has run", () => {});
    let missing = "";
    let busy = "";
    await when("the camera is absent, and separately in use by another app", () => {
      missing = cameraFailure({ name: "NotFoundError" }, "en");
      busy = cameraFailure({ name: "NotReadableError" }, "en");
    });
    await then("the two cases read differently", () => expect(missing).not.toBe(busy));
    await and("an unknown failure still produces guidance rather than nothing", () => {
      expect(cameraFailure({ name: "WeirdNewError" }, "en").length).toBeGreaterThan(10);
    });
  });
});
