import type { RecommendedSizeData } from "@studio-vaai/js-client";

import { enqueueActions, raise } from "xstate";

import type { AnalyticsSignal } from "../analytics-signal.js";
import type { DefaultRootContext, ProductFlowEvent, VariantAttributes } from "../context/index.js";

import { isSessionExpiredError, transportErrorFromActor } from "../actors.js";
import { findVariantByAttributes } from "../context/shared.js";

type SelectVariantEvent = { type: "SELECT_VARIANT"; selection: VariantAttributes };

type ProductOverviewCtx = DefaultRootContext;

/**
 * The effective recommendation to auto-act on: the best-ranked size the try-on HARD gate would
 * actually let through. The chart ranking and the gate can disagree (the chart measures fit
 * intent, the gate enforces physical catalog ceilings); auto-selecting a gated size would only
 * bounce off the gate at try-on time, so it is skipped up front.
 *
 * Returns `""` when nothing is wearable — every ranked size carries a gate, and the server omits
 * `recommendedSize` in that case rather than naming a size its own try-on gate would bounce.
 * Callers already read empty as "no recommendation" and show the dead-end copy.
 */
export function effectiveRecommendedSize(recommended: RecommendedSizeData): string {
  // The list is declared required but arrives absent from hosts and older payloads alike, and
  // `gatePrePivotSize` already reads it defensively — do the same here rather than throw.
  const ranked = (recommended.recommendations ?? []).toSorted((a, b) => a.rank - b.rank);
  const firstTryable = ranked.find((r) => r.gate === undefined);
  if (firstTryable !== undefined) {
    return firstTryable.size;
  }
  // Every ranked size is refused, so there is nothing to recommend. `recommendedSize` is rank 1
  // and carries no notion of the gate, so it names a refused size here — a single-size product
  // the shopper cannot wear reports exactly that, and pointing at it would ring and strike the
  // same chip while the copy called it the recommendation. Empty is the honest answer; every
  // caller already treats it as "no recommendation yet", and the dead-end copy takes over.
  //
  // Only when the server ranked NOTHING (no chart) does its own field stand, since then there
  // is no gate information to contradict. The server now omits the field outright when every
  // size is refused, so the coalesce is the same "no recommendation" answer by a second route.
  return ranked.length > 0 ? "" : (recommended.recommendedSize ?? "");
}

/**
 * The pre-pivot for a gated selection: when the currently-selected size is one the try-on hard
 * gate would reject, this is the size the try-on should run in INSTEAD — the gate-aware effective
 * recommendation — together with the gate verdict that motivates the swap. `undefined` when the
 * selection isn't gated, no recommendation has arrived, or there is nowhere better to pivot to
 * (the server-side gate then remains the backstop). Drives both the machine's pre-pivot on
 * `START_TRY_ON` (no failure round-trip) and the CTA relabel ("try it in X") in the styled UI.
 */
export function gatePrePivotSize(
  recommended: RecommendedSizeData | undefined,
  selection: VariantAttributes,
): { size: string; gate: "too_small" | "too_large" } | undefined {
  if (recommended === undefined) {
    return undefined;
  }
  const size = selection["size"];
  if (size === undefined || size.length === 0) {
    return undefined;
  }
  const gate = recommended.recommendations?.find((r) => r.size === size)?.gate;
  if (gate === undefined) {
    return undefined;
  }
  const effective = effectiveRecommendedSize(recommended);
  if (effective.length === 0 || effective === size) {
    return undefined;
  }
  return { size: effective, gate };
}

/**
 * The post-recommendation selection: the recommended slug replaces a host-default size when the
 * shopper hasn't picked one themselves AND the slug resolves to a real variant (a chart may carry
 * sizes the product doesn't offer). Otherwise the selection is returned unchanged. Seeds the
 * gate-aware {@link effectiveRecommendedSize}, never a size the try-on gate would reject.
 */
