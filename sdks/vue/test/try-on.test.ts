import type {
  MessageOverrides,
  TryOn,
  TryOnExperienceEvent,
  TryOnExperienceEventMap,
} from "@studio-vaai/core";
import type {
  createApiTryOnExperience,
  createBrowserTryOnDevices,
  SvTryOnExperience,
  TryOnExperience,
} from "@studio-vaai/web-components/experience";

// @vitest-environment jsdom
import { ProductInstallationStatus } from "@studio-vaai/core";
import { createUiContext } from "@studio-vaai/web-components";
import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from "vue";

import type { StudioVaaiTryOnHandle, StudioVaaiTryOnProps } from "../src/index.js";

import { StudioVaaiTryOn, useTryOns } from "../src/index.js";

const sdk = vi.hoisted(() => ({
  create: vi.fn<typeof createApiTryOnExperience>(),
  define: vi.fn<() => void>(),
}));

vi.mock(import("@studio-vaai/web-components/experience"), () => ({
  createApiTryOnExperience: sdk.create,
  defineSvTryOnExperience: sdk.define,
  createBrowserTryOnDevices: () => ({}) as ReturnType<typeof createBrowserTryOnDevices>,
}));

vi.mock(import("@studio-vaai/web-components"), async (importOriginal) => {
  const sdk = await importOriginal();
  return { ...sdk, createUiContext: vi.fn<typeof createUiContext>(sdk.createUiContext) };
});

