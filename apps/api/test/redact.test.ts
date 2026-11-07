import { describe, expect, it } from "vitest";
import { REDACTED, redactIdentifiers } from "../src/explanations/redact.js";

describe("redactIdentifiers", () => {
  it.each([
    ["call 0712 345 678 now", `call ${REDACTED} now`],
    ["+254712345678", REDACTED],
    ["0712-345-678", REDACTED],
    ["(020) 123 4567", REDACTED],
    ["mail amani@example.com please", `mail ${REDACTED} please`],
    ["see https://example.com/x and www.site.ke", `see ${REDACTED} and ${REDACTED}`],
  ])("removes identifiers: %s", (input, expected) => {
    expect(redactIdentifiers(input)).toBe(expected);
  });

  it.each([
    "Mount Kenya is about 5,199 metres high",
    "3 cm x 50 km = 150 km",
    "9 cm is 450 km on the map",
    "Lake Victoria is in the west",
  ])("keeps ordinary geography answers intact: %s", (input) => {
    expect(redactIdentifiers(input)).toBe(input);
  });
});
