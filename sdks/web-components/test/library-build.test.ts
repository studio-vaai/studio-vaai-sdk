import type { Rolldown } from "vite";

import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("library build", () => {
  it("loads the HEIC worker next to the module, not from the host page's root", async () => {
    const output = await build({
      root,
      configFile: `${root}/vite.lib.config.ts`,
      logLevel: "silent",
      build: { write: false },
    });
    const outputs = (Array.isArray(output) ? output : [output]) as Rolldown.RolldownOutput[];
    const chunks = outputs.flatMap(({ output: files }) => files);
    const worker = chunks.find(({ fileName }) => /^assets\/heic-worker-.*\.js$/u.test(fileName));
    const loader = chunks.find(({ fileName }) => fileName === "experience/browser/photo/heic.js");
    expect(worker).toBeDefined();
    // The loader sits three folders deep (experience/browser/photo/), so the
    // worker is three levels up.
    const up = "../".repeat(3);
    expect(loader?.type === "chunk" ? loader.code : "").toContain(
      `new URL("${up}${worker?.fileName}", import.meta.url)`,
    );
  }, 60_000);
});
