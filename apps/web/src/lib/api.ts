/** Thin, typed client for the DuniaLab API. `fetch` is injectable for tests. */
import type { ExplanationFeedback, ExplainTask, Locale } from "@dunialab/content";
import type { AttemptEvent, SkillState } from "@dunialab/mastery";
import { endsSession } from "./session.js";

export interface ReportLine {
  skillId: string;
  label: string;
  status: SkillState["status"];
  masteredThisWeek: boolean;
  needsSupport: boolean;
  attemptsThisWeek: number;
  correctThisWeek: number;
}

export interface Report {
  profile: { id: string; nickname: string };
  pack: { id: string; title: string };
  fromDay: string;
  toDay: string;
  activeDays: number;
  skillsMasteredThisWeek: number;
  skillsMasteredTotal: number;
  lines: ReportLine[];
}

export interface Profile {
  id: string;
  nickname: string;
  grade: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class DuniaApi {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    /** A mission never waits on the network: a stalled check must fail fast to the local checker. */
    private readonly checkTimeoutMs = 6000,
    /** Called when the server says the sign-in is over (a 401 on a protected call); see lib/session.ts. */
    private readonly onSessionExpired?: () => void,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
    const token = this.getToken();
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      if (endsSession(res.status, path)) this.onSessionExpired?.();
      throw new ApiError(res.status, (data && (data.message as string)) || res.statusText);
    }
    return data as T;
  }

  register = (email: string, password: string) => this.call<{ token: string }>("POST", "/v1/auth/register", { email, password });
  login = (email: string, password: string) => this.call<{ token: string }>("POST", "/v1/auth/login", { email, password });
  consent = (policyVersion: string) => this.call("POST", "/v1/consents", { policyVersion, accepted: true });
  profiles = () => this.call<Profile[]>("GET", "/v1/profiles");
  addProfile = (nickname: string, grade: number, picturePin: string[]) =>
    this.call<Profile>("POST", "/v1/profiles", { nickname, grade, picturePin });
  sync = (profileId: string, packId: string, events: AttemptEvent[]) =>
    this.call<{ accepted: number; duplicates: number; skills: SkillState[] }>("POST", "/v1/sync", { profileId, packId, events });
  report = (profileId: string, packId: string, locale: Locale, week?: string) =>
    this.call<Report>(
      "GET",
      `/v1/profiles/${encodeURIComponent(profileId)}/report?packId=${encodeURIComponent(packId)}&locale=${locale}${week ? `&week=${week}` : ""}`,
    );

  /** Online explanation check; the mission session falls back to the local checker on any error. */
  checkerFor = (packId: string) => (task: ExplainTask, answer: string, locale: Locale, attempt: number) =>
    this.call<ExplanationFeedback>("POST", "/v1/explanations/check", { packId, taskId: task.id, answer, locale, attempt }, this.checkTimeoutMs);
}
