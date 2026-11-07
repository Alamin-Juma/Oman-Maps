/**
 * Product definition, "Child safety, data protection":
 *   "The parent creates the account and gives verified consent before any child profile exists."
 *   "Minimum data: Nickname, grade, school (optional) and learning events only.
 *    No photos, no location, no stored voice recordings."
 *   "Several child profiles live on the parent's phone, each opened with a simple picture PIN."
 */
import { afterAll, beforeAll, expect } from "vitest";
import { feature, scenario } from "../support/gherkin.js";
import { parentToken, startApi, type TestApi } from "../support/api.js";

let api: TestApi;
beforeAll(async () => (api = await startApi()));
afterAll(async () => api.close());

const child = { nickname: "Amani", grade: 5, picturePin: ["lion", "mango", "drum"] };

feature("Consent before any child profile exists", () => {
  scenario("a parent without consent cannot create a child profile", async ({ given, when, then }) => {
    let token = "";
    let status = 0;
    await given("a parent has registered but not given consent", async () => {
      token = await parentToken(api);
    });
    await when("they try to add a child", async () => {
      status = (await api.call("POST", "/v1/profiles", child, token)).status;
    });
    await then("the request is refused with 403", () => expect(status).toBe(403));
  });

  scenario("after consent, the parent can add several children on one phone", async ({ given, when, then }) => {
    let token = "";
    let list: any[] = [];
    await given("a parent has registered and accepted the current consent policy", async () => {
      token = await parentToken(api);
      const c = await api.call("POST", "/v1/consents", { policyVersion: "2026-11", accepted: true }, token);
      expect(c.status).toBe(201);
    });
    await when("they add two children", async () => {
      expect((await api.call("POST", "/v1/profiles", child, token)).status).toBe(201);
      expect((await api.call("POST", "/v1/profiles", { ...child, nickname: "Wanjiru", grade: 6 }, token)).status).toBe(201);
      list = (await api.call<any[]>("GET", "/v1/profiles", undefined, token)).body;
    });
    await then("both profiles exist and only hold nickname, grade and avatar data", () => {
      expect(list.map((p) => p.nickname).sort()).toEqual(["Amani", "Wanjiru"]);
      for (const p of list) {
        expect(Object.keys(p).sort()).toEqual(["createdAt", "grade", "id", "nickname"]);
      }
    });
  });

  scenario("the API rejects personal data it must not collect", async ({ given, when, then }) => {
    let token = "";
    let status = 0;
    await given("a consented parent", async () => {
      token = await parentToken(api);
      await api.call("POST", "/v1/consents", { policyVersion: "2026-11", accepted: true }, token);
    });
    await when("a client tries to send a date of birth and a photo for a child", async () => {
      status = (await api.call("POST", "/v1/profiles", { ...child, dateOfBirth: "2016-03-01", photoUrl: "x" }, token)).status;
    });
    await then("the request is rejected with 400", () => expect(status).toBe(400));
  });

  scenario("one parent can never see another family's children", async ({ given, when, then }) => {
    let a = "";
    let b = "";
    let seen: any[] = [];
    await given("two consented parents, one with a child", async () => {
      a = await parentToken(api);
      b = await parentToken(api);
      for (const t of [a, b]) await api.call("POST", "/v1/consents", { policyVersion: "2026-11", accepted: true }, t);
      await api.call("POST", "/v1/profiles", child, a);
    });
    await when("the second parent lists profiles", async () => {
      seen = (await api.call<any[]>("GET", "/v1/profiles", undefined, b)).body;
    });
    await then("they see none", () => expect(seen).toEqual([]));
  });
});
