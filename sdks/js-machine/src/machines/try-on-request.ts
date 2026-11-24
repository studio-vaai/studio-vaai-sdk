import type { TryOnResult } from "@studio-vaai/js-client";

import { assign, setup } from "xstate";

import type { TryOnRequestContext, TryOnRequestInput } from "../context/index.js";

import { createTryOnActor } from "../actors.js";

export type TryOnRequestOutput = {
  result: TryOnResult;
  recommendedAxes?: Readonly<Record<string, string>>;
  observedAxes?: Readonly<Record<string, string>>;
};

export const tryOnRequestMachine = setup({
  types: {
    context: {} as TryOnRequestContext,
    input: {} as TryOnRequestInput,
    output: {} as TryOnRequestOutput,
  },
  actors: {
    createTryOn: createTryOnActor,
  },
}).createMachine({
  id: "tryOnRequest",
  /** Run `createTryOn` as soon as this machine is invoked (parent does not send a separate START). */
  initial: "pending",
  context: ({ input }) => ({
    client: input.client,
    session: input.session,
    bodyId: input.bodyId,
    productId: input.productId,
    variantId: input.variantId,
    recommendedAxes: input.recommendedAxes,
    observedAxes: input.observedAxes,
    tryOnId: undefined,
  }),
  states: {
    pending: {
      invoke: {
        src: "createTryOn",
        input: ({ context }) => ({
          client: context.client,
          session: context.session,
          bodyId: context.bodyId,
          productId: context.productId,
          variantId: context.variantId,
        }),
        onDone: {
          target: "done",
          actions: assign({
            result: ({ event }) => event.output as TryOnResult,
            tryOnId: ({ event }) => {
              const r = event.output as TryOnResult;
              return r.status === "success" ? r.tryOnId : undefined;
            },
          }),
        },
        // No onError: errors bubble up to the parent's onError, transitioning tryOnPipeline → "error".
      },
    },
    done: {
      type: "final",
    },
  },
  output: ({ context }): TryOnRequestOutput => ({
    result: context.result!,
    ...(context.recommendedAxes && { recommendedAxes: context.recommendedAxes }),
    ...(context.observedAxes && { observedAxes: context.observedAxes }),
  }),
});
