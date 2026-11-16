/**
 * Data budgets for delivering content to budget Android phones on paid mobile data.
 * Source: docs/briefs/3d-explorer.md §3.6 and ADR-0009. Written down once, here, so the
 * generator (tools/geo), the web bundle test and the asset tests all enforce the same numbers.
 *
 * Megabytes are decimal (1 MB = 1,000,000 bytes): the unit mobile data bundles are sold in.
 * Changing a number here is a product decision: update the brief/ADR in the same change.
 */
export const BYTES_PER_MB = 1_000_000;

export const DELIVERY_BUDGET = {
  /**
   * JavaScript the browser must download before the app is usable, gzip-compressed.
   * Measured before any 3D work: 145.7 kB. 3D code must be a lazy chunk, so this must not grow.
   */
  initialJsGzipBytes: 150_000,
  /** Everything downloaded the first time a child opens the 3D view (3D code + country overview). */
  first3dOpenBytes: 3 * BYTES_PER_MB,
  /** One HD close-up patch (e.g. around a mountain), all of its files together. */
  hdFeaturePatchBytes: 1.5 * BYTES_PER_MB,
  /** All 3D assets of one content pack together. */
  pack3dTotalBytes: 25 * BYTES_PER_MB,
  /** Total Git LFS size at which the agent must stop and ask the founder (brief §8). */
  lfsStopAndAskBytes: 50 * BYTES_PER_MB,
} as const;

/** What a tool or test measured. Only the fields that are present are judged. */
export interface DeliveryMeasurement {
  initialJsGzipBytes?: number;
  first3dOpenBytes?: number;
  /** Size of each HD feature patch, keyed by a name that identifies it in the message. */
  hdFeaturePatchBytes?: Readonly<Record<string, number>>;
  pack3dTotalBytes?: number;
}

const mb = (bytes: number) => `${(bytes / BYTES_PER_MB).toFixed(2)} MB`;

/**
 * Compare measurements with the budgets.
 * @returns one plain-language message per budget that is exceeded; empty when all is well.
 */
export function deliveryBudgetViolations(measured: DeliveryMeasurement): string[] {
  const violations: string[] = [];
  const check = (what: string, value: number | undefined, limit: number) => {
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < 0) violations.push(`${what}: invalid measurement (${value})`);
    else if (value > limit) violations.push(`${what}: ${mb(value)} is over the ${mb(limit)} budget`);
  };

  check("first page load (JavaScript, gzip)", measured.initialJsGzipBytes, DELIVERY_BUDGET.initialJsGzipBytes);
  check("first 3D open", measured.first3dOpenBytes, DELIVERY_BUDGET.first3dOpenBytes);
  for (const [name, bytes] of Object.entries(measured.hdFeaturePatchBytes ?? {})) {
    check(`HD feature patch "${name}"`, bytes, DELIVERY_BUDGET.hdFeaturePatchBytes);
  }
  check("all 3D assets of the pack", measured.pack3dTotalBytes, DELIVERY_BUDGET.pack3dTotalBytes);
  return violations;
}
