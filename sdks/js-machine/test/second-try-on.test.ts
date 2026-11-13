import type { BodyId, StudioVaaiClient } from "@studio-vaai/js-client";

import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { defaultRootMachine } from "../src/default-root.js";
import { createMemorySessionPersistence } from "../src/session-persistence.js";
import { createMockClient, firstChildActor, testProduct } from "./helpers.js";

async function walkToTryOnResult(actor: ReturnType<typeof createActor<typeof defaultRootMachine>>) {
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
  const heightChild = firstChildActor(actor)!;
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

function pipelineState(actor: ReturnType<typeof createActor<typeof defaultRootMachine>>) {
  const v = actor.getSnapshot().value as {
    postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
  };
  return v.postCapture?.screen?.product?.active?.tryOnPipeline;
}

function makeCreateTryOn() {
  return vi.fn<StudioVaaiClient["tryOn"]["createTryOn"]>(async () => ({
    ok: true as const,
    data: {
      status: "success" as const,
      tryOnId: "tryon-1",
      imageUrl: "https://x/t.png",
      scene: { overlayColor: "#000" },
    },
  }));
}

function makeActor(createTryOn: StudioVaaiClient["tryOn"]["createTryOn"]) {
  const base = createMockClient();
  const client = createMockClient({ tryOn: { ...base.tryOn, createTryOn } });
  const actor = createActor(defaultRootMachine, {
    input: {
      client,
      product: testProduct,
      selection: { size: "m", colorway: "black" },
      sessionPersistence: createMemorySessionPersistence(),
    },
  });
  actor.start();
  return actor;
}

describe("second START_TRY_ON after success", () => {
  it("replays the cached result without a second createTryOn when the selection is unchanged", async () => {
    const createTryOn = makeCreateTryOn();
    const actor = makeActor(createTryOn);
    await walkToTryOnResult(actor);
    expect(createTryOn).toHaveBeenCalledOnce();

    actor.send({ type: "RETURN_TO_VARIANT_SELECTION", via: "go-to-product-overview" });
    await vi.waitFor(() => {
      expect(pipelineState(actor)).toBe("idle");
    });
    expect(actor.getSnapshot().context.calibrationInFlight).toBe(false);

    // Repeat click on the same variant: skip the round-trip, re-open the result screen.
    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      expect(pipelineState(actor)).toBe("resulting");
    });
    expect(createTryOn).toHaveBeenCalledOnce();
    // Carousel opens on the cached entry (single completed entry → index 0).
    const history = actor.getSnapshot().context.tryOnHistoryByProduct[testProduct.id];
    expect(history?.cursor).toBe(0);
    expect(history?.entries).toHaveLength(1);
  });

  it("reissues createTryOn when the selection changed since the last success", async () => {
    const createTryOn = makeCreateTryOn();
    const actor = makeActor(createTryOn);
    await walkToTryOnResult(actor);
    expect(createTryOn).toHaveBeenCalledOnce();

    actor.send({ type: "RETURN_TO_VARIANT_SELECTION", via: "go-to-product-overview" });
    await vi.waitFor(() => {
      expect(pipelineState(actor)).toBe("idle");
    });

    // A different variant has no cached entry — the request must go to the server.
    actor.send({ type: "SELECT_VARIANT", selection: { size: "m", colorway: "navy" } });
    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      expect(pipelineState(actor)).toBe("requesting");
    });
    expect(createTryOn).toHaveBeenCalledTimes(2);
  });

  it("reissues createTryOn after re-uploading a new image at the same confirmed height", async () => {
    // Regression: a new image mints a new `bodyId` but the confirmed height is
    // unchanged (a person's height doesn't move between two photos). The cached
    // result was rendered against the OLD image, so a repeat click must NOT
    // replay it. The body-revision append now keys on `bodyId` as well as height,
    // so the new upload advances the revision index and invalidates the cache.
    const createTryOn = makeCreateTryOn();
    let createBodyCalls = 0;
    const base = createMockClient();
    const client = createMockClient({
      tryOn: { ...base.tryOn, createTryOn },
      body: {
        ...base.body,
        // Each upload is a distinct body.
        createBody: async () => {
          createBodyCalls += 1;
          const bodyId = (createBodyCalls === 1 ? "body-img-1" : "body-img-2") as BodyId;
          return {
            ok: true as const,
            data: {
              status: "ready" as const,
              created: {
                body: { bodyId, createdAt: "", estimatedHeightCm: 170 },
                heightCm: 170,
              },
            },
          };
        },
        // Calibration mutates the body in place — echo the id it was given (matches
        // the server, which reloads the same `bodyId` after calibrate).
        setBodyHeight: async (args: { bodyId: BodyId; heightCm: number }) => ({
          ok: true as const,
          data: {
            body: {
              bodyId: args.bodyId,
              createdAt: "",
              estimatedHeightCm: 170,
              userProvidedHeightCm: args.heightCm,
            },
          },
        }),
      },
    });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: { size: "m", colorway: "black" },
        sessionPersistence: createMemorySessionPersistence(),
      },
    });
    actor.start();
    await walkToTryOnResult(actor);
    expect(createTryOn).toHaveBeenCalledOnce();

    actor.send({ type: "RETURN_TO_VARIANT_SELECTION", via: "go-to-product-overview" });
    await vi.waitFor(() => {
      expect(pipelineState(actor)).toBe("idle");
    });

    // Re-pick an image via the intro/guide path. Unlike `USE_ANOTHER_IMAGE` and
    // `OPEN_CAMERA`, this path keeps `tryOnHistoryByProduct` + `bodyRevisions`, so it
    // is the one where a stale cached result could be replayed.
    actor.send({ type: "RETURN_TO_SESSION_INTRO_FOR_GUIDE" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    const blob = new Blob([new Uint8Array([4, 5, 6])], { type: "image/jpeg" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
        true,
      );
    });
    // Confirm the SAME height as the first upload — only the image changed.
    const heightChild = firstChildActor(actor)!;
    heightChild.send({ type: "SET_HEIGHT", heightCm: 175 });
    heightChild.send({ type: "CONFIRM" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "product" } })).toBe(true);
    });
    // Wait for calibration to fully settle: the new body is a second revision
    // (same height, new `bodyId`). Until `CALIBRATION_DONE` lands, a `START_TRY_ON`
    // would queue in `awaitingCalibration` anyway; we want to prove the *settled*
    // state still bypasses the cache, so assert the revision advanced first.
    await vi.waitFor(() => {
      expect(actor.getSnapshot().context.bodyRevisions).toHaveLength(2);
    });

    // The new image is a new body revision, so the cached result for this exact
    // variant is invalidated — the try-on goes back to the server.
    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      expect(pipelineState(actor)).toBe("requesting");
    });
    expect(createTryOn).toHaveBeenCalledTimes(2);
  });
});
