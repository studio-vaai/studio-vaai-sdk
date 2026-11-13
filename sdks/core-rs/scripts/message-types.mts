// The Rust catalog remains the single source of message IDs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const catalog: unknown = JSON.parse(
  readFileSync(new URL("../formatting/messages/locales/en.json", import.meta.url), "utf8"),
);
if (typeof catalog !== "object" || catalog === null || Array.isArray(catalog)) {
  throw new Error("Expected the Rust message catalog to be an object");
}
const keys = Object.keys(catalog)
  .filter((key) => !key.startsWith("_"))
  .toSorted();
const target = new URL("../build/message-types.ts", import.meta.url);
const source = `// Generated from the Rust source catalog.\nexport type MessageId =\n${keys.map((key) => `  | ${JSON.stringify(key)}`).join("\n")};\n`;
mkdirSync(new URL("../build/", import.meta.url), { recursive: true });
let previous: string | undefined;
try {
  previous = readFileSync(target, "utf8");
} catch {
  /* First build. */
}
if (previous !== source) {
  writeFileSync(target, source);
}
