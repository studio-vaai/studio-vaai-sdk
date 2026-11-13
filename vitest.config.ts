import { defineConfig } from "vitest/config";

// Shared by every package's `test` script (`vitest run --config ../../vitest.config.ts`).
// A test that needs a DOM opts in with `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    passWithNoTests: true,
    include: ["**/*.test.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/core-rs/build/**"],
  },
});
