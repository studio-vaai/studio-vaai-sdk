import type { TrackingClient, TrackingEvent } from "@studio-vaai/js-tracking";
import type { AnyActorRef } from "xstate";

import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { defaultRootMachine } from "../src/default-root.js";
import { createMemorySessionPersistence } from "../src/session-persistence.js";
import { createTrackingSubscriber, stepFromSnapshot } from "../src/tracking.js";
import { createMockClient, firstChildActor, testProduct } from "./helpers.js";

function makeRecordingTracking(): { tracking: TrackingClient; events: TrackingEvent[] } {
  const events: TrackingEvent[] = [];
  const tracking: TrackingClient = {
    trackEvent: (event) => {
      events.push(event);
      return { ok: true };
    },
  };
  return { tracking, events };
}

function startActor() {
  const client = createMockClient();
  return createActor(defaultRootMachine, {
    input: {
      client,
      product: testProduct,
      selection: { size: "m", colorway: "black" },
      sessionPersistence: createMemorySessionPersistence(),
    },
  });
}

async function walkToTryOnResult(actor: AnyActorRef) {
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
  });
  firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
  });
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
      true,
    );
  });
  const heightChild: AnyActorRef = firstChildActor(actor)!;
  heightChild.send({ type: "SET_HEIGHT", heightCm: 175 });
  heightChild.send({ type: "CONFIRM" });
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches({ postCapture: { screen: "product" } })).toBe(true);
  });
  actor.send({ type: "START_TRY_ON" });
  await vi.waitFor(() => {
    const v = actor.getSnapshot().value as {
      postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
    };
    expect(v.postCapture?.screen?.product?.active?.tryOnPipeline).toBe("resulting");
  });
}

