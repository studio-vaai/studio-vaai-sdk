// @vitest-environment jsdom
import { StudioVaaiProvider } from "@studio-vaai/react-headless";
import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { StudioVaaiDefaultFlowHandle } from "../src/studio-vaai-default-flow.js";

import { StudioVaaiDefaultFlow } from "../src/studio-vaai-default-flow.js";
import { createMockClient, testProduct, testSession } from "./helpers.js";

// jsdom lacks ResizeObserver, which the preview frame observes.
class ResizeObserverMock {
  constructor(_callback: ResizeObserverCallback) {
    void _callback;
  }

  observe(_target: Element): void {
    void this;
    void _target;
  }

  unobserve(_target: Element): void {
    void this;
    void _target;
  }

  disconnect(): void {
    void this;
  }
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

// Drive the async XState transitions (createBody / calibrate promises + effects).
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- sequential macrotask flushes are intentional
    await act(async () => {
      // oxlint-disable-next-line promise/avoid-new -- macrotask tick for jsdom + XState
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

// Restoring a session skips the consent gate and lands directly in `awaitingImage`.
const persistence = {
  read: () => testSession,
  write: () => {
    void 0;
  },
  clear: () => {
    void 0;
  },
};

describe("height calibration error", () => {
  // Regression: the height picker auto-dispatched SET_HEIGHT on mount, which
  // transitioned the calibration child `failed -> editing` the instant the user
  // was yanked back after a calibrate failure — wiping the error before it
  // could render. The mount-time sync is now skipped.
  it("surfaces a calibration failure on the height screen", async () => {
    const client = createMockClient({
      body: {
        listBodies: async () => ({ ok: true, data: { bodies: [] } }),
        createBody: async () => ({
          ok: true,
          data: {
            status: "ready",
            created: {
              body: { bodyId: "b" as never, createdAt: "", estimatedHeightCm: 170 },
              heightCm: 170,
            },
          },
        }),
        setBodyHeight: async () => ({ ok: false, error: { kind: "server" } }),
      } as never,
    });
    const ref = createRef<StudioVaaiDefaultFlowHandle>();
    render(
      <StudioVaaiProvider
        client={client}
        input={{ product: testProduct, sessionPersistence: persistence }}
      >
        <StudioVaaiDefaultFlow ref={ref} />
      </StudioVaaiProvider>,
    );
    act(() => ref.current?.open());
    await flush();

    // Pick a photo (createBody succeeds → height-calibration screen).
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([1])], "p.jpg", { type: "image/jpeg" })],
      configurable: true,
    });
    fireEvent.change(input);
    await flush();

    // Confirm height → calibrate fails → yanked back to the height screen.
    const confirm = [...document.querySelectorAll("button")].find((b) =>
      /Continue to try-on/i.test(b.textContent ?? ""),
    );
    expect(confirm).toBeTruthy();
    fireEvent.click(confirm!);
    await flush();

    expect((document.body.textContent ?? "").includes("Something went wrong")).toBe(true);
  });
});
