import { defineConfig } from "vite";

// oxlint-disable-next-line import/no-relative-parent-imports -- Shared SDK build tooling.
import { sbomInventory } from "../build-tools/sbom/vite/plugin";
import manifest from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    STUDIO_VAAI_REACT_VERSION: JSON.stringify(`${manifest.name}@${manifest.version}`),
  },
  plugins: [sbomInventory()],
  build: {
    lib: { entry: { index: "src/index.ts" }, formats: ["es"] },
    target: "es2022",
    minify: false,
    rolldownOptions: { external: (id) => !/^[./]/u.test(id) },
  },
});
