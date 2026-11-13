import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const bindings = new URL("../dist/types/build/wasm2/", import.meta.url);
for (const name of readdirSync(bindings)) {
  if (!name.endsWith(".d.ts")) {
    continue;
  }
  const path = new URL(name, bindings);
  const source = readFileSync(path, "utf8");
  // The JS bundle already embeds this exact runtime. Keep its declarations in the same package.
  const updated = source
    .replaceAll(/["']@ubjs\/core["']/gu, '"../../uniffi-runtime/index.js"')
    .replaceAll(/(from ["']\.\/[\w-]+)(["'])/gu, "$1.js$2");
  if (updated !== source) {
    writeFileSync(path, updated);
  }
}
