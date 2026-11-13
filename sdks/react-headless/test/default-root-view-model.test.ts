import type { VariantAttributes } from "@studio-vaai/js-machine";
import type { AnyActorRef } from "xstate";

import { defaultRootMachine } from "@studio-vaai/js-machine";
import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { buildDefaultRootViewModel } from "../src/default-root-view-model.js";
import { createMockClient, firstChildActor, testProduct } from "./helpers.js";

/** Pre-selected variant so the variant region lands in `selected` without further input. */
const initialSelection: VariantAttributes = { size: "m", colorway: "black" };

async function runGlobalPrefix(actor: AnyActorRef) {
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
  });
  const s1 = firstChildActor(actor);
  expect(s1).toBeDefined();
  s1!.send({ type: "CONSENT_GRANTED" });
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
  const s2 = firstChildActor(actor);
  expect(s2).toBeDefined();
  const s3 = firstChildActor(actor);
  expect(s3).toBeDefined();
  s3!.send({ type: "SET_HEIGHT", heightCm: 175 });
  s3!.send({ type: "CONFIRM" });
  await vi.waitFor(() => {
    expect(
      actor.getSnapshot().matches({
        postCapture: {
          screen: {
            product: {
              active: {
                variant: "selected",
                recommendation: "visible",
                tryOnPipeline: "idle",
              },
            },
          },
        },
      }),
    ).toBe(true);
  });
}

describe("buildDefaultRootViewModel", () => {
  it("maps initial snapshot to sessionIntro", () => {
    const actor = createActor(defaultRootMachine, {
      input: {
        client: createMockClient(),
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
    const vm = buildDefaultRootViewModel(actor.getSnapshot());
    expect(vm.phase).toBe("sessionIntro");
    expect(vm.productPhase).toBeNull();
    expect(vm.variant).toBeNull();
    expect(vm.recommendation).toBeNull();
    expect(vm.tryOnPipeline).toBeNull();
    expect(vm.canStartTryOn).toBe(false);
  });

  it("maps product parallel regions and canStartTryOn", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
    await runGlobalPrefix(actor);
    // Post-calibration the root re-requests the size recommendation (default-root raises
    // RECOMMENDATION_REQUEST so a result fetched against the pre-calibration body can't go
    // stale), so the recommendation region fetches on the product screen. Wait for that fetch
    // to settle before snapshotting the resting region states.
    await vi.waitFor(() => {
      expect(buildDefaultRootViewModel(actor.getSnapshot()).recommendation).toBe("visible");
    });
    const vm = buildDefaultRootViewModel(actor.getSnapshot());
    expect(vm.phase).toBe("product");
    expect(vm.productPhase).toBe("active");
    expect(vm.variant).toBe("selected");
    expect(vm.recommendation).toBe("visible");
    expect(vm.tryOnPipeline).toBe("idle");
    expect(vm.canStartTryOn).toBe(true);

    actor.send({
      type: "SELECT_VARIANT",
      selection: { size: "l", colorway: "navy" },
    });
    const vm2 = buildDefaultRootViewModel(actor.getSnapshot());
    expect(vm2.variant).toBe("selected");
    expect(vm2.canStartTryOn).toBe(true);
  });
});