describe("StudioVaaiTryOn", () => {
  it("keeps the session across product and price changes and gates open on readiness", async () => {
    const view = {
      domain: { product: { id: "shirt" }, tryOns: [] as TryOn[] },
      productActive: true,
      productInstallation: { token: "", status: ProductInstallationStatus.Pending },
    };
    const owner = {
      view,
      open: vi.fn<(entry?: { entry?: string }) => boolean>(() => true),
      close: vi.fn<() => void>(),
      setProductActive: vi.fn<TryOnExperience["setProductActive"]>(),
      setSelection: vi.fn<TryOnExperience["setSelection"]>(),
      dispose: vi.fn<() => void>(),
      subscribe: vi.fn<(listener: () => void) => () => void>(),
      subscribeEvents: vi.fn<TryOnExperience["subscribeEvents"]>(),
      installProduct: vi.fn<TryOnExperience["installProduct"]>(),
      updateCommerce: vi.fn<TryOnExperience["updateCommerce"]>(),
      readyInstallation: vi.fn<TryOnExperience["readyInstallation"]>((id, request) =>
        view.productActive &&
        typeof id === "object" &&
        "foreignId" in id &&
        view.domain.product.id === id.foreignId &&
        view.productInstallation.token === request &&
        view.productInstallation.status === ProductInstallationStatus.Ready
          ? view.productInstallation.token
          : globalThis.undefined,
      ),
    };
    let eventListener: Parameters<TryOnExperience["subscribeEvents"]>[0] | undefined;
    owner.subscribeEvents.mockImplementation((listener) => {
      eventListener = listener;
      return () => {
        eventListener = globalThis.undefined;
      };
    });
    const onEvent = vi.fn<(event: TryOnExperienceEvent, experience: TryOnExperience) => void>();
    const onTryOnPresented =
      vi.fn<(detail: TryOnExperienceEventMap["sv-try-on-presented"]) => void>();
    let canFinishInstall = false;
    const listeners = new Set<() => void>();
    const onView = () => {
      for (const listener of listeners) {
        listener();
      }
    };
    owner.subscribe.mockImplementation((listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });
    owner.setProductActive.mockImplementation((active) => {
      view.productActive = active;
      onView();
    });
    owner.installProduct.mockImplementation(async (id, _present, _stock, _signal, token) => {
      if (typeof id !== "object" || !("foreignId" in id)) {
        throw new Error("Expected a storefront product ID.");
      }
      view.domain.product.id = id.foreignId;
      onView();
      view.productInstallation = { token: token ?? "", status: ProductInstallationStatus.Ready };
      onView();
      return true;
    });
    sdk.create.mockImplementation(async (options) => {
      await vi.waitFor(() => {
        expect(canFinishInstall).toBe(true);
      });
      view.productInstallation = {
        token: options.initialInstallation?.token ?? "",
        status: ProductInstallationStatus.Ready,
      };
      return owner as unknown as TryOnExperience;
    });
    sdk.define.mockImplementation(() => {
      if (customElements.get("sv-try-on-experience") === undefined) {
        customElements.define("sv-try-on-experience", class extends HTMLElement {});
      }
    });

    const ready = vi.fn<(value: boolean) => void>();
    const foreignId = ref("shirt");
    const price = ref("€89");
    const selection = ref({ size: "M" });
    const messages = shallowRef<MessageOverrides>();
    const inStock = ref(false);
    const config = shallowRef({ baseUrl: "https://api.example.test", clientApiKey: "key" });
    const active = ref(true);
    const tryOn = shallowRef<StudioVaaiTryOnHandle>();
    const presentProduct: StudioVaaiTryOnProps["presentProduct"] = () => ({
      axes: [],
      chosenAxes: [],
      labelFormats: [],
      variantId: "variant",
    });
    const Gallery = defineComponent({
      setup() {
        // oxlint-disable-next-line react-hooks/rules-of-hooks -- This is a Vue composable.
        const tryOns = useTryOns();
        return () => h("output", tryOns.value.map(({ imageUrl }) => imageUrl).join(","));
      },
    });
    const showGallery = ref(false);
    const app = createApp({
      render() {
        return h(
          StudioVaaiTryOn,
          {
            ref: tryOn,
            id: "fixture-dialog",
            api: config.value,
            foreignId: foreignId.value,
            productName: "Shirt",
            active: active.value,
            commerce: { variant: { inStock: inStock.value, price: price.value } },
            presentProduct,
            selection: selection.value,
            locale: "de-CH",
            messages: messages.value,
            onReadyChange: ready,
            onEvent,
            "onTry-on-presented": onTryOnPresented,
          },
          { default: () => (showGallery.value ? h(Gallery) : null) },
        );
      },
    });
    const root = document.createElement("div");
    document.body.append(root);
    app.mount(root);

    try {
      expect(tryOn.value?.open()).toBe(false);
      await vi.waitFor(() => {
        expect(sdk.create).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ product: { foreignId: "shirt" } }),
        );
      });
      price.value = "€79";
      config.value = { ...config.value };
      await nextTick();
      expect(sdk.create).toHaveBeenCalledOnce();
      expect(owner.installProduct).not.toHaveBeenCalled();
      expect(tryOn.value?.open()).toBe(false);
      canFinishInstall = true;
      await vi.waitFor(() => {
        expect(ready).toHaveBeenLastCalledWith(true);
      });
      expect(root.querySelector<SvTryOnExperience>("#fixture-dialog")?.experience).toBe(owner);
      expect(owner.setSelection).toHaveBeenLastCalledWith({ size: "M" });
      selection.value = { size: "L" };
      await nextTick();
      expect(owner.setSelection).toHaveBeenLastCalledWith({ size: "L" });
      const ui = vi.mocked(createUiContext).mock.results[0]?.value;
      messages.value = { "sessionIntro.primaryCtaPhoto": "Foto auswählen" };
      await nextTick();
      expect(ui?.snapshot.messages).toEqual(messages.value);
      messages.value = globalThis.undefined;
      await nextTick();
      expect(ui?.snapshot.messages).toEqual({});
      expect(sdk.create).toHaveBeenCalledOnce();
      expect(owner.installProduct).not.toHaveBeenCalled();
      const detail = {
        productId: "shirt",
        variantId: "M",
        tryOnId: "first",
        step: "try-on",
      } as const;
      void eventListener?.({ type: "sv-try-on-rendered", detail });
      void eventListener?.({ type: "sv-try-on-presented", detail });
      expect(onTryOnPresented).toHaveBeenCalledExactlyOnceWith(detail);
      expect(onEvent).toHaveBeenNthCalledWith(1, { type: "sv-try-on-rendered", detail }, owner);
      expect(onEvent).toHaveBeenNthCalledWith(2, { type: "sv-try-on-presented", detail }, owner);
      const result: TryOn = {
        id: "first",
        key: { bodyRevision: 1n, variantId: "variant" },
        height: 170,
        imageUrl: "/first.webp",
      };
      view.domain.tryOns = [result, { ...result, id: "second", imageUrl: "/second.webp" }];
      onView();
      showGallery.value = true;
      await nextTick();
      const output = () => root.querySelector("output")?.textContent;
      expect(output()).toBe("/first.webp,/second.webp");
      view.domain.tryOns = [{ ...result, imageUrl: "/renewed.webp" }];
      onView();
      await nextTick();
      expect(output()).toBe("/renewed.webp");
      expect(tryOn.value?.open({ entry: "product-page" })).toBe(true);
      expect(owner.open).toHaveBeenCalledWith({ entry: "product-page" });
      inStock.value = true;
      await nextTick();
      expect(owner.updateCommerce).toHaveBeenLastCalledWith(
        { variant: { inStock: true, price: price.value } },
        view.productInstallation.token,
      );
      expect(owner.installProduct).not.toHaveBeenCalled();

      foreignId.value = "jacket";
      await vi.waitFor(() => {
        expect(owner.installProduct).toHaveBeenCalledExactlyOnceWith(
          { foreignId: "jacket" },
          presentProduct,
          expect.any(Function),
          expect.any(AbortSignal),
          expect.any(String),
        );
      });
      expect(sdk.create).toHaveBeenCalledOnce();
      active.value = false;
      await nextTick();
      expect(owner.setProductActive).toHaveBeenLastCalledWith(false);
      expect(output()).toBe("/renewed.webp");
      view.domain.tryOns = [];
      onView();
      await nextTick();
      expect(output()).toBe("");
      showGallery.value = false;
      await nextTick();
      expect(listeners.size).toBe(1);
      expect(tryOn.value?.open()).toBe(false);
    } finally {
      app.unmount();
      root.remove();
    }
    expect(listeners.size).toBe(0);
    expect(eventListener).toBeUndefined();
    expect(owner.dispose).toHaveBeenCalledOnce();
  });
});