describe("stepFromSnapshot", () => {
  it("maps every machine state path to its Step", () => {
    expect(stepFromSnapshot("sessionIntro")).toBe("intro");
    expect(stepFromSnapshot({ sessionIntro: "creatingSession" })).toBe("intro");
    expect(stepFromSnapshot("photoCapture")).toBe("image-record");
    expect(stepFromSnapshot("photoUpload")).toBe("image-upload");
    expect(
      stepFromSnapshot({ postCapture: { screen: "heightCalibration", work: "running" } }),
    ).toBe("height");
    expect(
      stepFromSnapshot({
        postCapture: { screen: { product: { active: { tryOnPipeline: "running" } } } },
      }),
    ).toBe("try-on");
    expect(
      stepFromSnapshot({
        postCapture: {
          screen: {
            product: {
              active: {
                variant: "selected",
                recommendation: "hidden",
                tryOnPipeline: "idle",
              },
            },
          },
          work: "done",
        },
      }),
    ).toBe("variant-selection");
    expect(
      stepFromSnapshot({
        postCapture: {
          screen: {
            product: {
              active: {
                variant: "selected",
                recommendation: "hidden",
                tryOnPipeline: "resulting",
              },
            },
          },
          work: "done",
        },
      }),
    ).toBe("try-on");
    expect(stepFromSnapshot({ postCapture: { screen: { product: "active" }, work: "done" } })).toBe(
      "variant-selection",
    );
  });

  it("maps photoUpload child rejected to image-rejection", async () => {
    const base = createMockClient();
    const rejectingClient = createMockClient({
      body: {
        ...base.body,
        createBody: async () => ({
          ok: true,
          data: {
            status: "failed",
            failure: {
              kind: "validation",
              code: "human_occluded",
              message: "bad photo",
            },
          },
        }),
      },
    });
    const rejectingActor = createActor(defaultRootMachine, {
      input: {
        client: rejectingClient,
        product: testProduct,
        selection: { size: "m", colorway: "black" },
        sessionPersistence: createMemorySessionPersistence(),
      },
    });
    rejectingActor.start();
    await vi.waitFor(() => {
      expect(rejectingActor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(rejectingActor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(rejectingActor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    rejectingActor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    await vi.waitFor(() => {
      expect(firstChildActor(rejectingActor)?.getSnapshot().value).toBe("rejected");
    });
    expect(stepFromSnapshot(rejectingActor.getSnapshot())).toBe("image-rejection");
  });

  it("falls back to entry for unknown paths", () => {
    expect(stepFromSnapshot("madeUpState")).toBe("entry");
    expect(stepFromSnapshot(null)).toBe("entry");
  });
});

describe("createTrackingSubscriber — machine-driven events", () => {
  it("emits the full happy-path sequence with sources derived from the snapshot delta", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);

    actor.start();

    // 1. intro-opened when the host opens the sheet on the intro screen (not on
    //    actor mount — the machine bootstraps in the background before the user
    //    clicks the entrypoint).
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    expect(events.find((e) => e.name === "intro-opened")).toBeUndefined();

    subscriber.trackHostEvent({
      type: "intro-opened",
      "product-id": testProduct.id,
      source: "entry",
    });
    expect(events.find((e) => e.name === "intro-opened")!.data).toEqual({
      "product-id": testProduct.id,
      source: "entry",
    });

    // 2. consent-granted when the `sessionIntro` child completes.
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "consent-granted")).toBeDefined();
    });
    expect(events.find((e) => e.name === "consent-granted")!.data).toEqual({
      "product-id": testProduct.id,
    });

    // 3. image-upload-initiated when the user taps "Foto hochladen" (picker opens).
    actor.send({ type: "INITIATE_IMAGE_UPLOAD", source: "intro" });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "image-upload-initiated")).toBeDefined();
    });
    expect(events.find((e) => e.name === "image-upload-initiated")!.data).toEqual({
      "product-id": testProduct.id,
      source: "intro",
    });

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    // 4. image-uploaded once `photoUpload` `onDone` resolves (mock `createBody` → ready).
    //    image-source maps from machine's `photoSource: "gallery"` → "select".
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "image-uploaded")).toBeDefined();
    });
    expect(events.find((e) => e.name === "image-uploaded")!.data).toEqual({
      "product-id": testProduct.id,
      "image-source": "select",
    });

    // 5. height-entered on entry to `postCapture.screen.heightCalibration`.
    //    Source is "image-upload" — the step we were just in.
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "height-entered")).toBeDefined();
    });
    expect(events.find((e) => e.name === "height-entered")!.data).toEqual({
      "product-id": testProduct.id,
      source: "image-upload",
    });

    // 6. variant-selection-initiated on entry to `postCapture.screen.product`
    //    (after `CALIBRATION_SUBMITTED` advances the screen). Source is "height".
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
        true,
      );
    });
    const heightChild: AnyActorRef = firstChildActor(actor)!;
    heightChild.send({ type: "SET_HEIGHT", heightCm: 175 });
    heightChild.send({ type: "CONFIRM" });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "variant-selection-initiated")).toBeDefined();
    });
    expect(events.find((e) => e.name === "variant-selection-initiated")!.data).toEqual({
      "product-id": testProduct.id,
      source: "height",
    });

    subscriber.unsubscribe();
  });

  it("emits image-record-initiated on OPEN_CAMERA", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();

    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });

    actor.send({ type: "OPEN_CAMERA", source: "intro" });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "image-record-initiated")).toBeDefined();
    });
    expect(events.find((e) => e.name === "image-record-initiated")!.data).toEqual({
      "product-id": testProduct.id,
      source: "intro",
    });

    subscriber.unsubscribe();
  });

  it("emits image-upload-aborted on CANCEL_UPLOAD and routes back to awaitingImage", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();

    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });

    // Start an upload and abort it before it completes.
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    // Cancel right away — the upload mock would resolve asynchronously, but
    // `CANCEL_UPLOAD` short-circuits via the root-level handler.
    actor.send({ type: "CANCEL_UPLOAD" });

    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "image-upload-aborted")).toBeDefined();
    });
    expect(events.find((e) => e.name === "image-upload-aborted")!.data).toEqual({
      "product-id": testProduct.id,
      source: "intro",
    });
    expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);

    subscriber.unsubscribe();
  });

  it("emits image-upload-aborted when the intro file picker is cancelled after initiate", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();

    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });

    actor.send({ type: "INITIATE_IMAGE_UPLOAD", source: "intro" });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "image-upload-initiated")).toBeDefined();
    });

    actor.send({ type: "CANCEL_UPLOAD" });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "image-upload-aborted")).toBeDefined();
    });
    expect(events.find((e) => e.name === "image-upload-aborted")!.data).toEqual({
      "product-id": testProduct.id,
      source: "intro",
    });
    expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);

    subscriber.unsubscribe();
  });

  it("emits try-on-initiated with variants flattened to variant-* keys", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();

    // Walk to product (variant selection) screen.
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
        true,
      );
    });
    const heightChild: AnyActorRef = firstChildActor(actor)!;
    heightChild.send({ type: "SET_HEIGHT", heightCm: 175 });
    heightChild.send({ type: "CONFIRM" });
    await vi.waitFor(() => {
      expect(
        actor
          .getSnapshot()
          .matches({ postCapture: { screen: { product: { active: { variant: "selected" } } } } }),
      ).toBe(true);
    });

    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "try-on-initiated")).toBeDefined();
    });
    expect(events.find((e) => e.name === "try-on-initiated")!.data).toEqual({
      "product-id": testProduct.id,
      "variant-size": "m",
      "variant-colorway": "black",
    });

    subscriber.unsubscribe();
  });

  it.each(["back", "go-to-product-overview"] as const)(
    "emits variant-selection-initiated with source try-on and via %s when returning from try-on result",
    async (via) => {
      const actor = startActor();
      const { tracking, events } = makeRecordingTracking();
      const subscriber = createTrackingSubscriber(actor, tracking);
      actor.start();
      await walkToTryOnResult(actor);
      const initialCount = events.filter((e) => e.name === "variant-selection-initiated").length;
      expect(initialCount).toBe(1);

      actor.send({ type: "RETURN_TO_VARIANT_SELECTION", via });
      await vi.waitFor(() => {
        const v = actor.getSnapshot().value as {
          postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
        };
        expect(v.postCapture?.screen?.product?.active?.tryOnPipeline).toBe("idle");
      });

      const returnEvents = events.filter((e) => e.name === "variant-selection-initiated");
      expect(returnEvents).toHaveLength(initialCount + 1);
      expect(returnEvents.at(-1)!.data).toEqual({
        "product-id": testProduct.id,
        source: "try-on",
        via,
      });
      subscriber.unsubscribe();
    },
  );

  it("emits height-entered with source variant-selection on BACK_TO_HEIGHT from product", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();
    await walkToTryOnResult(actor);
    actor.send({ type: "RETURN_TO_VARIANT_SELECTION", via: "back" });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value as {
        postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
      };
      expect(v.postCapture?.screen?.product?.active?.tryOnPipeline).toBe("idle");
    });

    actor.send({ type: "BACK_TO_HEIGHT" });
    await vi.waitFor(() => {
      const heightEvents = events.filter((e) => e.name === "height-entered");
      expect(heightEvents.length).toBeGreaterThan(1);
      expect(heightEvents.at(-1)!.data).toEqual({
        "product-id": testProduct.id,
        source: "variant-selection",
      });
    });

    subscriber.unsubscribe();
  });

  it("emits intro-opened with source image-rejection when returning from a rejected upload", async () => {
    const base = createMockClient();
    const rejectingClient = createMockClient({
      body: {
        ...base.body,
        createBody: async () => ({
          ok: true,
          data: {
            status: "failed",
            failure: {
              kind: "validation",
              code: "human_occluded",
              message: "bad photo",
            },
          },
        }),
      },
    });
    const actor = createActor(defaultRootMachine, {
      input: {
        client: rejectingClient,
        product: testProduct,
        selection: { size: "m", colorway: "black" },
        sessionPersistence: createMemorySessionPersistence(),
      },
    });
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    actor.send({ type: "INITIATE_IMAGE_UPLOAD", source: "intro" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    await vi.waitFor(() => {
      expect(firstChildActor(actor)?.getSnapshot().value).toBe("rejected");
    });
    expect(stepFromSnapshot(actor.getSnapshot())).toBe("image-rejection");

    actor.send({ type: "RETURN_TO_SESSION_INTRO_FOR_GUIDE" });
    await vi.waitFor(() => {
      const introEvents = events.filter((e) => e.name === "intro-opened");
      expect(introEvents.length).toBe(1);
      expect(introEvents.at(-1)!.data).toEqual({
        "product-id": testProduct.id,
        source: "image-rejection",
      });
    });

    subscriber.unsubscribe();
  });

  it("emits image-upload-initiated with source variant-selection when opening the picker from product", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();
    await walkToTryOnResult(actor);
    actor.send({ type: "RETURN_TO_VARIANT_SELECTION", via: "back" });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value as {
        postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
      };
      expect(v.postCapture?.screen?.product?.active?.tryOnPipeline).toBe("idle");
    });

    actor.send({ type: "INITIATE_IMAGE_UPLOAD", source: "variant-selection" });
    await vi.waitFor(() => {
      const initiated = events.filter((e) => e.name === "image-upload-initiated");
      expect(initiated.at(-1)).toBeDefined();
    });
    expect(events.findLast((e) => e.name === "image-upload-initiated")!.data).toEqual({
      "product-id": testProduct.id,
      source: "variant-selection",
    });
    expect(actor.getSnapshot().matches({ postCapture: { screen: "product" } })).toBe(true);

    subscriber.unsubscribe();
  });

  it("emits image-upload-aborted with source variant-selection when the product picker is cancelled", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();
    await walkToTryOnResult(actor);
    actor.send({ type: "RETURN_TO_VARIANT_SELECTION", via: "back" });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value as {
        postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
      };
      expect(v.postCapture?.screen?.product?.active?.tryOnPipeline).toBe("idle");
    });

    actor.send({ type: "INITIATE_IMAGE_UPLOAD", source: "variant-selection" });
    actor.send({ type: "CANCEL_UPLOAD", source: "variant-selection" });
    await vi.waitFor(() => {
      const aborted = events.filter((e) => e.name === "image-upload-aborted");
      expect(aborted.at(-1)).toBeDefined();
    });
    expect(events.findLast((e) => e.name === "image-upload-aborted")!.data).toEqual({
      "product-id": testProduct.id,
      source: "variant-selection",
    });
    expect(actor.getSnapshot().matches({ postCapture: { screen: "product" } })).toBe(true);

    subscriber.unsubscribe();
  });

  it("emits image-record-aborted with source intro on CANCEL_CAMERA", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();

    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });

    actor.send({ type: "OPEN_CAMERA", source: "intro" });
    actor.send({ type: "CANCEL_CAMERA" });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "image-record-aborted")).toBeDefined();
    });
    expect(events.find((e) => e.name === "image-record-aborted")!.data).toEqual({
      "product-id": testProduct.id,
      source: "intro",
    });
    expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);

    subscriber.unsubscribe();
  });
});

