import type { PluginOption } from "vite";

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import sbom from "rollup-plugin-sbom";

/** Generate with the upstream plugin and route inventories outside release bundles. */
export function sbomInventory(
  rootComponentType: "application" | "library" = "library",
): PluginOption[] {
  const destination = process.env["STUDIO_VAAI_SBOM_DIR"];
  if (typeof destination !== "string") {
    return [];
  }
  const fileName = ".sbom/bom.json";
  return [
    sbom({
      specVersion: "1.6",
      rootComponentType,
      outDir: ".sbom",
      outFilename: "bom",
      outFormats: ["json"],
      includeWellKnown: false,
      saveTimestamp: false,
      generateSerial: false,
      sortLists: true,
    }),
    {
      name: "studio-vaai-sbom-output",
      generateBundle: {
        order: "post",
        handler(_options, bundle): void {
          const asset = bundle[fileName];
          if (asset?.type !== "asset") {
            throw new Error("rollup-plugin-sbom did not emit an inventory");
          }
          const identity = createHash("sha256").update(asset.source).digest("hex").slice(0, 12);
          mkdirSync(destination, { recursive: true });
          writeFileSync(
            join(destination, `${basename(process.cwd())}-${identity}.cdx.json`),
            asset.source,
          );
          delete bundle[".sbom/bom.json"];
        },
      },
    },
  ];
}
