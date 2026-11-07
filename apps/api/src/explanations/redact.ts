/**
 * Remove obvious personal identifiers from a child's answer BEFORE it leaves our API
 * for an external AI provider (ADR-0005, PR #1 review).
 *
 * This is an egress control, separate from the model's `unsafe` flag (a feedback control).
 * It is intentionally conservative: emails, links and phone-like digit runs (7+ digits).
 * Names cannot be detected reliably; the rubric-only prompt and no-storage policy cover that risk.
 */
export const REDACTED = "[removed]";

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
/** A run of digits possibly separated by spaces, dots, dashes or brackets, optionally starting with + or (. */
const DIGIT_RUN = /\+?\(?\d[\d\s().-]*\d/g;
const MIN_PHONE_DIGITS = 7;

export function redactIdentifiers(text: string): string {
  return text
    .replace(EMAIL, REDACTED)
    .replace(URL, REDACTED)
    .replace(DIGIT_RUN, (run) => (run.replace(/\D/g, "").length >= MIN_PHONE_DIGITS ? REDACTED : run));
}
