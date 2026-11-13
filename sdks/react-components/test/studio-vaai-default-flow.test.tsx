// @vitest-environment jsdom

import type { inspectImageHeader } from "@studio-vaai/js-client";

import { StudioVaaiProvider } from "@studio-vaai/react-headless";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { StudioVaaiDefaultFlowHandle } from "../src/studio-vaai-default-flow.js";

import { StudioVaaiDefaultFlow } from "../src/studio-vaai-default-flow.js";
import { createMockClient, testProduct } from "./helpers.js";

// Flow wiring uses a known safe header result; preview admission and cleanup
// are covered separately by use-photo-preview-url.test.tsx.
vi.mock(import("@studio-vaai/js-client"), async (importOriginal) => ({
  ...(await importOriginal()),
  inspectImageHeader: vi.fn<typeof inspectImageHeader>(async () => ({ width: 1, height: 1 })),
}));

// jsdom ships no ResizeObserver; the preview-frame hooks only need it to exist.
globalThis.ResizeObserver ??= function ResizeObserverStub() {
  return {
    observe(): void {
      /* jsdom stub — layout never fires */
    },
    unobserve(): void {
      /* jsdom stub */
    },
    disconnect(): void {
      /* jsdom stub */
    },
  };
} as unknown as typeof ResizeObserver;

/** Manually-released gate for holding a mock API call in flight. */
function deferredGate(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- test gate; nothing library-provided to await
  const promise = new Promise<void>((_resolve) => {
    resolve = _resolve;
  });
  return { promise, resolve };
}

