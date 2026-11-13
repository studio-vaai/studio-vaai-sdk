import { defineConfig } from "vite";

import { sbomInventory } from "../build-tools/sbom/vite/plugin";

/**
 * Library build for `@studio-vaai/web-components` (`pnpm build`), the same pipeline as the other
 * SDK packages: Vite bundles relative imports into Node-ESM-portable JS, `tsgo
 * --emitDeclarationOnly` writes the `.d.ts` files.
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
        define: "src/define.ts",
        "experience/index": "src/experience/index.ts",
      },
      formats: ["es"],
    },
    rolldownOptions: {
      // Externalize every bare specifier (`lit`); only relative imports get bundled.
      external: (id) => !/^[./]/.test(id),
      output: {
        format: "es",
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
      },
    },
  },
});
