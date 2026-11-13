import type { BodyId } from "@studio-vaai/js-client";

import { assign, setup } from "xstate";

import type {
  BodyHeightCalibrationContext,
  BodyHeightCalibrationInput,
  BodyHeightCalibrationOutput,
} from "../context/index.js";

import { setBodyHeightActor, transportErrorFromActor } from "../actors.js";

export type BodyHeightCalibrationEvent =
  | { type: "SET_HEIGHT"; heightCm: number }
  | { type: "CONFIRM" }
  | { type: "USE_ANOTHER_IMAGE" };

/**
 * Parent event union: this machine `sendParent`s these to coordinate the
 * postCapture parallel structure in {@link defaultRootMachine}.
 */
type ParentEvent =
  | { type: "CALIBRATION_SUBMITTED" }
  | { type: "CALIBRATION_DONE"; bodyId: BodyId; heightCm: number }
  | { type: "CALIBRATION_FAILED"; error: NonNullable<BodyHeightCalibrationContext["lastError"]> };

interface SelfWithParent {
  _parent?: { send: (event: ParentEvent) => void } | undefined;
}

/**
 * `sendParent` that no-ops when the machine is run standalone (no parent
 * invoker). Keeps the child testable in isolation while still coordinating
 * with parents when invoked. xstate's built-in `sendParent` throws in the
 * standalone case, so we resolve `self._parent` ourselves.
 */
function emitParent<TArgs extends { self: unknown }>(
  build: (args: TArgs) => ParentEvent,
): (args: TArgs) => void {
  return (args) => {
    const parent = (args.self as SelfWithParent)._parent;
    if (parent === undefined) {
      return;
    }
    parent.send(build(args));
  };
}

export const bodyHeightCalibrationMachine = setup({
  types: {
    context: {} as BodyHeightCalibrationContext,
    events: {} as BodyHeightCalibrationEvent,
    input: {} as BodyHeightCalibrationInput,
    output: {} as BodyHeightCalibrationOutput,
  },
  actors: {
    calibrateHeight: setBodyHeightActor,
  },
  guards: {
    hasHeight: ({ context }) => context.heightCm > 0,
  },
}).createMachine({
  id: "bodyHeightCalibration",
  initial: "editing",
  context: ({ input }) => ({
    client: input.client,
    session: input.session,
    bodyId: input.bodyId,
    heightCm: input.initialHeightCm,
    productId: input.productId,
    lastError: undefined,
  }),
  states: {
    editing: {
      on: {
        SET_HEIGHT: {
          actions: assign({
            heightCm: ({ event }) => event.heightCm,
            lastError: undefined,
          }),
        },
        USE_ANOTHER_IMAGE: { target: "retryCapture" },
        CONFIRM: {
          guard: "hasHeight",
          target: "calibrating",
        },
      },
    },
    calibrating: {
      // Tell the parent calibration is now in flight so it can advance the
      // screen region to `product` while we await the actor result here.
      entry: emitParent(() => ({ type: "CALIBRATION_SUBMITTED" })),
      // SET_HEIGHT intentionally not handled in `calibrating`: per spec, we
      // ignore height edits while the previous CONFIRM is still in flight.
      invoke: {
        src: "calibrateHeight",
        input: ({ context }) => {
          const heightCm = context.heightCm;
          return {
            client: context.client,
            session: context.session,
            bodyId: context.bodyId,
            heightCm,
            productId: context.productId,
          };
        },
        onDone: {
          target: "success",
          actions: assign({
            bodyId: ({ event }) => event.output as BodyId,
          }),
        },
        onError: {
          target: "failed",
          actions: assign({
            lastError: ({ event }) => transportErrorFromActor(event.error),
          }),
        },
      },
    },
    failed: {
      // Parent listens for CALIBRATION_FAILED to yank the screen region back
      // to `heightCalibration` so the user sees the error and can retry.
      entry: emitParent(({ context }: { context: BodyHeightCalibrationContext; self: unknown }) => {
        if (context.lastError === undefined) {
          throw new Error("bodyHeightCalibration: missing lastError on failed entry");
        }
        return { type: "CALIBRATION_FAILED", error: context.lastError };
      }),
      on: {
        // Re-attempt calibration with the current height.
        CONFIRM: { guard: "hasHeight", target: "calibrating" },
        // Height change clears the error and returns to editing.
        SET_HEIGHT: {
          target: "editing",
          actions: assign({ heightCm: ({ event }) => event.heightCm, lastError: undefined }),
        },
        USE_ANOTHER_IMAGE: { target: "retryCapture" },
      },
    },
    // Non-final: the user can return to the height screen via `BACK_TO_HEIGHT`
    // after calibration to adjust + re-confirm. The parent (`defaultRoot`)
    // observes completion via the `CALIBRATION_DONE` parent event below, NOT via
    // a final-state output, since terminating here would freeze the child and
    // drop those subsequent edits.
    success: {
      entry: emitParent(({ context }: { context: BodyHeightCalibrationContext; self: unknown }) => {
        if (context.heightCm <= 0) {
          throw new Error("bodyHeightCalibration: missing heightCm at success");
        }
        return {
          type: "CALIBRATION_DONE",
          bodyId: context.bodyId!,
          heightCm: context.heightCm,
        };
      }),
      on: {
        SET_HEIGHT: {
          target: "editing",
          actions: assign({ heightCm: ({ event }) => event.heightCm, lastError: undefined }),
        },
        CONFIRM: { guard: "hasHeight", target: "calibrating" },
        USE_ANOTHER_IMAGE: { target: "retryCapture" },
      },
    },
    retryCapture: {
      type: "final",
      entry: assign({
        completed: (): BodyHeightCalibrationOutput => ({ kind: "retryCapture" }),
      }),
    },
  },
  output: ({ context }): BodyHeightCalibrationOutput => context.completed!,
});
