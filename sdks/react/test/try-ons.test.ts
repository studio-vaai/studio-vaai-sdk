// @vitest-environment jsdom
import type { MessageOverrides, TryOn, TryOnExperienceEvent } from "@studio-vaai/core";
import type {
  SvTryOnExperience,
  TryOnExperience,
  createApiTryOnExperience,
  createBrowserTryOnDevices,
} from "@studio-vaai/web-components/experience";

import { createUiContext } from "@studio-vaai/web-components";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { StudioVaaiTryOnProps } from "../src/index.js";

import { StudioVaaiTryOn, useTryOns } from "../src/index.js";

const createExperience = vi.hoisted(() => vi.fn<typeof createApiTryOnExperience>());
vi.mock(import("@studio-vaai/web-components/experience"), () => ({
  createApiTryOnExperience: createExperience,
  createBrowserTryOnDevices: () => ({}) as ReturnType<typeof createBrowserTryOnDevices>,
  defineSvTryOnExperience() {
    if (customElements.get("sv-try-on-experience") === undefined) {
      customElements.define("sv-try-on-experience", class extends HTMLElement {});
    }
  },
}));

vi.mock(import("@studio-vaai/web-components"), async (importOriginal) => {
  const sdk = await importOriginal();
  return { ...sdk, createUiContext: vi.fn<typeof createUiContext>(sdk.createUiContext) };
});

describe("useTryOns", () => {
  it("reads and follows results from the same controller as the dialog", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const listeners = new Set<() => void>();
    const eventListeners = new Set<(event: TryOnExperienceEvent) => void | Promise<void>>();
    const onEvent = vi.fn<NonNullable<StudioVaaiTryOnProps["onEvent"]>>();
    const onTryOnPresented = vi.fn<NonNullable<StudioVaaiTryOnProps["onTryOnPresented"]>>();
    const result: TryOn = {
      id: "first",
      key: { bodyRevision: 1n, variantId: "M" },
      height: 170,
      imageUrl: "/first.webp",
    };
    const view: { domain: { tryOns: TryOn[] } } = { domain: { tryOns: [] } };
    const owner = {
      view,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      subscribeEvents(listener: (event: TryOnExperienceEvent) => void | Promise<void>) {
        eventListeners.add(listener);
        return () => {
          eventListeners.delete(listener);
        };
      },
      setProductActive: () => globalThis.undefined,
      setSelection: vi.fn<TryOnExperience["setSelection"]>(),
      updateCommerce: () => globalThis.undefined,
      readyInstallation: (_id: string, token: string | undefined) => token,
      dispose: vi.fn<() => void>(),
    };
    createExperience.mockResolvedValue(owner as unknown as TryOnExperience);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const presentProduct = () => ({ axes: [], chosenAxes: [], labelFormats: [], variantId: "M" });

    function Gallery() {
      return createElement(
        "output",
        null,
        useTryOns()
          .map(({ imageUrl }) => imageUrl)
          .join(","),
      );
    }

    const render = (showGallery: boolean, size = "M", messages?: MessageOverrides) => {
      root.render(
        createElement(
          StudioVaaiTryOn,
          {
            api: { baseUrl: "https://api.example.test", clientApiKey: "fixture" },
            productId: "shirt",
            productName: "Shirt",
            presentProduct,
            selection: { size },
            locale: "de-CH",
            messages,
            onEvent,
            onTryOnPresented,
          },
          showGallery ? createElement(Gallery) : null,
        ),
      );
    };
    const publish = (tryOns: TryOn[]) => {
      view.domain.tryOns = tryOns;
      for (const listener of listeners) {
        listener();
      }
    };
    const output = () => container.querySelector("output")?.textContent;

    try {
      await act(async () => {
        render(true);
      });
      expect(output()).toBe("");
      await act(async () => {
        render(false);
        publish([result, { ...result, id: "second", imageUrl: "/second.webp" }]);
      });
      await vi.waitFor(async () => {
        await act(async () => {
          // Flush the browser controller setup.
        });
        expect(container.querySelector<SvTryOnExperience>("sv-try-on-experience")?.experience).toBe(
          owner,
        );
      });

      await act(async () => {
        render(true);
      });
      expect(output()).toBe("/first.webp,/second.webp");
      expect(createExperience).toHaveBeenCalledOnce();
      expect(owner.setSelection).toHaveBeenLastCalledWith({ size: "M" });
      const messages = { "sessionIntro.primaryCtaPhoto": "Foto auswählen" };
      await act(async () => {
        render(true, "L", messages);
      });
      expect(owner.setSelection).toHaveBeenLastCalledWith({ size: "L" });
      const ui = vi.mocked(createUiContext).mock.results[0]?.value;
      expect(ui?.snapshot.messages).toEqual(messages);
      await act(async () => {
        render(true, "L");
      });
      expect(ui?.snapshot.messages).toEqual({});
      expect(createExperience).toHaveBeenCalledOnce();

      const detail = {
        productId: "shirt",
        variantId: "M",
        tryOnId: "first",
        step: "try-on",
      } as const;
      for (const type of ["sv-try-on-rendered", "sv-try-on-presented"] as const) {
        for (const listener of eventListeners) {
          void listener({ type, detail });
        }
      }
      expect(onTryOnPresented).toHaveBeenCalledExactlyOnceWith(detail);
      expect(onEvent).toHaveBeenNthCalledWith(1, { type: "sv-try-on-rendered", detail }, owner);
      expect(onEvent).toHaveBeenNthCalledWith(2, { type: "sv-try-on-presented", detail }, owner);

      await act(async () => {
        publish([{ ...result, imageUrl: "/renewed.webp" }]);
      });
      expect(output()).toBe("/renewed.webp");

      await act(async () => {
        publish([]);
      });
      expect(output()).toBe("");

      await act(async () => {
        render(false);
      });
      expect(listeners.size).toBe(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      vi.unstubAllGlobals();
    }
    expect(listeners.size).toBe(0);
    expect(eventListeners.size).toBe(0);
    expect(owner.dispose).toHaveBeenCalledOnce();
  });
});
