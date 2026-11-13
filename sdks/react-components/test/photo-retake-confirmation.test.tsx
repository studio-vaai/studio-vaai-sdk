// @vitest-environment jsdom

import { StudioVaaiProvider, useStudioVaaiActor } from "@studio-vaai/react-headless";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudioVaaiDefaultFlowHandle } from "../src/studio-vaai-default-flow.js";

import { StudioVaaiDefaultFlow } from "../src/studio-vaai-default-flow.js";
import { firstChildActor } from "../src/utils/first-child-actor.js";
import { createMockClient, testProduct } from "./helpers.js";

// Drive capture through the real machine without requiring camera hardware in jsdom.
vi.mock(import("../src/batteries/photo-capture-mount.js"), () => ({
  PhotoCaptureMount: () => <div>Camera preview</div>,
}));

type FlowActor = ReturnType<typeof useStudioVaaiActor>["actor"];
type Step = "height" | "product" | "rejection" | "upload-failure";
const revokeObjectURL = vi.fn<(url: string) => void>();
const imageFlowSources = {
  height: "height",
  product: "variant-selection",
};

function ActorProbe({ onActor }: { onActor: (actor: FlowActor) => void }) {
  const { actor } = useStudioVaaiActor();
  useEffect(() => {
    onActor(actor);
  }, [actor, onActor]);
  return null;
}

async function setupFlow(step: Step, source: "camera" | "gallery" = "camera") {
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
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn<() => string>(() => "blob:recorded-photo");
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const client = createMockClient();
  if (step === "rejection") {
    vi.spyOn(client.body, "createBody").mockResolvedValue({
      ok: true,
      data: { status: "failed", failure: { kind: "validation", code: "human_occluded" } },
    });
  }
  if (step === "upload-failure") {
    vi.spyOn(client.body, "createBody").mockResolvedValue({ ok: false, error: { kind: "server" } });
  }
  const ref = createRef<StudioVaaiDefaultFlowHandle>();
  let actor!: FlowActor;
  render(
    <StudioVaaiProvider client={client} input={{ product: testProduct }}>
      <ActorProbe
        onActor={(value) => {
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
  if (source === "camera") {
    fireEvent.click(screen.getByRole("button", { name: "Capture with self-timer" }));
    await waitFor(() => {
      expect(actor.getSnapshot().matches("photoCapture")).toBe(true);
    });
    await act(async () => {
      const camera = firstChildActor(actor)!;
      camera.send({ type: "CAMERA_READY" });
      camera.send({ type: "AUTO_CAPTURE" });
      camera.send({
        type: "FRAME_CAPTURED",
        image: { type: "blob", blob: new Blob(["photo"], { type: "image/jpeg" }) },
      });
    });
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Upload a photo" }));
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["photo"], "photo.jpg", { type: "image/jpeg" })] },
    });
  }
  if (step !== "rejection" && step !== "upload-failure") {
    const confirm = await screen.findByRole("button", { name: "Continue to try-on" });
    if (step === "product") {
      fireEvent.click(confirm);
      await waitFor(() => {
        expect(actor.getSnapshot().matches({ postCapture: { screen: "product" } })).toBe(true);
      });
    }
  }
  await screen.findByRole("button", {
    name: step === "upload-failure" ? "Upload a photo" : "Use a different photo",
  });
  revokeObjectURL.mockClear();
  return { actor, ref };
}

