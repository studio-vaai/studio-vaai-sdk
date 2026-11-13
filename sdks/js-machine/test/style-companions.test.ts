import type { StudioVaaiClient } from "@studio-vaai/js-client";

import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import type { TryOnFlowProduct } from "../src/context/index.js";

import { companionStyleSelections } from "../src/context/index.js";
import { defaultRootMachine } from "../src/default-root.js";
import { createMemorySessionPersistence } from "../src/session-persistence.js";
import { createMockClient, firstChildActor, testProduct } from "./helpers.js";

/** The test product sold in two styles: every (size, color) exists for both templates. */
const styledProduct: TryOnFlowProduct = {
  ...testProduct,
  variants: testProduct.variants.flatMap((v) => [
    { id: `${v.id}-buttoned-up`, attributes: { ...v.attributes, template: "buttoned-up" } },
    { id: `${v.id}-buttoned-down`, attributes: { ...v.attributes, template: "buttoned-down" } },
  ]),
  attributeMetadata: {
    ...testProduct.attributeMetadata,
    styles: [
      { slug: "buttoned-up", label: "Buttoned up", glyph: "buttoned-up" },
      { slug: "buttoned-down", label: "Buttoned down", glyph: "buttoned-down" },
    ],
  },
};

function pipelineState(actor: ReturnType<typeof createActor<typeof defaultRootMachine>>) {
  const v = actor.getSnapshot().value as {
    postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
  };
  return v.postCapture?.screen?.product?.active?.tryOnPipeline;
}

function makeCreateTryOn() {
  let n = 0;
  return vi.fn<StudioVaaiClient["tryOn"]["createTryOn"]>(async (args) => {
    n += 1;
    return {
      ok: true as const,
      data: {
        status: "success" as const,
        tryOnId: `tryon-${args.variantId}-${n}`,
        imageUrl: `https://x/${args.variantId}.png`,
        scene: { overlayColor: "#000" },
      },
    };
  });
}

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
    expect(pipelineState(actor)).toBe("resulting");
  });
}

describe("companionStyleSelections", () => {
  it("names every other style of the picked size and colour", () => {
    expect(
      companionStyleSelections(styledProduct, {
        size: "m",
        colorway: "black",
        template: "buttoned-up",
      }),
    ).toEqual([{ size: "m", colorway: "black", template: "buttoned-down" }]);
  });

  it("is empty for single-style products and for selections without a style", () => {
    expect(companionStyleSelections(testProduct, { size: "m", colorway: "black" })).toEqual([]);
    expect(companionStyleSelections(styledProduct, { size: "m", colorway: "black" })).toEqual([]);
  });
});

describe("styled product try-on", () => {
  it("renders the other style alongside the picked one and flips to it without a request", async () => {
    const createTryOn = makeCreateTryOn();
    const base = createMockClient();
    const client = createMockClient({ tryOn: { ...base.tryOn, createTryOn } });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: styledProduct,
        selection: { size: "m", colorway: "black", template: "buttoned-up" },
        sessionPersistence: createMemorySessionPersistence(),
      },
    });
    actor.start();
    await walkToTryOnResult(actor);

    // Both styles were requested by the one click (companions go out on entry, so their
    // order relative to the primary is not part of the contract).
    await vi.waitFor(() => {
      expect(createTryOn).toHaveBeenCalledTimes(2);
    });
    expect(createTryOn.mock.calls.map((c) => c[0].variantId).toSorted()).toEqual([
      "v-m-black-buttoned-down",
      "v-m-black-buttoned-up",
    ]);
    // Both landed in history; the cursor stays on the style the shopper asked for.
    await vi.waitFor(() => {
      expect(
        actor.getSnapshot().context.tryOnHistoryByProduct[styledProduct.id]?.entries,
      ).toHaveLength(2);
    });
    const history = actor.getSnapshot().context.tryOnHistoryByProduct[styledProduct.id];
    expect(history.cursor).toBe(0);
    expect(history.entries.map((e) => e.attributes.template)).toEqual([
      "buttoned-up",
      "buttoned-down",
    ]);

    // Flipping the style in the result view replays the companion render: no new request,
    // still on the result screen, cursor moved onto the other style.
    actor.send({
      type: "SELECT_VARIANT",
      selection: { size: "m", colorway: "black", template: "buttoned-down" },
    });
    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().context.tryOnHistoryByProduct[styledProduct.id]?.cursor).toBe(1);
    });
    expect(pipelineState(actor)).toBe("resulting");
    expect(createTryOn).toHaveBeenCalledTimes(2);
    expect(actor.getSnapshot().context.pendingTryOn?.result).toMatchObject({
      status: "success",
      imageUrl: "https://x/v-m-black-buttoned-down.png",
    });
  });

  it("does not request companions for a single-style product", async () => {
    const createTryOn = makeCreateTryOn();
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
    await walkToTryOnResult(actor);
    expect(createTryOn).toHaveBeenCalledOnce();
  });
});