function selectionSeededByRecommendation(
  context: ProductOverviewCtx,
  recommended: RecommendedSizeData,
): VariantAttributes {
  // Guard on the GATE-AWARE pick, which is also what seeds the selection: testing the raw field
  // here would let a chart whose every size is refused seed a size the shopper cannot try on.
  const effective = effectiveRecommendedSize(recommended);
  if (
    !context.sizeIsDefaultSelection ||
    effective.length === 0 ||
    // A live fit-gate outcome (failure prompt or auto-pivot) outranks the chart pick.
    context.lastTryOnFailure !== undefined
  ) {
    return context.selection;
  }
  const seeded = { ...context.selection, size: effective };
  if (findVariantByAttributes(context.product, seeded) === undefined) {
    return context.selection;
  }
  return seeded;
}

/**
 * The selection a same-product `PRODUCT_CHANGED` leaves: the host's own, except that a size the
 * host marks as only its default takes the recommendation again once one is in. The size is
 * seeded only when a recommendation arrives, so a page re-sending its default (a return to the
 * same product, a colour change on the page) otherwise replaced the recommended size with the
 * page's first one, under a note still recommending the other.
 */
export function selectionAfterHostPush(
  context: ProductOverviewCtx,
  event: Extract<ProductFlowEvent, { type: "PRODUCT_CHANGED" }>,
): VariantAttributes {
  if (event.selectedSizeIsDefault !== true || context.recommendation === undefined) {
    return event.selection;
  }
  return selectionSeededByRecommendation(
    {
      ...context,
      product: event.product,
      selection: event.selection,
      sizeIsDefaultSelection: true,
    },
    context.recommendation,
  );
}

/**
 * Shared `SELECT_VARIANT` handling for the `selecting`/`selected` states:
 *
 * - An in-sheet pick is the shopper's own choice — the recommendation must not override it
 *   (now or on any later re-fetch), hence `sizeIsDefaultSelection: false`.
 * - Manual size change clears any "this size is too small" prompt — the user moving on means
 *   the message is no longer relevant.
 * - A fresh deliberate pick re-arms the fit-gate auto-pivot latch.
 * - Picking a size the gate preview marks unwearable emits the `gated-size-selected` signal:
 *   the chip was badged, so the pick is an informed insist — and since gated sizes are never
 *   rendered (the pipeline pre-pivots), the signal is the only record of it.
 */
const selectVariantActions = enqueueActions(({ context, event, enqueue }) => {
  const ctx = context as ProductOverviewCtx;
  const selection = (event as SelectVariantEvent).selection;
  const size = selection["size"];
  const sizeChanged = size !== undefined && size.length > 0 && size !== ctx.selection["size"];
  // Hosts (and tests) can hold partial recommendation payloads — treat a missing ranking
  // list the same as no recommendation.
  const gate = sizeChanged
    ? ctx.recommendation?.recommendations?.find((r) => r.size === size)?.gate
    : undefined;
  enqueue.assign({
    selection,
    sizeIsDefaultSelection: false,
    lastTryOnFailure: undefined,
  });
  if (gate !== undefined) {
    const signal: Extract<AnalyticsSignal, { type: "gated-size-selected" }> = {
      type: "gated-size-selected",
      "product-id": ctx.product.id,
      size: size!,
      gate,
    };
    // oxlint-disable-next-line typescript-eslint/no-explicit-any, typescript-eslint/no-unsafe-argument -- XState v5 emit typing in a leaf region file
    enqueue.emit(signal as any);
  }
});

