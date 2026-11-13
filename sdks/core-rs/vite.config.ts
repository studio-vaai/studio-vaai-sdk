import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { sbomInventory } from "../build-tools/sbom/vite/plugin";

// The runtimes come from the same pinned ubrn source as the binding generator.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@ubjs\/core$/,
        replacement: fileURLToPath(
          new URL("build/ubrn/src/typescript/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@ubjs\/wasm\/core$/,
        replacement: fileURLToPath(
          new URL("build/ubrn/src/runtimes/wasm/core/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@ubjs\/wasm$/,
        replacement: fileURLToPath(
          new URL("build/ubrn/src/runtimes/wasm/browser/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  plugins: [
    sbomInventory(),
    {
      name: "core-wasm-asset",
      closeBundle() {
        mkdirSync("dist", { recursive: true });
        copyFileSync("build/wasm2/studio_vaai_core.wasm", "dist/studio_vaai_core.wasm");
        copyFileSync("src/wasm-url.js", "dist/wasm-url.js");
      },
    },
  ],
  build: {
    target: "es2022",
    lib: {
      entry: { index: "src/index.ts", api: "src/api.ts", analytics: "src/analytics/index.ts" },
      formats: ["es"],
    },
    rolldownOptions: { external: ["./wasm-url.js"] },
    minify: false,
  },
});
