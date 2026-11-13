/* oxlint-disable typescript/ban-ts-comment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return, typescript/no-unsafe-assignment, typescript/strict-boolean-expressions -- see note below */
// Vite's `UserConfig` type plus the postcss plugin shapes blow TS's "excessive
// stack depth" budget here, and there is no runtime code consuming this file's
// types. `@ts-nocheck` is the pragmatic out for a dev-only build config.
// @ts-nocheck
import tailwindcss from "@tailwindcss/postcss";
import prefixSelector from "postcss-prefix-selector";
import preserveDirectives from "rollup-preserve-directives";
import { defineConfig } from "vite";

import { sbomInventory } from "../build-tools/sbom/vite/plugin";

/**
 * Library build for `@studio-vaai/react-components` (`pnpm build`).
 *
 * The sibling SDK packages stay external: a dev config that aliases them to their
 * TS sources (for hot reload) must not be reused here, or the publish build would
 * *inline* them.
 *
 * Why a bundler at all (vs. bare `tsgo`): `src/ui/guide-graphic.tsx` imports a
 * PNG with Vite's `?url` suffix. `tsgo` is a transpiler — it would emit
 * `import "...png?url"` verbatim into the published JS, which only resolves in
 * a Vite consumer and hard-crashes under SSR (the reason a downstream app
 * needed `ssr.noExternal`). Vite resolves the asset at build time instead.
 *
 * CSS: this build also owns the stylesheet (there is no separate Tailwind-CLI
 * `build:css` step anymore). `src/index.ts` imports `studio-vaai-components.css`, and
 * components may co-locate their own `import "./*.css"`; `cssCodeSplit: false`
 * merges every imported sheet into the single `dist/studio-vaai-components.css`
 * the exports map ships. The postcss chain is Tailwind v4 → `#studio-vaai-root`
 * prefixing; dev configs must mirror it. Vite lib mode strips CSS imports from the emitted JS,
 * so consumers still load the stylesheet explicitly — the contract is unchanged.
 *
 * `.d.ts` output stays with `tsgo --emitDeclarationOnly` (see `build` script).
 */
/**
 * Tailwind v4 emits a set of global `@property --tw-*` registrations plus `--tw-*`
 * custom properties. `@property` cannot be selector-scoped, so on a host page
 * that also uses Tailwind these would override the host's own registrations.
 * Rename the entire closed set into the SDK's `--sv-tw-*` namespace — every
 * `@property`, every declaration and every `var()` is renamed together, so it
 * is behaviour-preserving and collision-proof in both directions.
 */
const renameTw = (s) => s.replaceAll("--tw-", "--sv-tw-");
const namespaceTailwindInternals = () => ({
  postcssPlugin: "sv-namespace-tailwind-internals",
  Once(root) {
    root.walkDecls((decl) => {
      if (decl.prop.includes("--tw-")) {
        decl.prop = renameTw(decl.prop);
      }
      if (decl.value.includes("--tw-")) {
        decl.value = renameTw(decl.value);
      }
    });
    root.walkAtRules("property", (atRule) => {
      if (atRule.params.includes("--tw-")) {
        atRule.params = renameTw(atRule.params);
      }
    });
  },
});
namespaceTailwindInternals.postcss = true;

export default defineConfig({
  plugins: [sbomInventory()],
  build: {
    outDir: "dist",
    target: "es2022",
    // Ship readable, tree-shakeable JS; consumers minify. CSS still ships
    // minified, matching the former `tailwindcss --minify`.
    minify: false,
    cssMinify: true,
    // Merge every imported stylesheet into one file instead of per-chunk CSS.
    cssCodeSplit: false,
    // Library mode: makes Vite emit asset URLs as `new URL(..., import.meta.url)`
    // (resolves relative to the consumed module) instead of root-absolute
    // `/assets/...` paths, and sets `preserveEntrySignatures: "strict"`.
    lib: {
      // One entry per `package.json#exports` subpath.
      entry: {
        index: "src/index.ts",
        primitives: "src/primitives.ts",
        "ui/index": "src/ui/index.ts",
        debug: "src/debug.tsx",
      },
      formats: ["es"],
      // The single merged stylesheet -> dist/studio-vaai-components.css.
      cssFileName: "studio-vaai-components",
    },
    rolldownOptions: {
      // Externalize every bare specifier — deps, peerDeps, react/jsx-runtime.
      // Only relative imports (incl. the `?url` asset) get processed.
      external: (id) => !/^[./]/.test(id),
      plugins: [
        // Rollup strips top-level "use client" directives when bundling;
        // re-attach them so RSC consumers keep the client boundary.
        preserveDirectives(),
      ],
      output: {
        format: "es",
        // Mirror the `src/` tree 1:1: keeps each "use client" module isolated
        // and matches the `dist` shape the exports map already points at.
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        // The merged stylesheet must land at the unhashed dist/ path the
        // exports map ships (dist/studio-vaai-components.css); other assets
        // (the guide-graphic PNG) stay hashed under dist/assets/.
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? "";
          return name.endsWith(".css") ? "[name][extname]" : "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  css: {
    // Inline so Vite ignores any file-based postcss config. Tailwind v4 first
    // (expands `@import "tailwindcss/*"`, `@source`, `@theme`, `@apply`), then
    // prefix-selector wraps every selector in `#studio-vaai-root` so SDK styles
    // carry id-specificity and survive host-page resets. `:root` stays global;
    // `@keyframes` stop selectors must not be prefixed (invalid CSS).
    postcss: {
      plugins: [
        tailwindcss(),
        namespaceTailwindInternals(),
        prefixSelector({
          prefix: "#studio-vaai-root",
          exclude: [":root"],
          transform(prefix, selector, prefixedSelector, _filepath, rule) {
            if (rule.parent?.type === "atrule" && rule.parent.name === "keyframes") {
              return selector;
            }
            return prefixedSelector;
          },
        }),
      ],
    },
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
});
