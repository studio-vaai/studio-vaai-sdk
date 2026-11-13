import { defineConfig } from "vite";

import { sbomInventory } from "../build-tools/sbom/vite/plugin";

/**
 * Library build for `@studio-vaai/react-headless` (`pnpm build`).
 *
 * Built with Vite rather than bare `tsgo` so every SDK package shares one
 * bundler-resolved build pipeline — the bundler resolves relative specifiers
 * into extension-correct, Node-ESM-portable published JS.
 *
 * `.d.ts` output stays with `tsgo --emitDeclarationOnly` (see `build` script).
 */
export default defineConfig({
  plugins: [sbomInventory()],
  build: {
    outDir: "dist",
    target: "es2022",
    minify: false,
    lib: {
      // One entry per `package.json#exports` subpath.
      entry: {
        index: "src/index.ts",
      },
      formats: ["es"],
    },
    rolldownOptions: {
      // Externalize every bare specifier; only relative imports get bundled.
      external: (id) => !/^[./]/.test(id),
      output: {
        format: "es",
        // Mirror the src/ tree 1:1 — matches the dist shape the exports map
        // already points at.
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
      },
    },
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
});
