import { initializeCore } from "@studio-vaai/core";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ui } from "../src/ui/index.js";

export async function initializeTestUi(): Promise<void> {
  await initializeCore(
    new Uint8Array(
      await readFile(resolve(import.meta.dirname, "../../core-rs/dist/studio_vaai_core.wasm")),
    ),
  );
  await ui.ready();
}
