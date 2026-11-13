// Post-build cleanup for `pnpm build`.
//
// Components (and src/index.ts) carry side-effect `import "./*.css"` statements
// so Vite pulls the stylesheets into the build graph. Vite strips those from
// the emitted JS, but `tsgo` copies them verbatim into the `.d.ts` files — a
// declaration file must not reference a stylesheet, or a consumer without a
// `*.css` ambient module declaration fails to typecheck. Strip them here.
import { globSync, readFileSync, writeFileSync } from "node:fs";

const cssImport = /^import\s+["'][^"']+\.css["'];?\r?\n/gm;

for (const file of globSync("dist/**/*.d.ts")) {
  const original = readFileSync(file, "utf8");
  const cleaned = original.replace(cssImport, "");
  if (cleaned !== original) {
    writeFileSync(file, cleaned);
  }
}