describe("createTrackingSubscriber — host events via trackHostEvent", () => {
  it("forwards entrypoint-impression unchanged (no current-step needed)", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();

    subscriber.trackHostEvent({
      type: "entrypoint-impression",
      "product-id": testProduct.id,
      entry: "pdp-button",
    });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "entrypoint-impression")).toBeDefined();
    });
    expect(events.find((e) => e.name === "entrypoint-impression")!.data).toEqual({
      "product-id": testProduct.id,
      entry: "pdp-button",
    });

    subscriber.unsubscribe();
  });

  it("forwards host intro-opened with explicit source entry", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();

    subscriber.trackHostEvent({
      type: "intro-opened",
      "product-id": testProduct.id,
      source: "entry",
    });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "intro-opened")).toBeDefined();
    });
    expect(events.find((e) => e.name === "intro-opened")!.data).toEqual({
      "product-id": testProduct.id,
      source: "entry",
    });

    subscriber.unsubscribe();
  });

  it("does not emit intro-opened on actor start before the entrypoint opens the sheet", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();

    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    expect(events.find((e) => e.name === "intro-opened")).toBeUndefined();

    subscriber.unsubscribe();
  });

  it("enriches entrypoint-clicked with current-step from the snapshot delta", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();

    // Wait until the actor is settled in `sessionIntro` so the subscriber has
    // observed at least one snapshot ("intro").
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });

    subscriber.trackHostEvent({
      type: "entrypoint-clicked",
      "product-id": testProduct.id,
      entry: "pdp-button",
    });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "entrypoint-clicked")).toBeDefined();
    });
    expect(events.find((e) => e.name === "entrypoint-clicked")!.data).toEqual({
      "product-id": testProduct.id,
      entry: "pdp-button",
      "current-step": "intro",
    });

    subscriber.unsubscribe();
  });

  it("enriches view-closed with the current step at dispatch time", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();

    // Get the actor into image-upload so view-closed's current-step is distinct.
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches("photoUpload")).toBe(true);
    });

    subscriber.trackHostEvent({ type: "view-closed", "product-id": testProduct.id });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "view-closed")).toBeDefined();
    });
    expect(events.find((e) => e.name === "view-closed")!.data).toEqual({
      "product-id": testProduct.id,
      "current-step": "image-upload",
    });

    subscriber.unsubscribe();
  });
});

describe("createTrackingSubscriber — unsubscribe", () => {
  it("detaches all listeners — no further machine emits forwarded", async () => {
    const actor = startActor();
    const { tracking, events } = makeRecordingTracking();
    const subscriber = createTrackingSubscriber(actor, tracking);
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(events.find((e) => e.name === "consent-granted")).toBeDefined();
    });

    subscriber.unsubscribe();
    const countAtUnsubscribe = events.length;

    actor.send({ type: "INITIATE_IMAGE_UPLOAD", source: "intro" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });

    expect(events.length).toBe(countAtUnsubscribe);
  });
});