/**
 * Parallel regions for variant selection + size recommendation (product “overview”).
 * Composed into the {@link defaultRootMachine} `product` state.
 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- XState v5 parallel region typing (`as any` below)
export const productOverviewParallelStates = {
  variant: {
    initial: "selecting",
    states: {
      selecting: {
        always: [
          {
            guard: ({ context }: { context: ProductOverviewCtx }) =>
              findVariantByAttributes(context.product, context.selection) !== undefined,
            target: "selected",
          },
        ],
        on: {
          SELECT_VARIANT: {
            target: "selected",
            actions: selectVariantActions,
          },
        },
      },
      selected: {
        on: {
          SELECT_VARIANT: {
            target: "selected",
            actions: selectVariantActions,
          },
        },
      },
    },
  },
  recommendation: {
    initial: "hidden",
    states: {
      hidden: {
        // Fetch the chart-based recommendation the moment the product screen has a session +
        // body. The DATA powers the whole fit UI (proactive note, gate badges, fit panel,
        // callouts), so it loads regardless of how the size was selected; what stays gated on
        // `sizeIsDefaultSelection` is ACTING on it — seeding `selection.size` and releasing a
        // deferred auto-start (see `selectionSeededByRecommendation`). A host-passed explicit
        // `?size=` therefore keeps its meaning without starving the fit UI of data.
        always: [
          {
            guard: ({ context }: { context: ProductOverviewCtx }) =>
              context.bodyId !== undefined && context.session !== undefined,
            target: "loading",
          },
        ],
        on: {
          RECOMMENDATION_REQUEST: { target: "loading" },
        },
      },
      loading: {
        on: {
          // A calibration completing mid-fetch means the in-flight result was
          // computed against the pre-calibration body — restart the invoke so
          // the stale response can never win the race (`reenter` cancels it).
          RECOMMENDATION_REQUEST: { target: "loading", reenter: true },
        },
        invoke: {
          src: "getRecommendedSize" as const,
          input: ({ context }: { context: ProductOverviewCtx }) => ({
            client: context.client,
            session: context.session!,
            bodyId: context.bodyId!,
            productId: context.product.id,
          }),
          onDone: {
            target: "visible",
            actions: enqueueActions(({ context, event, enqueue }) => {
              const ctx = context as ProductOverviewCtx;
              const recommended = (event as unknown as { output: RecommendedSizeData }).output;
              const selection = selectionSeededByRecommendation(ctx, recommended);
              enqueue.assign({
                recommendation: recommended,
                recommendationError: undefined,
                selection,
              });
              // Release a deferred auto-start (see the product-entry one-shot): it waited for
              // this fetch so the auto try-on renders the recommended size, not the default.
              // Only `autoStartOnRecommendedSize` hosts ever defer — without it the entry
              // one-shot already spent the flag and the shopper is on the size picker.
              if (
                ctx.pendingAutoStartTryOn &&
                ctx.sizeIsDefaultSelection &&
                ctx.autoStartOnRecommendedSize
              ) {
                enqueue.assign({ pendingAutoStartTryOn: false });
                if (findVariantByAttributes(ctx.product, selection) !== undefined) {
                  enqueue.raise({ type: "START_TRY_ON" });
                }
              }
            }),
          },
          onError: [
            {
              // Terminal session expiry: escalate to the root reset rather
              // than rendering a retryable recommendation error.
              guard: ({ event }: { event: unknown }) =>
                isSessionExpiredError((event as { error: unknown }).error),
              target: "error",
              actions: raise({ type: "SESSION_EXPIRED" }),
            },
            {
              target: "error",
              actions: enqueueActions(({ context, event, enqueue }) => {
                const ctx = context as ProductOverviewCtx;
                const err = (event as unknown as { error: unknown }).error;
                enqueue.assign({ recommendationError: transportErrorFromActor(err) });
                // A deferred auto-start must not hang on a failed fetch: fall back to the
                // host's default size (the pre-recommendation behaviour).
                if (
                  ctx.pendingAutoStartTryOn &&
                  ctx.sizeIsDefaultSelection &&
                  ctx.autoStartOnRecommendedSize
                ) {
                  enqueue.assign({ pendingAutoStartTryOn: false });
                  if (findVariantByAttributes(ctx.product, ctx.selection) !== undefined) {
                    enqueue.raise({ type: "START_TRY_ON" });
                  }
                }
              }),
            },
          ],
        },
      },
      visible: {
        on: {
          DISMISS_RECOMMENDATION: { target: "dismissed" },
          RECOMMENDATION_REQUEST: { target: "loading" },
        },
      },
      dismissed: {
        on: {
          RECOMMENDATION_REQUEST: { target: "loading" },
        },
      },
      error: {
        on: {
          RETRY_RECOMMENDATION: { target: "loading" },
          RECOMMENDATION_REQUEST: { target: "loading" },
        },
      },
    },
  },
  // oxlint-disable-next-line typescript-eslint/no-explicit-any -- XState v5 parallel region typing
} as any;
