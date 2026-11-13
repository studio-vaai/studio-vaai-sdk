import type { AnyActorRef } from "xstate";

import { asBodyValidationCode } from "@studio-vaai/js-client";
import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import type { VariantAttributes } from "../src/context/index.js";
import type { testProductId } from "./helpers.js";

import { defaultRootMachine } from "../src/default-root.js";
import { createMemorySessionPersistence } from "../src/session-persistence.js";
import {
  attributesOfVariant,
  createMockClient,
  firstChildActor,
  testBody,
  testProduct,
  testSession,
} from "./helpers.js";

/** Pre-selected variant so the variant region lands in `selected` immediately on entry. */
const initialSelection: VariantAttributes = { size: "m", colorway: "black" };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * Test helper to gate async actor work: hand the `promise` to the mock and
 * call `resolve` / `reject` from the test to release it. Avoids `new Promise`
 * call sites the lint rule flags as ambient promise creation.
 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  // oxlint-disable-next-line eslint-plugin-promise/avoid-new, eslint-plugin-promise/param-names -- the only correct way to expose external resolve/reject handles for gating an async mock from a test.
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
                // The recommendation region auto-fetches for every selection mode since the
                // fit UI feeds on its data; the mock client resolves immediately -> `visible`.
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

/**
 * Like {@link runGlobalPrefix} but only asserts *arrival* at the product parallel state — for
 * recommendation-first flows (`selectedSizeIsDefault: true`), where the `recommendation` region
 * auto-fetches on entry (never `hidden`) and a deferred auto-start may already be moving the
 * `tryOnPipeline`.
 */
async function runGlobalPrefixToProduct(actor: AnyActorRef) {
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
  const s3 = firstChildActor(actor);
  expect(s3).toBeDefined();
  s3!.send({ type: "SET_HEIGHT", heightCm: 175 });
  s3!.send({ type: "CONFIRM" });
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches({ postCapture: { screen: { product: "active" } } })).toBe(
      true,
    );
  });
}

