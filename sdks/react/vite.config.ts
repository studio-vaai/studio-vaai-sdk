import { defineConfig } from "vite";

// oxlint-disable-next-line import/no-relative-parent-imports -- Shared SDK build tooling.
import { sbomInventory } from "../build-tools/sbom/vite/plugin";

export default defineConfig({
  plugins: [sbomInventory()],
  build: {
    lib: { entry: { index: "src/index.ts" }, formats: ["es"] },
    target: "es2022",
    minify: false,
    rolldownOptions: { external: (id) => !/^[./]/u.test(id) },
  },
});
