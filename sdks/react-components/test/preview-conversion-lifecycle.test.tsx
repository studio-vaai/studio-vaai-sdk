// @vitest-environment jsdom
import { convertHeicToJpeg, inspectImageHeader } from "@studio-vaai/js-client";
import { StudioVaaiProvider, useStudioVaaiActor } from "@studio-vaai/react-headless";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudioVaaiDefaultFlowHandle } from "../src/studio-vaai-default-flow.js";

import { StudioVaaiDefaultFlow } from "../src/studio-vaai-default-flow.js";
import { createMockClient, testProduct } from "./helpers.js";

vi.mock(import("@studio-vaai/js-client"), async (importOriginal) => ({
  ...(await importOriginal()),
  convertHeicToJpeg: vi.fn<typeof convertHeicToJpeg>(),
  inspectImageHeader: vi.fn<typeof inspectImageHeader>(),
}));

type FlowActor = ReturnType<typeof useStudioVaaiActor>["actor"];
function ActorProbe({ receive }: { receive: (actor: FlowActor) => void }) {
  const { actor } = useStudioVaaiActor();
  useEffect(() => {
    receive(actor);
  }, [actor, receive]);
  return null;
}

async function heldPreview() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {
        void this;
      }
      unobserve(): void {
        void this;
      }
      disconnect(): void {
        void this;
      }
    },
  );
  vi.mocked(inspectImageHeader).mockResolvedValue(globalThis.undefined);
  let finish!: (blob: Blob | undefined) => void;
  // oxlint-disable-next-line promise/avoid-new -- Hold optional conversion beyond its owner lifetime.
  const conversion = new Promise<Blob | undefined>((resolve) => {
    finish = resolve;
  });
  vi.mocked(convertHeicToJpeg).mockReturnValue(conversion);
  const ref = createRef<StudioVaaiDefaultFlowHandle>();
  let actor!: FlowActor;
  const view = render(
    <StudioVaaiProvider client={createMockClient()} input={{ product: testProduct }}>
      <ActorProbe
        receive={(value) => {
          actor = value;
        }}
      />
      <StudioVaaiDefaultFlow ref={ref} />
    </StudioVaaiProvider>,
  );
  act(() => {
    ref.current?.open();
  });
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Upload a photo" }));
  const file = new File(["not a locally decodable header"], "photo.heic", { type: "image/heic" });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await screen.findByRole("button", { name: "Continue to try-on" });
  const signal = vi.mocked(convertHeicToJpeg).mock.calls[0]?.[2];
  if (!signal) {
    throw new Error("Preview conversion requires cancellation ownership");
  }
  return { ref, actor, signal, finish, unmount: view.unmount };
}

describe("optional preview conversion lifecycle", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });
  for (const boundary of ["close", "expiry", "unmount", "actor stop"] as const) {
    it(`cancels on ${boundary} and ignores a late decoded preview`, async () => {
      const { ref, actor, signal, finish, unmount } = await heldPreview();
      expect(signal.aborted).toBe(false);
      act(() => {
        if (boundary === "close") {
          ref.current?.close();
        } else if (boundary === "expiry") {
          actor.send({ type: "SESSION_EXPIRED" });
        } else if (boundary === "actor stop") {
          actor.stop();
        } else {
          unmount();
        }
      });
      expect(signal.aborted).toBe(true);
      await act(async () => {
        finish(new Blob(["late conversion"]));
        await Promise.resolve();
      });
      expect(actor.getSnapshot().context.lastCapturedImage?.previewBlob).toBeUndefined();
      expect(document.querySelector('img[src^="blob:"]')).toBeNull();
    });
  }
});