describe("self-recorded photo replacement", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps recovery controls available after a camera upload fails", async () => {
    const { actor } = await setupFlow("upload-failure");
    expect(actor.getSnapshot().matches("photoUpload")).toBe(true);
    expect(screen.getByRole("button", { name: "Upload a photo" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(
      screen.getByRole("button", { name: "Capture with self-timer" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  for (const step of ["height", "product"] as const) {
    it(`keeps the photo and flow state when cancelling from ${step}`, async () => {
      const { actor } = await setupFlow(step);
      const before = actor.getSnapshot();
      fireEvent.click(screen.getByRole("button", { name: "Use a different photo" }));
      const dialog = await screen.findByRole("alertdialog", { name: "Record another photo?" });
      expect(
        within(dialog).getByText(
          "Do you really want to continue and record another photo? Your current photo will be deleted.",
        ),
      ).toBeTruthy();
      expect(actor.getSnapshot()).toBe(before);
      const cancel = within(dialog).getByRole("button", { name: "Cancel" });
      await waitFor(() => {
        expect(document.activeElement).toBe(cancel);
      });
      fireEvent.click(cancel);
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).toBeNull();
      });
      expect(actor.getSnapshot()).toBe(before);
      expect(screen.getByRole("button", { name: "Use a different photo" })).toBeTruthy();
      expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it(`opens the camera with the correct source after continuing from ${step}`, async () => {
      const { actor } = await setupFlow(step);
      fireEvent.click(screen.getByRole("button", { name: "Use a different photo" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
      await waitFor(() => {
        expect(actor.getSnapshot().matches("photoCapture")).toBe(true);
      });
      expect(actor.getSnapshot().context.imageFlowSource).toBe(imageFlowSources[step]);
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  }

  it("retakes a rejected camera photo directly without confirmation", async () => {
    const { actor } = await setupFlow("rejection");
    fireEvent.click(screen.getByRole("button", { name: "Use a different photo" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(actor.getSnapshot().matches("photoCapture")).toBe(true);
    expect(actor.getSnapshot().context.imageFlowSource).toBe("image-rejection");
  });

  it("treats Escape as cancellation", async () => {
    const { actor } = await setupFlow("height");
    const before = actor.getSnapshot();
    fireEvent.click(screen.getByRole("button", { name: "Use a different photo" }));
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(actor.getSnapshot()).toBe(before);
  });

  it("preserves completed try-ons when cancelling a retake", async () => {
    const { actor } = await setupFlow("product");
    await act(async () => {
      actor.send({ type: "SELECT_VARIANT", selection: { size: "m", colorway: "espresso" } });
      actor.send({ type: "START_TRY_ON" });
    });
    await waitFor(() => {
      expect(
        actor.getSnapshot().context.tryOnHistoryByProduct[String(testProduct.id)]?.entries[0]
          ?.status,
      ).toBe("completed");
    });
    act(() => {
      actor.send({ type: "RETURN_TO_VARIANT_SELECTION", via: "back" });
    });
    const before = actor.getSnapshot();
    expect(before.context.tryOnHistoryByProduct[String(testProduct.id)]?.entries).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Use a different photo" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    // Recommendation loading may finish in the background after returning from the result.
    const after = actor.getSnapshot();
    expect(after.context.tryOnHistoryByProduct).toBe(before.context.tryOnHistoryByProduct);
    expect(after.context.lastCapturedImage).toBe(before.context.lastCapturedImage);
    expect(after.context.bodyRevisions).toBe(before.context.bodyRevisions);
    expect(after.context.bodyHeightCm).toBe(before.context.bodyHeightCm);
  });

  it("drops a pending confirmation when the host closes and reopens the flow", async () => {
    const { actor, ref } = await setupFlow("height");
    const before = actor.getSnapshot();
    fireEvent.click(screen.getByRole("button", { name: "Use a different photo" }));
    await screen.findByRole("alertdialog");
    act(() => {
      ref.current?.close();
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    act(() => {
      ref.current?.open();
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(actor.getSnapshot()).toBe(before);
  });

  it("also confirms before returning to the camera with the height screen's back button", async () => {
    const { actor } = await setupFlow("height");
    const before = actor.getSnapshot();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("alertdialog");
    expect(actor.getSnapshot()).toBe(before);
  });

  it("opens the file picker directly for a gallery photo", async () => {
    const { actor } = await setupFlow("height", "gallery");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Use a different photo" }));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(actor.getSnapshot().context.photoSource).toBe("gallery");
  });
});
