import type { TryOnResult } from "@studio-vaai/js-client";

import { assign, setup } from "xstate";

import type { TryOnResultContext, TryOnResultInput } from "../context/index.js";

import { getTryOnActor, isSessionExpiredError, transportErrorFromActor } from "../actors.js";

export type TryOnResultEvent = { type: "DISMISS" } | { type: "RETRY" } | { type: "ENTER_OOS" };

/**
 * Standalone-safe parent notify (mirrors `emitParent` in
 * body-height-calibration): when invoked by {@link defaultRootMachine} and the
 * fetch failed with the terminal `session_expired` kind, escalate so the root
 * resets to consent instead of leaving the user on a retryable error screen.
 * No-ops when the machine runs without a parent (tests).
 */
function notifyParentSessionExpired({ self, event }: { self: unknown; event: unknown }): void {
  if (!isSessionExpiredError((event as { error: unknown }).error)) {
    return;
  }
  const parent = (self as { _parent?: { send: (e: { type: "SESSION_EXPIRED" }) => void } })._parent;
  parent?.send({ type: "SESSION_EXPIRED" });
}

export type TryOnResultOutput = { kind: "dismissed" } | { kind: "retryRequest" };

export const tryOnResultMachine = setup({
  types: {
    context: {} as TryOnResultContext,
    events: {} as TryOnResultEvent,
    input: {} as TryOnResultInput,
    output: {} as TryOnResultOutput,
  },
  actors: {
    getTryOn: getTryOnActor,
  },
  guards: {
    hasInitialResult: ({ context }) => context.initialResult !== undefined,
    canFetchTryOn: ({ context }) =>
      context.initialResult === undefined && context.tryOnId !== undefined,
    isSuccess: ({ context }) => context.resolved?.status === "success",
    // A garment-level `"error"` result (fit/size problem) routes to the
    // `sizeCorrection` screen rather than `transportError`.
    isGarmentError: ({ context }) => context.resolved?.status === "error",
  },
}).createMachine({
  id: "tryOnResult",
  initial: "loading",
  context: ({ input }) => ({
    client: input.client,
    session: input.session,
    tryOnId: input.tryOnId,
    initialResult: input.initialResult,
    resolved: input.initialResult,
    lastTransportError: undefined,
    completion: undefined,
  }),
  states: {
    loading: {
      always: [
        {
          guard: "hasInitialResult",
          target: "routing",
          actions: assign({
            resolved: ({ context }) => context.initialResult,
          }),
        },
        {
          guard: "canFetchTryOn",
          target: "fetching",
        },
        {
          target: "transportError",
          actions: assign({
            lastTransportError: () => ({
              kind: "validation_error",
              message: "tryOnResult: need initialResult or tryOnId for getTryOn",
            }),
          }),
        },
      ],
    },
    fetching: {
      invoke: {
        src: "getTryOn",
        input: ({ context }) => {
          const tryOnId = context.tryOnId;
          if (tryOnId === undefined) {
            throw new Error("tryOnResult: missing tryOnId");
          }
          return {
            client: context.client,
            session: context.session,
            tryOnId,
          };
        },
        onDone: {
          target: "routing",
          actions: assign({
            resolved: ({ event }) => event.output as TryOnResult,
          }),
        },
        onError: {
          target: "transportError",
          actions: [
            assign({
              lastTransportError: ({ event }) => transportErrorFromActor(event.error),
            }),
            notifyParentSessionExpired,
          ],
        },
      },
    },
    routing: {
      always: [
        { guard: "isSuccess", target: "success" },
        { guard: "isGarmentError", target: "sizeCorrection" },
        { target: "transportError" },
      ],
    },
    success: {
      on: {
        DISMISS: { target: "dismissed" },
        ENTER_OOS: { target: "oos" },
      },
    },
    sizeCorrection: {
      on: {
        DISMISS: { target: "dismissed" },
        RETRY: { target: "retryRequest" },
        ENTER_OOS: { target: "oos" },
      },
    },
    transportError: {
      on: {
        DISMISS: { target: "dismissed" },
        RETRY: { target: "retryRequest" },
        ENTER_OOS: { target: "oos" },
      },
    },
    oos: {
      on: {
        DISMISS: { target: "dismissed" },
        RETRY: { target: "retryRequest" },
      },
    },
    dismissed: {
      type: "final",
      entry: assign({
        completion: (): TryOnResultOutput => ({ kind: "dismissed" }),
      }),
    },
    retryRequest: {
      type: "final",
      entry: assign({
        completion: (): TryOnResultOutput => ({ kind: "retryRequest" }),
      }),
    },
  },
  // `completion` is non-null here: `output` is only evaluated once a final
  // state is reached, and both final states (`dismissed`, `retryRequest`) set
  // it on entry.
  output: ({ context }): TryOnResultOutput => context.completion!,
});