describe("StudioVaaiDefaultFlow", () => {
  it("renders session intro inside provider", () => {
    const client = createMockClient();
    const ref = createRef<StudioVaaiDefaultFlowHandle>();
    render(
      <StrictMode>
        <StudioVaaiProvider
          client={client}
          input={{
            product: testProduct,
          }}
        >
          <StudioVaaiDefaultFlow ref={ref} />
        </StudioVaaiProvider>
      </StrictMode>,
    );
    act(() => {
      ref.current?.open();
    });
    expect(screen.getByRole("heading", { level: 2, name: /Ready to try it on\?/i })).toBeTruthy();
  });

  it("merges message overrides onto the default bundle", () => {
    const client = createMockClient();
    const ref = createRef<StudioVaaiDefaultFlowHandle>();
    render(
      <StrictMode>
        <StudioVaaiProvider
          client={client}
          input={{
            product: testProduct,
          }}
        >
          <StudioVaaiDefaultFlow
            ref={ref}
            messages={{
              sessionIntro: { sheetTitle: "Custom sheet" },
            }}
          />
        </StudioVaaiProvider>
      </StrictMode>,
    );
    act(() => {
      ref.current?.open();
    });
    expect(screen.getByRole("heading", { level: 2, name: /Custom sheet/i })).toBeTruthy();
  });

  it("applies theme tokens to the portaled sheet root", () => {
    const client = createMockClient();
    const ref = createRef<StudioVaaiDefaultFlowHandle>();
    render(
      <StrictMode>
        <StudioVaaiProvider client={client} input={{ product: testProduct }}>
          <StudioVaaiDefaultFlow ref={ref} theme={{ "--sv-color-primary": "rgb(1, 2, 3)" }} />
        </StudioVaaiProvider>
      </StrictMode>,
    );
    act(() => {
      ref.current?.open();
    });
    // The sheet renders in a portal outside the provider tree; the token must
    // still reach its re-anchored `#studio-vaai-root` (the portal-gap fix).
    const roots = Array.from(document.querySelectorAll<HTMLElement>("#studio-vaai-root"));
    expect(
      roots.some((el) => el.style.getPropertyValue("--sv-color-primary") === "rgb(1, 2, 3)"),
    ).toBe(true);
  });

  it("applies shell classNames to the sheet chrome without swapping components", () => {
    const client = createMockClient();
    const ref = createRef<StudioVaaiDefaultFlowHandle>();
    render(
      <StrictMode>
        <StudioVaaiProvider client={client} input={{ product: testProduct }}>
          <StudioVaaiDefaultFlow ref={ref} classNames={{ shell: { title: "sv-test-title" } }} />
        </StudioVaaiProvider>
      </StrictMode>,
    );
    act(() => {
      ref.current?.open();
    });
    const heading = screen.getByRole("heading", { level: 2, name: /Ready to try it on\?/i });
    expect(heading.classList.contains("sv-test-title")).toBe(true);
  });

  it("calls onOpenChange with the open boolean only", () => {
    const client = createMockClient();
    const ref = createRef<StudioVaaiDefaultFlowHandle>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <StrictMode>
        <StudioVaaiProvider
          client={client}
          input={{
            product: testProduct,
          }}
        >
          <StudioVaaiDefaultFlow ref={ref} onOpenChange={onOpenChange} />
        </StudioVaaiProvider>
      </StrictMode>,
    );
    act(() => {
      ref.current?.open();
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);

    act(() => {
      ref.current?.close();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it("keeps the shopper's source photo on the busy try-on hero", async () => {
    // jsdom has no object URLs; the busy hero's src comes straight from this stub, so the
    // assertion below proves the flow threads the captured photo all the way to the hero.
    let urlCount = 0;
    // Captured only to restore in the finally below — never invoked detached, so `this` is
    // never lost.
    // oxlint-disable-next-line typescript-eslint/unbound-method
    const originalCreate = URL.createObjectURL;
    // oxlint-disable-next-line typescript-eslint/unbound-method
    const originalRevoke = URL.revokeObjectURL;
    // oxlint-disable-next-line vitest/prefer-spy-on -- jsdom ships no URL.createObjectURL to spy on
    URL.createObjectURL = vi.fn<() => string>(() => {
      urlCount += 1;
      return `blob:mock-${String(urlCount)}`;
    });
    // oxlint-disable-next-line vitest/prefer-spy-on -- jsdom ships no URL.revokeObjectURL to spy on
    URL.revokeObjectURL = vi.fn<(url: string) => void>();
    try {
      // Hold the try-on in `requesting` so the busy hero is observable.
      const tryOnGate = deferredGate();
      const client = createMockClient();
      const baseCreateTryOn = client.tryOn.createTryOn.bind(client.tryOn);
      client.tryOn.createTryOn = async (...args) => {
        await tryOnGate.promise;
        return await baseCreateTryOn(...args);
      };

      const ref = createRef<StudioVaaiDefaultFlowHandle>();
      render(
        <StrictMode>
          <StudioVaaiProvider
            client={client}
            input={{
              product: testProduct,
              // Explicit host pick → the one-shot auto-start fires the try-on right after
              // height confirmation, exactly the demo's ?size= path.
              selection: { size: "m", colorway: "espresso" },
              autoStartOnPreselectedVariant: true,
            }}
          >
            <StudioVaaiDefaultFlow ref={ref} />
          </StudioVaaiProvider>
        </StrictMode>,
      );
      act(() => {
        ref.current?.open();
      });

      // Intro: consent, then the upload CTA (opens the hidden file input), then the pick.
      // The checkbox appears once the session-restore probe settles into `awaitingImage`.
      fireEvent.click(await screen.findByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Upload a photo" }));
      const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(fileInput).not.toBeNull();
      const file = new File([new Uint8Array([1, 2, 3])], "me.jpg", { type: "image/jpeg" });
      await act(async () => {
        fireEvent.change(fileInput!, { target: { files: [file] } });
      });

      // Height screen (create-body resolved) → confirm → auto-started try-on.
      const confirm = await screen.findByRole("button", { name: "Continue to try-on" });
      fireEvent.click(confirm);

      await vi.waitFor(() => {
        expect(document.querySelector('[data-studio-vaai="try-on-view"]')).not.toBeNull();
      });
      // The busy shimmer must ride ON the source photo — a blank slide behind the rainbow
      // means the shopper's image got lost between upload and the try-on hero.
      const heroImg = document.querySelector<HTMLImageElement>(
        '[data-studio-vaai="try-on-view"] img',
      );
      expect(heroImg?.getAttribute("src") ?? "").toMatch(/^blob:mock-/);
      tryOnGate.resolve();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("keeps the source photo on the busy hero when the try-on starts from the size screen", async () => {
    // The fitUI-off path: a default-only size spends the auto-start, the shopper picks on
    // the size-selection screen and starts the try-on manually. The hero must still carry
    // the uploaded photo behind the busy shimmer.
    let urlCount = 0;
    // Captured only to restore in the finally below — never invoked detached, so `this` is
    // never lost.
    // oxlint-disable-next-line typescript-eslint/unbound-method
    const originalCreate = URL.createObjectURL;
    // oxlint-disable-next-line typescript-eslint/unbound-method
    const originalRevoke = URL.revokeObjectURL;
    // oxlint-disable-next-line vitest/prefer-spy-on -- jsdom ships no URL.createObjectURL to spy on
    URL.createObjectURL = vi.fn<() => string>(() => {
      urlCount += 1;
      return `blob:mock-${String(urlCount)}`;
    });
    // oxlint-disable-next-line vitest/prefer-spy-on -- jsdom ships no URL.revokeObjectURL to spy on
    URL.revokeObjectURL = vi.fn<(url: string) => void>();
    try {
      const tryOnGate = deferredGate();
      const client = createMockClient();
      const baseCreateTryOn = client.tryOn.createTryOn.bind(client.tryOn);
      client.tryOn.createTryOn = async (...args) => {
        await tryOnGate.promise;
        return await baseCreateTryOn(...args);
      };

      const ref = createRef<StudioVaaiDefaultFlowHandle>();
      render(
        <StrictMode>
          <StudioVaaiProvider
            client={client}
            input={{
              product: testProduct,
              selection: { size: "m", colorway: "espresso" },
              selectedSizeIsDefault: true,
              autoStartOnPreselectedVariant: true,
            }}
          >
            <StudioVaaiDefaultFlow ref={ref} />
          </StudioVaaiProvider>
        </StrictMode>,
      );
      act(() => {
        ref.current?.open();
      });

      fireEvent.click(await screen.findByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Upload a photo" }));
      const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
      const file = new File([new Uint8Array([1, 2, 3])], "me.jpg", { type: "image/jpeg" });
      await act(async () => {
        fireEvent.change(fileInput!, { target: { files: [file] } });
      });
      fireEvent.click(await screen.findByRole("button", { name: "Continue to try-on" }));

      // Default-only size → no auto-start: the size-selection screen renders, with the
      // uploaded photo as its hero.
      // The size step's CTA names the variant, in the try-on screen's wording.
      const overviewCta = await screen.findByRole("button", { name: "Try on M in Espresso" });
      // (`data-studio-vaai="product-overview-hero"` rides ON the img element itself.)
      const overviewImgs = Array.from(document.querySelectorAll("img"), (n) =>
        n.getAttribute("src"),
      );
      expect(overviewImgs.some((src) => src?.startsWith("blob:mock-") === true)).toBe(true);

      fireEvent.click(overviewCta);
      await vi.waitFor(() => {
        expect(document.querySelector('[data-studio-vaai="try-on-view"]')).not.toBeNull();
      });
      const heroImg = document.querySelector<HTMLImageElement>(
        '[data-studio-vaai="try-on-view"] img',
      );
      expect(heroImg?.getAttribute("src") ?? "").toMatch(/^blob:mock-/);
      tryOnGate.resolve();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