describe("defaultRootMachine", () => {
  it("reaches product parallel after global prefix", async () => {
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
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({
      postCapture: { screen: { product: { active: expect.any(Object) } } },
    });
  });

  it("handles PRODUCT_CHANGED on product region", async () => {
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
    const newProduct = { ...testProduct, id: "prod-changed" as typeof testProductId };
    actor.send({
      type: "PRODUCT_CHANGED",
      product: newProduct,
      selection: {},
    });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value as {
        postCapture?: { screen?: { product?: { active?: { variant?: unknown } } } };
      };
      expect(v.postCapture?.screen?.product?.active?.variant).toBeDefined();
    });
  });

  it("takes a different product's PRODUCT_CHANGED before the photo, and carries it to the product screen", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    const newProduct = { ...testProduct, id: "prod-changed" as typeof testProductId };
    const newSelection: VariantAttributes = { size: "l", colorway: "black" };
    actor.send({ type: "PRODUCT_CHANGED", product: newProduct, selection: newSelection });
    expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    expect(actor.getSnapshot().context.product.id).toBe("prod-changed");
    expect(actor.getSnapshot().context.selection).toEqual(newSelection);
    // The rest of the flow runs on as usual, ending on the new product's screen.
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
    const height = firstChildActor(actor)!;
    height.send({ type: "SET_HEIGHT", heightCm: 175 });
    height.send({ type: "CONFIRM" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: { product: "active" } } })).toBe(
        true,
      );
    });
    expect(actor.getSnapshot().context.product.id).toBe("prod-changed");
  });

  it("keeps the body when the product changes on the height screen", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
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
    const bodyId = actor.getSnapshot().context.bodyId;
    expect(bodyId).toBeDefined();
    const newProduct = { ...testProduct, id: "prod-changed" as typeof testProductId };
    actor.send({ type: "PRODUCT_CHANGED", product: newProduct, selection: {} });
    const snap = actor.getSnapshot();
    expect(snap.matches({ postCapture: { screen: "heightCalibration" } })).toBe(true);
    expect(snap.context.product.id).toBe("prod-changed");
    expect(snap.context.selection).toEqual({});
    expect(snap.context.bodyId).toBe(bodyId);
  });

  it("lets the next product's page say its size is a default, so the recommendation seeds it", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        // The first page's size was the shopper's pick.
        selection: initialSelection,
        selectedSizeIsDefault: false,
      },
    });
    actor.start();
    await runGlobalPrefix(actor);
    expect(actor.getSnapshot().context.sizeIsDefaultSelection).toBe(false);
    // The next page only preselects its first size; the mock client recommends "m".
    const newProduct = { ...testProduct, id: "prod-changed" as typeof testProductId };
    actor.send({
      type: "PRODUCT_CHANGED",
      product: newProduct,
      selection: { size: "xs", colorway: "black" },
      selectedSizeIsDefault: true,
    });
    expect(actor.getSnapshot().context.sizeIsDefaultSelection).toBe(true);
    await vi.waitFor(() => {
      expect(actor.getSnapshot().context.selection).toEqual({ size: "m", colorway: "black" });
    });
  });

  it("keeps the recommended size when the same page re-sends its default size", async () => {
    const client = createMockClient();
    const pageDefault: VariantAttributes = { size: "s", colorway: "black" };
    const actor = createActor(defaultRootMachine, {
      input: { client, product: testProduct, selection: pageDefault, selectedSizeIsDefault: true },
    });
    actor.start();
    await runGlobalPrefixToProduct(actor);
    // Calibrated, and the recommendation (the mock's "m") replaced the page's default.
    await vi.waitFor(() => {
      const snap = actor.getSnapshot();
      expect(snap.matches({ postCapture: { work: "done" } })).toBe(true);
      expect(snap.context.recommendation).toBeDefined();
      expect(snap.context.selection.size).toBe("m");
    });
    // Back on the same page (or a colour change there): it re-sends its default size.
    actor.send({
      type: "PRODUCT_CHANGED",
      product: testProduct,
      selection: { size: "s", colorway: "navy" },
      selectedSizeIsDefault: true,
    });
    expect(actor.getSnapshot().context.selection).toEqual({ size: "m", colorway: "navy" });
    expect(actor.getSnapshot().context.sizeIsDefaultSelection).toBe(true);
    // A size the shopper picked on the page stands.
    actor.send({
      type: "PRODUCT_CHANGED",
      product: testProduct,
      selection: { size: "s", colorway: "navy" },
      selectedSizeIsDefault: false,
    });
    expect(actor.getSnapshot().context.selection).toEqual({ size: "s", colorway: "navy" });
  });

  it("keeps the size-default flag on a product switch that does not say", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
        selectedSizeIsDefault: true,
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    const newProduct = { ...testProduct, id: "prod-changed" as typeof testProductId };
    actor.send({ type: "PRODUCT_CHANGED", product: newProduct, selection: initialSelection });
    expect(actor.getSnapshot().context.sizeIsDefaultSelection).toBe(true);
    // A same-product push without the field is the shopper's pick, as before.
    actor.send({
      type: "PRODUCT_CHANGED",
      product: newProduct,
      selection: { size: "l", colorway: "black" },
    });
    expect(actor.getSnapshot().context.sizeIsDefaultSelection).toBe(false);
  });

  it("BACK_TO_HEIGHT returns to body height calibration", async () => {
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
    actor.send({ type: "BACK_TO_HEIGHT" });
    expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
      true,
    );
  });

  it("RESET_PRODUCT clears variant attributes back to an empty selection", async () => {
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
    actor.send({
      type: "SELECT_VARIANT",
      selection: { size: "m", colorway: "black" },
    });
    actor.send({ type: "RESET_PRODUCT" });
    expect(actor.getSnapshot().context.selection).toEqual({});
  });

  it("USE_ANOTHER_IMAGE from product preserves selection/product/lastCapturedImage and flags source", async () => {
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
    actor.send({
      type: "SELECT_VARIANT",
      selection: { size: "m", colorway: "black" },
    });
    const beforeSelection = actor.getSnapshot().context.selection;
    const beforeProduct = actor.getSnapshot().context.product;
    const beforeImage = actor.getSnapshot().context.lastCapturedImage;
    const beforeHeight = actor.getSnapshot().context.bodyHeightCm;
    const beforeBodyId = actor.getSnapshot().context.bodyId;
    actor.send({ type: "USE_ANOTHER_IMAGE", source: "product" });
    const snap = actor.getSnapshot();
    expect(snap.matches("photoUpload")).toBe(true);
    expect(snap.context.useAnotherImageSource).toBe("product");
    expect(snap.context.selection).toEqual(beforeSelection);
    expect(snap.context.product).toBe(beforeProduct);
    expect(snap.context.lastCapturedImage).toEqual(beforeImage);
    expect(snap.context.bodyHeightCm).toBe(beforeHeight);
    expect(snap.context.bodyId).toBe(beforeBodyId);
    expect(snap.context.recommendation).toBeUndefined();
    expect(snap.context.pendingTryOn).toBeUndefined();
  });

  it("USE_ANOTHER_IMAGE from bodyHeightCalibration re-enters photoUpload; successful upload clears source and returns to bodyHeightCalibration", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
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
    actor.send({ type: "USE_ANOTHER_IMAGE", source: "bodyHeightCalibration" });
    expect(actor.getSnapshot().matches("photoUpload")).toBe(true);
    expect(actor.getSnapshot().context.useAnotherImageSource).toBe("bodyHeightCalibration");
    expect(actor.getSnapshot().context.lastCapturedImage).toBeDefined();
    const nextBlob = new Blob([new Uint8Array([4, 5, 6])], { type: "image/jpeg" });
    const photoChild = firstChildActor(actor);
    expect(photoChild).toBeDefined();
    photoChild!.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob: nextBlob } });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
        true,
      );
    });
    expect(actor.getSnapshot().context.useAnotherImageSource).toBeUndefined();
  });

  it("CANCEL_USE_ANOTHER_IMAGE routes back to the originating phase and clears the source flag", async () => {
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

    actor.send({ type: "USE_ANOTHER_IMAGE", source: "product" });
    expect(actor.getSnapshot().matches("photoUpload")).toBe(true);
    actor.send({ type: "CANCEL_USE_ANOTHER_IMAGE" });
    let snap = actor.getSnapshot();
    expect(snap.matches({ postCapture: { screen: "product" } })).toBe(true);
    // Cancelling from product source should land directly in `work.done`,
    // skipping a redundant calibrate round-trip.
    expect(snap.matches({ postCapture: { work: "done" } })).toBe(true);
    expect(snap.context.useAnotherImageSource).toBeUndefined();

    actor.send({ type: "USE_ANOTHER_IMAGE", source: "bodyHeightCalibration" });
    expect(actor.getSnapshot().matches("photoUpload")).toBe(true);
    actor.send({ type: "CANCEL_USE_ANOTHER_IMAGE" });
    snap = actor.getSnapshot();
    expect(snap.matches({ postCapture: { screen: "heightCalibration" } })).toBe(true);
    expect(snap.matches({ postCapture: { work: "running" } })).toBe(true);
    expect(snap.context.useAnotherImageSource).toBeUndefined();

    actor.send({ type: "USE_ANOTHER_IMAGE", source: "photoUpload" });
    expect(actor.getSnapshot().matches("photoUpload")).toBe(true);
    actor.send({ type: "CANCEL_USE_ANOTHER_IMAGE" });
    snap = actor.getSnapshot();
    expect(snap.matches({ sessionIntro: "awaitingImage" })).toBe(true);
    expect(snap.context.useAnotherImageSource).toBeUndefined();
    expect(snap.context.pendingSelectedImage).toBeUndefined();
  });

  it("restores session from persistence and skips consent", async () => {
    const client = createMockClient();
    const persistence = createMemorySessionPersistence(testSession);
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
        sessionPersistence: persistence,
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    expect(actor.getSnapshot().context.session).toBe(testSession);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
        true,
      );
    });
  });

  it("persists session after createSession completes", async () => {
    const client = createMockClient();
    const persistence = createMemorySessionPersistence();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
        sessionPersistence: persistence,
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(persistence.snapshot()).toBe(testSession);
    });
  });

  it("photoUpload rejection is captured into lastPhotoRejection and cleared on success", async () => {
    let createBodyCalls = 0;
    const base = createMockClient();
    const client = createMockClient({
      body: {
        ...base.body,
        createBody: async (input) => {
          createBodyCalls += 1;
          if (createBodyCalls === 1) {
            return {
              ok: true,
              data: {
                status: "failed",
                failure: {
                  kind: "validation",
                  code: asBodyValidationCode("human_occluded"),
                  message: "bad photo",
                },
              },
            };
          }
          return await base.body.createBody(input);
        },
      },
    });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    const badBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob: badBlob } });
    await vi.waitFor(() => {
      expect(firstChildActor(actor)?.getSnapshot().value).toBe("rejected");
    });
    const rejectionAfterFirst = actor.getSnapshot().context.lastPhotoRejection;
    expect(rejectionAfterFirst).toBeDefined();
    expect(rejectionAfterFirst!.image).toEqual({ type: "blob", blob: badBlob });
    expect((rejectionAfterFirst!.error as { message?: string }).message).toBe("bad photo");

    actor.send({ type: "USE_ANOTHER_IMAGE", source: "photoUpload" });
    expect(actor.getSnapshot().context.lastPhotoRejection).toEqual(rejectionAfterFirst);

    const goodBlob = new Blob([new Uint8Array([4, 5, 6])], { type: "image/jpeg" });
    firstChildActor(actor)!.send({
      type: "IMAGE_SELECTED",
      image: { type: "blob", blob: goodBlob },
    });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
        true,
      );
    });
    expect(actor.getSnapshot().context.lastPhotoRejection).toBeUndefined();
    expect(createBodyCalls).toBe(2);
  });

  it("RETURN_TO_SESSION_INTRO_FOR_GUIDE returns to session intro when session exists", async () => {
    const base = createMockClient();
    const client = createMockClient({
      body: {
        ...base.body,
        createBody: async () => ({
          ok: true,
          data: {
            status: "failed",
            failure: {
              kind: "validation",
              code: asBodyValidationCode("human_occluded"),
              message: "reject",
            },
          },
        }),
      },
    });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
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
    await vi.waitFor(() => {
      expect(firstChildActor(actor)?.getSnapshot().value).toBe("rejected");
    });
    actor.send({ type: "RETURN_TO_SESSION_INTRO_FOR_GUIDE" });
    expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    expect(actor.getSnapshot().context.session).toBe(testSession);
  });

  it("CONFIRM swaps screen to product immediately and work region settles in done after CALIBRATION_DONE", async () => {
    const calibrateGate = deferred<typeof testBody>();
    const base = createMockClient();
    const client = createMockClient({
      body: {
        ...base.body,
        setBodyHeight: async () => {
          const bodyId = await calibrateGate.promise;
          return {
            ok: true,
            data: {
              body: {
                bodyId,
                createdAt: "",
                estimatedHeightCm: 170,
                userProvidedHeightCm: 175,
              },
            },
          };
        },
      },
    });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
    // Drive the prefix manually so we can assert the moment between
    // CALIBRATION_SUBMITTED (screen swap) and CALIBRATION_DONE.
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
    const child = firstChildActor(actor)!;
    child.send({ type: "SET_HEIGHT", heightCm: 175 });
    child.send({ type: "CONFIRM" });
    // Screen should have advanced to product on CALIBRATION_SUBMITTED while
    // work is still running and the calibrate Promise is pending.
    await vi.waitFor(() => {
      expect(
        actor.getSnapshot().matches({ postCapture: { screen: "product", work: "running" } }),
      ).toBe(true);
    });
    // Resolve calibrate; work region should settle into `done` and assigns
    // should propagate to context.bodyId without disturbing the product screen.
    calibrateGate.resolve(testBody);
    await vi.waitFor(() => {
      expect(
        actor.getSnapshot().matches({ postCapture: { screen: "product", work: "done" } }),
      ).toBe(true);
    });
    expect(actor.getSnapshot().context.bodyHeightCm).toBe(175);
    expect(actor.getSnapshot().context.bodyId).toBe(testBody);
    // The initial calibration records the first body revision. Subsequent
    // CALIBRATION_DONEs only append when the height actually changes — re-confirms
    // of the same height keep `bodyRevisions` stable so try-ons stay attributed.
    expect(actor.getSnapshot().context.bodyRevisions).toEqual([
      { bodyId: testBody, bodyHeightCm: 175 },
    ]);
  });

  it("CALIBRATION_FAILED yanks screen back to heightCalibration with selection preserved", async () => {
    const calibrateGate = deferred<never>();
    const base = createMockClient();
    const client = createMockClient({
      body: {
        ...base.body,
        setBodyHeight: async () => {
          await calibrateGate.promise;
          throw new Error("unreachable");
        },
      },
    });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
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
    const child = firstChildActor(actor)!;
    child.send({ type: "SET_HEIGHT", heightCm: 175 });
    child.send({ type: "CONFIRM" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "product" } })).toBe(true);
    });
    // User selects a variant on the product page while calibration in flight.
    actor.send({
      type: "SELECT_VARIANT",
      selection: { size: "m", colorway: "black" },
    });
    expect(actor.getSnapshot().context.selection.size).toBe("m");
    // Calibrate fails; screen should snap back to heightCalibration but
    // selection survives so the product page restores cleanly on retry.
    calibrateGate.reject(new Error("network down"));
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
        true,
      );
    });
    expect(actor.getSnapshot().context.selection.size).toBe("m");
    // The failure is recorded at the root so the height screen can surface it
    // even after the child resets to `editing` on the next picker re-sync.
    expect(actor.getSnapshot().context.lastCalibrationError).toBeDefined();
  });

  it("clears lastCalibrationError on retry submit and keeps it clear after success", async () => {
    let calls = 0;
    const base = createMockClient();
    const client = createMockClient({
      body: {
        ...base.body,
        setBodyHeight: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error("network down");
          }
          return {
            ok: true,
            data: {
              body: {
                bodyId: testBody,
                createdAt: "",
                estimatedHeightCm: 170,
                userProvidedHeightCm: 175,
              },
            },
          };
        },
      },
    });
    const actor = createActor(defaultRootMachine, {
      input: { client, product: testProduct, selection: initialSelection },
    });
    actor.start();
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
    const child = firstChildActor(actor)!;
    child.send({ type: "SET_HEIGHT", heightCm: 175 });
    child.send({ type: "CONFIRM" });
    // First calibrate fails → error recorded, yanked back to height.
    await vi.waitFor(() => {
      expect(actor.getSnapshot().context.lastCalibrationError).toBeDefined();
    });
    // Retry: CALIBRATION_SUBMITTED clears it; the successful CALIBRATION_DONE keeps it clear.
    firstChildActor(actor)!.send({ type: "CONFIRM" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { work: "done" } })).toBe(true);
    });
    expect(actor.getSnapshot().context.lastCalibrationError).toBeUndefined();
  });

  it("queues START_TRY_ON in awaitingCalibration while work region is running and fires it on CALIBRATION_DONE", async () => {
    const calibrateGate = deferred<typeof testBody>();
    const base = createMockClient();
    const client = createMockClient({
      body: {
        ...base.body,
        setBodyHeight: async () => {
          const bodyId = await calibrateGate.promise;
          return {
            ok: true,
            data: {
              body: {
                bodyId,
                createdAt: "",
                estimatedHeightCm: 170,
                userProvidedHeightCm: 175,
              },
            },
          };
        },
      },
    });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
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
    const child = firstChildActor(actor)!;
    child.send({ type: "SET_HEIGHT", heightCm: 175 });
    child.send({ type: "CONFIRM" });
    await vi.waitFor(() => {
      expect(
        actor.getSnapshot().matches({ postCapture: { screen: "product", work: "running" } }),
      ).toBe(true);
    });
    actor.send({
      type: "SELECT_VARIANT",
      selection: { size: "m", colorway: "black" },
    });
    actor.send({ type: "START_TRY_ON" });
    expect(
      actor.getSnapshot().matches({
        postCapture: {
          screen: { product: { active: { tryOnPipeline: "awaitingCalibration" } } },
        },
      }),
    ).toBe(true);
    calibrateGate.resolve(testBody);
    // CALIBRATION_DONE should kick the queued click into requesting (and
    // through to resulting once createTryOn resolves).
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value as {
        postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
      };
      expect(v.postCapture?.screen?.product?.active?.tryOnPipeline).toBe("resulting");
    });
  });

  it("auto-starts the try-on on the product screen when autoStartOnPreselectedVariant is set", async () => {
    const calibrateGate = deferred<typeof testBody>();
    const base = createMockClient();
    const client = createMockClient({
      body: {
        ...base.body,
        setBodyHeight: async () => {
          const bodyId = await calibrateGate.promise;
          return {
            ok: true,
            data: {
              body: {
                bodyId,
                createdAt: "",
                estimatedHeightCm: 170,
                userProvidedHeightCm: 175,
              },
            },
          };
        },
      },
    });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        // Size already picked in the shop → the sheet should skip the picker.
        selection: initialSelection,
        autoStartOnPreselectedVariant: true,
      },
    });
    actor.start();
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
    const child = firstChildActor(actor)!;
    child.send({ type: "SET_HEIGHT", heightCm: 175 });
    child.send({ type: "CONFIRM" });
    // No manual START_TRY_ON: confirming the height should land on the product
    // screen and auto-fire the try-on, which queues behind the in-flight
    // calibration exactly as a manual click would.
    await vi.waitFor(() => {
      expect(
        actor.getSnapshot().matches({
          postCapture: {
            screen: { product: { active: { tryOnPipeline: "awaitingCalibration" } } },
            work: "running",
          },
        }),
      ).toBe(true);
    });
    // One-shot: the flag is consumed so manual returns to the picker won't re-fire.
    expect(actor.getSnapshot().context.pendingAutoStartTryOn).toBe(false);
    calibrateGate.resolve(testBody);
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value as {
        postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
      };
      expect(v.postCapture?.screen?.product?.active?.tryOnPipeline).toBe("resulting");
    });
  });

  it("recommendation-first: a host-default size is re-seeded and a deferred auto-start fires with the recommended size", async () => {
    const client = createMockClient();
    client.tryOn.getRecommendedSize = async () => ({
      ok: true,
      data: {
        recommendedSize: "l",
        recommendations: [{ size: "l", rank: 1, rationale: "fits with ideal ease", fit: "ideal" }],
      },
    });
    const createTryOnSizes: string[] = [];
    const originalCreateTryOn = client.tryOn.createTryOn.bind(client.tryOn);
    client.tryOn.createTryOn = async (args, options) => {
      createTryOnSizes.push(attributesOfVariant(testProduct, args.variantId).size ?? "");
      return await originalCreateTryOn(args, options);
    };

    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        // The host preselects "m" only as its Add-to-Cart default — the shopper never picked.
        selection: initialSelection,
        selectedSizeIsDefault: true,
        autoStartOnPreselectedVariant: true,
        // Fit-intelligence hosts opt into auto-rendering the recommendation.
        autoStartOnRecommendedSize: true,
      },
    });
    actor.start();
    await runGlobalPrefixToProduct(actor);

    // The product entry defers the one-shot; the recommendation fetch seeds the size and
    // releases it, so the auto-started try-on renders the RECOMMENDED size, not the default.
    await vi.waitFor(() => {
      expect(actor.getSnapshot().context.selection.size).toBe("l");
    });
    await vi.waitFor(() => {
      expect(createTryOnSizes).toEqual(["l"]);
    });
    expect(actor.getSnapshot().context.pendingAutoStartTryOn).toBe(false);
    expect(actor.getSnapshot().context.recommendation?.recommendedSize).toBe("l");
  });

  it("a host-default size does NOT auto-start without autoStartOnRecommendedSize — the shopper picks on the size screen", async () => {
    const client = createMockClient();
    client.tryOn.getRecommendedSize = async () => ({
      ok: true,
      data: {
        recommendedSize: "l",
        recommendations: [{ size: "l", rank: 1, rationale: "fits with ideal ease", fit: "ideal" }],
      },
    });
    const createTryOnSizes: string[] = [];
    const originalCreateTryOn = client.tryOn.createTryOn.bind(client.tryOn);
    client.tryOn.createTryOn = async (args, options) => {
      createTryOnSizes.push(attributesOfVariant(testProduct, args.variantId).size ?? "");
      return await originalCreateTryOn(args, options);
    };

    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        // Default-only size, no autoStartOnRecommendedSize: starting a render on a size
        // nobody chose would be wrong.
        selection: initialSelection,
        selectedSizeIsDefault: true,
        autoStartOnPreselectedVariant: true,
      },
    });
    actor.start();
    await runGlobalPrefixToProduct(actor);

    // The recommendation still seeds the selection, so the size screen preselects it…
    await vi.waitFor(() => {
      expect(actor.getSnapshot().context.selection.size).toBe("l");
    });
    // …but nothing is rendered: the one-shot is spent and the pipeline stays idle.
    expect(actor.getSnapshot().context.pendingAutoStartTryOn).toBe(false);
    await vi.waitFor(() => {
      expect(
        actor.getSnapshot().matches({
          postCapture: { screen: { product: { active: { tryOnPipeline: "idle" } } } },
        }),
      ).toBe(true);
    });
    expect(createTryOnSizes).toEqual([]);

    // The shopper's own pick then drives the try-on exactly as a manual flow would.
    actor.send({ type: "SELECT_VARIANT", selection: { ...initialSelection, size: "s" } });
    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      expect(createTryOnSizes).toEqual(["s"]);
    });
  });

  it("recommendation-first: an explicit in-sheet pick is never overridden by a late recommendation", async () => {
    const client = createMockClient();
    // Hold the recommendation response until after the user picks.
    const recommendationGate = deferred<null>();
    client.tryOn.getRecommendedSize = async () => {
      await recommendationGate.promise;
      return {
        ok: true,
        data: {
          recommendedSize: "l",
          recommendations: [
            { size: "l", rank: 1, rationale: "fits with ideal ease", fit: "ideal" },
          ],
        },
      };
    };

    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
        selectedSizeIsDefault: true,
      },
    });
    actor.start();
    await runGlobalPrefixToProduct(actor);

    // The shopper picks "s" while the fetch is still in flight — an explicit choice.
    actor.send({ type: "SELECT_VARIANT", selection: { ...initialSelection, size: "s" } });
    recommendationGate.resolve(null);
    await vi.waitFor(() => {
      expect(actor.getSnapshot().context.recommendation?.recommendedSize).toBe("l");
    });
    // The late recommendation is surfaced (banner data) but does NOT override the pick.
    expect(actor.getSnapshot().context.selection.size).toBe("s");
    expect(actor.getSnapshot().context.sizeIsDefaultSelection).toBe(false);
  });

  it("does not auto-start again when returning to variant selection after the one-shot is consumed", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
        autoStartOnPreselectedVariant: true,
      },
    });
    actor.start();
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
    const child = firstChildActor(actor)!;
    child.send({ type: "SET_HEIGHT", heightCm: 175 });
    child.send({ type: "CONFIRM" });
    // The default mock resolves calibrate + try-on inline, so the auto-fired
    // try-on runs all the way through to the result screen.
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value as {
        postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
      };
      expect(v.postCapture?.screen?.product?.active?.tryOnPipeline).toBe("resulting");
    });
    expect(actor.getSnapshot().context.pendingAutoStartTryOn).toBe(false);
    // Back out to the picker: the one-shot is spent, so it must render in `idle`
    // rather than re-firing the try-on.
    actor.send({ type: "RETURN_TO_VARIANT_SELECTION", via: "back" });
    await vi.waitFor(() => {
      expect(
        actor.getSnapshot().matches({
          postCapture: { screen: { product: { active: { tryOnPipeline: "idle" } } } },
        }),
      ).toBe(true);
    });
    // Give any (unwanted) raised START_TRY_ON a chance to settle, then confirm
    // we're still idle on the picker.
    await Promise.resolve();
    expect(
      actor.getSnapshot().matches({
        postCapture: { screen: { product: { active: { tryOnPipeline: "idle" } } } },
      }),
    ).toBe(true);
  });

  it("refuses a gated selection on START_TRY_ON — no request at all, verdict recorded for the note", async () => {
    const client = createMockClient();
    // "s" is gated too-small in the preview; "m" is the gate-aware recommendation. The client
    // already holds that verdict, so it refuses without asking the server: sending the request
    // only to be told no cost a round-trip and showed the shopper a busy hero followed by an
    // error, for a size that was never going to render. The selection stays on their pick and
    // the recorded verdict is what the picker's note reads from.
    client.tryOn.getRecommendedSize = async () => ({
      ok: true,
      data: {
        recommendedSize: "m",
        recommendations: [
          { size: "m", rank: 1, rationale: "fits with ideal ease", fit: "ideal" },
          { size: "s", rank: 2, rationale: "", fit: "too_small", gate: "too_small" as const },
        ],
      },
    });
    const createTryOnSizes: string[] = [];
    client.tryOn.createTryOn = async (args) => {
      createTryOnSizes.push(attributesOfVariant(testProduct, args.variantId).size ?? "");
      return {
        ok: true,
        data: {
          status: "failure" as const,
          reason: { kind: "garment_too_small" as const, recommendedSize: "m" },
        },
      };
    };
    const actor = createActor(defaultRootMachine, {
      input: { client, product: testProduct, selection: initialSelection },
    });
    const insists: unknown[] = [];
    // oxlint-disable-next-line typescript-eslint/no-explicit-any -- emitted-event union isn't surfaced on the machine type
    (actor as any).on("gated-size-selected", (ev: unknown) => insists.push(ev));
    actor.start();
    await runGlobalPrefix(actor);

    // The shopper deliberately picks the badged, gated size — the informed insist.
    actor.send({ type: "SELECT_VARIANT", selection: { size: "s", colorway: "black" } });
    expect(insists).toHaveLength(1);
    expect(insists[0]).toMatchObject({ size: "s", gate: "too_small" });

    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value as {
        postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
      };
      expect(v.postCapture?.screen?.product?.active?.tryOnPipeline).toBe("idle");
    });
    // NO request at all — not the picked size, and not a silent swap to "m" either.
    expect(createTryOnSizes).toEqual([]);
    // The selection stays where the shopper put it; nothing is rendered on their behalf.
    expect(actor.getSnapshot().context.selection.size).toBe("s");
    expect(actor.getSnapshot().context.lastTryOnFailure).toMatchObject({
      reason: "garment_too_small",
      requestedSize: "s",
      recommendedSize: "m",
    });
    expect(actor.getSnapshot().context.lastTryOnFailure?.autoPivoted).toBeUndefined();
  });

  it("does not auto-pivot a manual pick's server rejection — keeps the picked size and re-tries it on a repeat click (no failure cache)", async () => {
    const client = createMockClient();
    // The preview carries NO gate (chartless-product case) — the server gate is the one that
    // rejects "s" and recommends "m". With the auto-pivot removed, the rejection is surfaced as
    // a note and the selection stays on "s"; it is never silently re-rendered as "m".
    const createTryOnSizes: string[] = [];
    const originalCreateTryOn = client.tryOn.createTryOn.bind(client.tryOn);
    client.tryOn.createTryOn = async (args, options) => {
      const size = attributesOfVariant(testProduct, args.variantId).size ?? "";
      createTryOnSizes.push(size);
      if (size === "s") {
        return {
          ok: true,
          data: {
            status: "failure" as const,
            reason: { kind: "garment_too_small" as const, recommendedSize: "m" },
          },
        };
      }
      return await originalCreateTryOn(args, options);
    };
    const actor = createActor(defaultRootMachine, {
      input: { client, product: testProduct, selection: initialSelection },
    });
    actor.start();
    await runGlobalPrefix(actor);

    // A MANUAL pick that fails on the server is NOT swapped — the note recommends "m", the
    // shopper decides, and the selection stays on their choice.
    actor.send({ type: "SELECT_VARIANT", selection: { size: "s", colorway: "black" } });
    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value as {
        postCapture?: { screen?: { product?: { active?: { tryOnPipeline?: string } } } };
      };
      expect(v.postCapture?.screen?.product?.active?.tryOnPipeline).toBe("idle");
    });
    expect(createTryOnSizes).toEqual(["s"]);
    expect(actor.getSnapshot().context.selection.size).toBe("s");
    expect(actor.getSnapshot().context.lastTryOnFailure).toMatchObject({
      requestedSize: "s",
      recommendedSize: "m",
    });
    expect(actor.getSnapshot().context.lastTryOnFailure?.autoPivoted).toBeUndefined();

    // Repeat pick of the rejected size: the failure cache is gone, so the click goes back to
    // the server (source of truth) and tries "s" again — never a locally replayed prompt, and
    // never a silent swap to "m".
    actor.send({ type: "SELECT_VARIANT", selection: { size: "s", colorway: "black" } });
    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      expect(createTryOnSizes).toEqual(["s", "s"]);
    });
  });

  it("OPEN_CAMERA from sessionIntro.awaitingImage transitions to photoCapture", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    const session = firstChildActor(actor);
    session!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    actor.send({ type: "OPEN_CAMERA", source: "intro" });
    expect(actor.getSnapshot().matches("photoCapture")).toBe(true);
  });

  it("CANCEL_CAMERA returns to sessionIntro.awaitingImage", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    const session = firstChildActor(actor);
    session!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    actor.send({ type: "OPEN_CAMERA", source: "intro" });
    expect(actor.getSnapshot().matches("photoCapture")).toBe(true);
    actor.send({ type: "CANCEL_CAMERA" });
    expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
  });

  it("captured frame flows through photoCapture → photoUpload and lands in postCapture", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    const session = firstChildActor(actor);
    session!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    actor.send({ type: "OPEN_CAMERA", source: "intro" });
    expect(actor.getSnapshot().matches("photoCapture")).toBe(true);
    const camera = firstChildActor(actor);
    expect(camera).toBeDefined();
    camera!.send({ type: "CAMERA_READY" });
    camera!.send({ type: "AUTO_CAPTURE" });
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: "image/jpeg" });
    camera!.send({ type: "FRAME_CAPTURED", image: { type: "blob", blob } });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
        true,
      );
    });
    // Captured image was forwarded as `lastCapturedImage` after the upload succeeded.
    expect(actor.getSnapshot().context.lastCapturedImage?.type).toBe("blob");
    // `photoSource` is set to "camera" so the UI can keep showing the capture screen during upload.
    expect(actor.getSnapshot().context.photoSource).toBe("camera");
  });

  it("photoSource is set to 'gallery' on IMAGE_SELECTED from sessionIntro.awaitingImage", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    const session = firstChildActor(actor);
    session!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    expect(actor.getSnapshot().context.photoSource).toBe("gallery");
  });

  it("OPEN_CAMERA from postCapture (height) routes back to photoCapture", async () => {
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
    // We're past height calibration into product; drop back to height for
    // realism (host's back-button position).
    actor.send({ type: "BACK_TO_HEIGHT" });
    expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
      true,
    );
    actor.send({ type: "OPEN_CAMERA", source: "height" });
    expect(actor.getSnapshot().matches("photoCapture")).toBe(true);
  });

  it("photoSource flips to 'gallery' on USE_ANOTHER_IMAGE even if previous source was 'camera'", async () => {
    const client = createMockClient();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
    });
    const session = firstChildActor(actor);
    session!.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
    });
    // Run the camera path to populate `photoSource` = "camera".
    actor.send({ type: "OPEN_CAMERA", source: "intro" });
    const camera = firstChildActor(actor);
    camera!.send({ type: "CAMERA_READY" });
    camera!.send({ type: "AUTO_CAPTURE" });
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: "image/jpeg" });
    camera!.send({ type: "FRAME_CAPTURED", image: { type: "blob", blob } });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
        true,
      );
    });
    expect(actor.getSnapshot().context.photoSource).toBe("camera");
    // Now request a re-upload via gallery picker.
    actor.send({ type: "USE_ANOTHER_IMAGE", source: "bodyHeightCalibration" });
    expect(actor.getSnapshot().context.photoSource).toBe("gallery");
  });
});
