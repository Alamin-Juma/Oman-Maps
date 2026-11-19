/**
 * One parent's sign-in on this device, as a scope (findings register S7).
 *
 * On a shared family phone, an answer that was requested before sign-out can arrive after it.
 * Anything that puts server data on screen is wrapped with `guard`; once the session ends, those
 * late answers are dropped instead of bringing the previous family's data back.
 */
export class SessionScope {
  private generation = 0;

  /** Changes every time a session ends. */
  get current(): number {
    return this.generation;
  }

  /** End the current session: every guard created before this point stops doing anything. */
  end(): void {
    this.generation++;
  }

  /** Wrap a callback so it runs only while the session it was created in is still current. */
  guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
    const created = this.generation;
    return (...args: A) => {
      if (created === this.generation) fn(...args);
    };
  }
}

/**
 * True when a failed request means the sign-in itself is over (findings register S8): a 401 from
 * any protected call. A 401 from the sign-in or sign-up form is only a wrong password, and a 403 is
 * a refusal by a signed-in parent; neither ends the session.
 */
export function endsSession(status: number, path: string): boolean {
  return status === 401 && !path.startsWith("/v1/auth/");
}
