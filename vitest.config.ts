import { defineConfig } from "vitest/config";

/**
 * Root test projects. See docs/engineering/testing-workflow.md.
 *   features -> tests/features (acceptance specs, written first)
 *   e2e      -> tests/e2e      (real running system; run separately)
 * Unit tests live in each workspace and run with `npm run test:unit`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "features",
          include: ["tests/features/**/*.feature.test.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.e2e.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
