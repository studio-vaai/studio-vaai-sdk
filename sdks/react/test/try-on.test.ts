// @vitest-environment jsdom
import { initializeCore, ItemDisplay } from "@studio-vaai/core";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { act, createElement, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { StudioVaaiTryOnHandle, StudioVaaiTryOnProps } from "../src/try-on.js";

import { StudioVaaiTryOn } from "../src/try-on.js";

describe("StudioVaaiTryOn", () => {
  it("reports that try-on cannot open before it is initialized", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const opened = Promise.withResolvers<boolean>();

    function Host() {
      const ref = useRef<StudioVaaiTryOnHandle>(null);
      useLayoutEffect(() => {
        opened.resolve(ref.current!.open());
      }, []);
      return createElement(StudioVaaiTryOn, {
        ref,
        api: { baseUrl: "https://api.example.test", clientApiKey: "fixture" },
        productId: "fixture",
        productName: "Shirt",
        fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("Fixture API is offline")),
        presentProduct: () => ({ axes: [], chosenAxes: [], labelFormats: [], variantId: "" }),
      });
    }

    try {
      await act(async () => {
        root.render(createElement(Host));
      });
      await expect(opened.promise).resolves.toBe(false);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it(
    "hides unavailable products and becomes ready on the next storefront product",
    { timeout: 15_000 },
    async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      await initializeCore(
        new Uint8Array(
          await readFile(resolve(import.meta.dirname, "../../core-rs/dist/studio_vaai_core.wasm")),
        ),
      );
      const productId = crypto.randomUUID();
      const variantId = crypto.randomUUID();
      const onReadyChange = vi.fn<(ready: boolean) => void>();
      const onError = vi.fn<(error: unknown) => void>();
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const { pathname } = new URL(new Request(input, init).url);
        switch (pathname) {
          case "/products/by-foreign-id/missing": {
            return new Response(null, { status: 404 });
          }
          case "/session": {
            return Response.json({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
          }
          case "/bodies": {
            return Response.json({ bodies: [] });
          }
          case "/products/by-foreign-id/shirt": {
            return Response.json({
              productId,
              variants: [{ id: variantId, foreignVariantIds: { size: "M" } }],
            });
          }
          default: {
            return new Response(null, { status: 401 });
          }
        }
      });
      const api = { baseUrl: "https://api.example.test", clientApiKey: "fixture" };
      const presentProduct = vi.fn<StudioVaaiTryOnProps["presentProduct"]>(() => ({
        axes: [
          { key: "size", items: [{ key: "M", display: new ItemDisplay.Text({ text: "M" }) }] },
        ],
        chosenAxes: [],
        labelFormats: [],
        variantId,
      }));
      const render = (foreignId: string) => {
        root.render(
          createElement(StudioVaaiTryOn, {
            api,
            foreignId,
            productName: "Shirt",
            fetch,
            presentProduct,
            onReadyChange,
            onError,
          }),
        );
      };
      try {
        await act(async () => {
          render("missing");
        });
        await vi.waitFor(
          async () => {
            await act(async () => {
              // Flush controller setup and any reported error.
            });
            expect(onError).not.toHaveBeenCalled();
            expect(fetch).toHaveBeenCalledWith(
              new URL("/products/by-foreign-id/missing", api.baseUrl).href,
              expect.objectContaining({ method: "GET" }),
            );
          },
          { timeout: 5_000 },
        );
        expect(onReadyChange).toHaveBeenLastCalledWith(false);

        await act(async () => {
          render("shirt");
        });
        await vi.waitFor(
          async () => {
            await act(async () => {
              // Flush the controller's readiness update.
            });
            expect(onError).not.toHaveBeenCalled();
            expect(onReadyChange).toHaveBeenLastCalledWith(true);
          },
          { timeout: 5_000 },
        );
        expect(presentProduct).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ productId }),
        );
      } finally {
        await act(async () => {
          root.unmount();
        });
        container.remove();
        vi.unstubAllGlobals();
      }
    },
  );
});
