import type { Plugin } from "vite";

import { defineConfig } from "vite";

import { sbomInventory } from "../build-tools/sbom/vite/plugin";

/**
 * Library build for `@studio-vaai/js-client` (`pnpm build`).
 *
 * Built with Vite rather than bare `tsgo` (a transpiler). The Hey API codegen
 * under `src/impl/generated/` emits *extensionless* relative imports
 * (`from "../core/bodySerializer.gen"`); `tsgo` passes those through verbatim,
 * so the published JS is unresolvable under Node ESM — `import("@studio-vaai/
 * js-client")` throws `ERR_MODULE_NOT_FOUND`. The bundler resolves each
 * specifier and writes extension-correct imports.
 *
 * `.d.ts` output stays with `tsgo --emitDeclarationOnly` (see `build` script).
 *
 * `exifreader` and `heic-to` are *bundled in* rather than externalized: the
 * published dist otherwise emits bare `import "exifreader"` / `import("heic-to")`
 * specifiers that must resolve in the consumer's `node_modules`, and a partial /
 * stale / pruned install (Docker, `--omit`, isolated pnpm store) leaves them
 * unresolvable — `exifreader` is eagerly re-exported from the entry, so a missing
 * copy crashes `import "@studio-vaai/js-client"` entirely. Both are leaf libs
 * (exifreader: zero-dep CJS; heic-to: a self-contained single-file WASM bundle),
 * so inlining them removes the runtime-dep footgun. heic-to stays code-split via
 * its dynamic import under `preserveModules`, so the eager path isn't bloated.
 *
 * Under `preserveModules` Rollup emits the bundled deps under a literal
 * `node_modules/` directory — but yalc and `npm publish` both STRIP any
 * `node_modules` dir from the packed package, deleting the bundled files and
 * re-breaking the (now-relative) import at runtime. `toVendorPath` rewrites that
 * segment to `vendor/`, which no packaging tool treats specially; Rollup rewrites
 * the importing specifiers to match the emitted filenames.
 */
const BUNDLED_DEPS = ["exifreader", "heic-to"];

const toVendorPath = (name: string) =>
  `${name.replaceAll(/(^|\/)node_modules\//g, "$1vendor/")}.js`;

/** Preserve the standard Worker URL expression so consuming bundlers copy its asset. */
function portableWorkerUrls(): Plugin {
  return {
    name: "studio-vaai-portable-worker-urls",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk" || !output.code.includes("assets/heic-worker-")) {
          continue;
        }
        const before = output.code;
        output.code = before.replaceAll(
          /new URL\(\s*\/\*\s*@vite-ignore\s*\*\/\s*""\s*\+\s*new URL\(("assets\/heic-worker-[^"]+"),\s*import\.meta\.url\)\.href,\s*""\s*\+\s*import\.meta\.url\s*\)/g,
          (_match, path: string) => `new URL(${path}, import.meta.url)`,
        );
        // Recent Vite releases already emit the portable URL expression.
        const portable =
          /new URL\(\s*(?:\/\*[^]*?\*\/\s*)?["'](?:\.\/)?assets\/heic-worker-[^"']+["'],\s*import\.meta\.url\s*\)/;
        if (output.code === before && !portable.test(output.code)) {
          const index = before.indexOf("assets/heic-worker-");
          throw new Error(
            `Unable to preserve the SDK worker asset URL in ${output.fileName}: ${before.slice(Math.max(0, index - 100), index + 150)}`,
          );
        }
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [portableWorkerUrls(), sbomInventory()],
  worker: { format: "es" },
  build: {
    outDir: "dist",
    target: "es2022",
    minify: false,
    lib: {
      // One entry per `package.json#exports` subpath.
      entry: {
        index: "src/index.ts",
        "generated/openapi": "src/generated/openapi.ts",
      },
      formats: ["es"],
    },
    rolldownOptions: {
      // Externalize every bare specifier except BUNDLED_DEPS (and their
      // subpaths); relative imports and the bundled leaf libs get inlined.
      external: (id) =>
        !/^[./]/.test(id) && !BUNDLED_DEPS.some((dep) => id === dep || id.startsWith(`${dep}/`)),
      output: {
        format: "es",
        // Mirror the src/ tree 1:1 — matches the dist shape the exports map
        // already points at.
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: (chunk) => toVendorPath(chunk.name),
        chunkFileNames: (chunk) => toVendorPath(chunk.name),
      },
    },
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
});
