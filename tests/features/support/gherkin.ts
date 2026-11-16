/**
 * Tiny Given/When/Then vocabulary on top of Vitest, so feature tests read like
 * the product definition. No extra framework: `feature` = describe,
 * `scenario` = it, and given/when/then are labelled steps that run in order.
 */
import { describe, it } from "vitest";

export const feature = (name: string, body: () => void) => describe(`Feature: ${name}`, body);

type Step = (label: string, fn?: () => unknown | Promise<unknown>) => Promise<void>;

/**
 * A scenario gets labelled steps. Each step may carry a function; steps run in order.
 * Failures report the step label, so the failing promise is obvious.
 */
type ScenarioBody = (steps: { given: Step; when: Step; then: Step; and: Step }) => Promise<void> | void;

export function scenario(name: string, body: ScenarioBody, options: { skip?: boolean; timeout?: number } = {}) {
  const register = options.skip ? it.skip : it;
  register(`Scenario: ${name}`, { timeout: options.timeout }, async () => {
    const run =
      (kind: string): Step =>
      async (label, fn) => {
        try {
          await fn?.();
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          e.message = `${kind} ${label}\n  ${e.message}`;
          throw e;
        }
      };
    await body({ given: run("Given"), when: run("When"), then: run("Then"), and: run("And") });
  });
}
