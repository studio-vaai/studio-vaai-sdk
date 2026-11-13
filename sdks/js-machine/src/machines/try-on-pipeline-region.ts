import type { TryOnResult } from "@studio-vaai/js-client";

import { and, assign, emit, enqueueActions, raise, stateIn } from "xstate";

import type { DefaultRootContext, VariantAttributes } from "../context/index.js";
import type { TryOnHistoryEntry } from "../try-on-history-helpers.js";

import { type CompanionTryOnOutcome, isSessionExpiredError } from "../actors.js";
import { companionStyleSelections, findVariantByAttributes } from "../context/shared.js";
import { gatePrePivotSize } from "./product-overview-parallel.js";

type ProductPipelineCtx = DefaultRootContext;

type TryOnFailure = NonNullable<ProductPipelineCtx["lastTryOnFailure"]>;

/** Deep-equal on two attribute maps (same keys, same values). Mirrors the variant
 *  match in {@link findVariantByAttributes}, but compares an entry's stored attributes
 *  against the live selection rather than against the product's variant list. */
function attributesEqual(a: VariantAttributes, b: VariantAttributes): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  return aKeys.every((k) => a[k] === b[k]);
}

/** Index of the body revision active right now, using the same rule the append path
 *  snapshots with: `undefined` when the flow doesn't track revisions (or none have
 *  landed yet), else the latest index. Lets {@link findReplayableSuccessEntry} compare
 *  an entry's snapshot against "now" without special-casing the no-revisions flows. */
function currentBodyRevisionIndex(context: ProductPipelineCtx): number | undefined {
  const revisions = context.bodyRevisions ?? [];
  return revisions.length === 0 ? undefined : revisions.length - 1;
}

/** Find a prior completed try-on for the exact current selection that is still valid
 *  for the active body — a repeat click then re-opens its result screen from cache
 *  instead of re-issuing the request. Keyed on the full attribute map (not size-only
 *  like the failure cache) AND the body revision, so a recalibration to a new height
 *  invalidates the match and forces a fresh render. Requires the stored success payload
 *  (`tryOnId` + `scene`) so a match is always replayable without a round-trip; entries
 *  lacking it fall through to a live request. */
function findReplayableSuccessEntry(context: ProductPipelineCtx): TryOnHistoryEntry | undefined {
  const revision = currentBodyRevisionIndex(context);
  return context.tryOnHistoryByProduct[context.product.id]?.entries.find(
    (e) =>
      e.status === "completed" &&
      e.tryOnId !== undefined &&
      e.scene !== undefined &&
      e.bodyRevisionIndex === revision &&
      attributesEqual(e.attributes, context.selection),
  );
}

/** Reconstruct the `pendingTryOn` the `resulting` state feeds the result machine from a
 *  cached completed entry. Entries supplied here come from {@link findReplayableSuccessEntry},
 *  which guarantees the success payload is present. */
function pendingTryOnFromEntry(entry: TryOnHistoryEntry): { result: TryOnResult } {
  return {
    result: {
      status: "success",
      tryOnId: entry.tryOnId!,
      imageUrl: entry.imageUrl,
      scene: entry.scene!,
      ...(entry.fitAnchors === undefined ? {} : { fitAnchors: entry.fitAnchors }),
      ...(entry.provenance === undefined ? {} : { provenance: entry.provenance }),
    },
  };
}

/** Move the active product's carousel cursor onto a specific entry, leaving its entries
 *  untouched — used by cached-success replay so the result screen opens on the matched
 *  entry (the live path advances the cursor in {@link appendHistoryEntryFromEvent}). */
function historyWithCursorAtEntry(
  context: ProductPipelineCtx,
  entry: TryOnHistoryEntry,
): ProductPipelineCtx["tryOnHistoryByProduct"] {
  const prev = context.tryOnHistoryByProduct[context.product.id];
  if (prev === undefined) {
    return context.tryOnHistoryByProduct;
  }
  return {
    ...context.tryOnHistoryByProduct,
    [context.product.id]: { ...prev, cursor: prev.entries.indexOf(entry) },
  };
}

function isCalibrationInFlight(context: ProductPipelineCtx): boolean {
  return context.calibrationInFlight;
}

function invokeOutputDismissed(event: unknown): boolean {
  const out = (event as { output?: unknown }).output;
  return (
    out !== undefined &&
    typeof out === "object" &&
    out !== null &&
    "kind" in out &&
    (out as { kind: string }).kind === "dismissed"
  );
}

function invokeOutputRetryRequest(event: unknown): boolean {
  const out = (event as { output?: unknown }).output;
  return (
    out !== undefined &&
    typeof out === "object" &&
    out !== null &&
    "kind" in out &&
    (out as { kind: string }).kind === "retryRequest"
  );
}

/**
 * Parallel region for try-on request + result viewing. Composed into the
 * {@link defaultRootMachine} `product` state under key `tryOnPipeline`.
 *
 * Invokes use ids {@link TRY_ON_REQUEST_INVOKE_ID} and {@link TRY_ON_RESULT_INVOKE_ID} so UIs can
 * locate the invoked child actor and `send` to it (e.g. `DISMISS`).
 */
const TRY_ON_REQUEST_INVOKE_ID = "tryOnRequest";

const TRY_ON_RESULT_INVOKE_ID = "tryOnResult";

/**
 * Append a try-on outcome (completed or failed) to the active product's history. Used
 * by both `onDone` branches in `requesting` so the size selector and carousel see a
 * single source of truth. Cursor only advances on completed outcomes — failed entries
 * exist in history for marking but are skipped by the carousel.
 */
function appendHistoryEntryFromEvent({
  context,
  event,
}: {
  context: ProductPipelineCtx;
  event: unknown;
}): ProductPipelineCtx["tryOnHistoryByProduct"] {
  const result = (event as { output: { result: TryOnResult } }).output.result;
  const prev = context.tryOnHistoryByProduct[context.product.id] ?? {
    entries: [],
    cursor: -1,
  };
  // Snapshot the active body revision so the carousel can label this entry as
  // historical if the user later recalibrates to a different height. Omitted
  // (not 0) when there are no revisions yet — keeps "never label pre-cal
  // entries" uniform across flows that don't track revisions (productFlow).
  const revisions = context.bodyRevisions ?? [];
  const revisionSnapshot: Pick<TryOnHistoryEntry, "bodyRevisionIndex"> =
    revisions.length === 0 ? {} : { bodyRevisionIndex: revisions.length - 1 };
  const newEntry =
    result.status === "success"
      ? {
          imageUrl: result.imageUrl,
          tryOnId: result.tryOnId,
          scene: result.scene,
          ...(result.fitAnchors === undefined ? {} : { fitAnchors: result.fitAnchors }),
          ...(result.provenance === undefined ? {} : { provenance: result.provenance }),
          attributes: { ...context.selection },
          status: "completed" as const,
          ...revisionSnapshot,
        }
      : {
          imageUrl: "",
          attributes: { ...context.selection },
          status: "failed" as const,
          failureReason: result.reason.kind,
          recommendedSize: result.reason.recommendedSize,
          ...revisionSnapshot,
        };
  const entries = [...prev.entries, newEntry];
  const cursor = result.status === "success" ? entries.length - 1 : prev.cursor;
  return {
    ...context.tryOnHistoryByProduct,
    [context.product.id]: { entries, cursor },
  };
}

/**
 * Spawned child that renders the other styles of the picked size + colour while the
 * primary request runs. Spawned (not invoked) so it outlives the `requesting` state: the
 * primary usually finishes first and the view must not cancel the companions on its way
 * to `resulting`. Its done event is handled at the region root.
 */
const TRY_ON_COMPANIONS_SPAWN_ID = "tryOnCompanions";

const TRY_ON_COMPANIONS_DONE_EVENT = `xstate.done.actor.${TRY_ON_COMPANIONS_SPAWN_ID}`;

/**
 * Fold companion outcomes into the active product's history WITHOUT moving the cursor:
 * the shopper is looking at the style they asked for; the others wait one flip away.
 * Outcomes for a product the shopper has since left are dropped, and a companion that
 * is already in history for this body revision is not duplicated (a re-request of the
 * primary re-spawns the companions).
 */
function appendCompanionEntries({
  context,
  event,
}: {
  context: ProductPipelineCtx;
  event: unknown;
}): ProductPipelineCtx["tryOnHistoryByProduct"] {
  const output = (event as { output: { productId: string; outcomes: CompanionTryOnOutcome[] } })
    .output;
  if (output.productId !== context.product.id) {
    return context.tryOnHistoryByProduct;
  }
  const prev = context.tryOnHistoryByProduct[context.product.id] ?? { entries: [], cursor: -1 };
  const revisions = context.bodyRevisions ?? [];
  const revisionSnapshot: Pick<TryOnHistoryEntry, "bodyRevisionIndex"> =
    revisions.length === 0 ? {} : { bodyRevisionIndex: revisions.length - 1 };
  const entries = [...prev.entries];
  for (const { attributes, result } of output.outcomes) {
    const duplicate = entries.some(
      (e) =>
        e.status === "completed" &&
        e.bodyRevisionIndex === revisionSnapshot.bodyRevisionIndex &&
        attributesEqual(e.attributes, attributes),
    );
    if (duplicate) {
      continue;
    }
    entries.push(
      result.status === "success"
        ? {
            imageUrl: result.imageUrl,
            tryOnId: result.tryOnId,
            scene: result.scene,
            ...(result.fitAnchors === undefined ? {} : { fitAnchors: result.fitAnchors }),
            ...(result.provenance === undefined ? {} : { provenance: result.provenance }),
            attributes: { ...attributes },
            status: "completed" as const,
            ...revisionSnapshot,
          }
        : {
            imageUrl: "",
            attributes: { ...attributes },
            status: "failed" as const,
            failureReason: result.reason.kind,
            recommendedSize: result.reason.recommendedSize,
            ...revisionSnapshot,
          },
    );
  }
  return {
    ...context.tryOnHistoryByProduct,
    [context.product.id]: { entries, cursor: prev.cursor },
  };
}

/**
 * Start the companion renders for the current selection; a no-op for single-style
 * products. A still-running spawn from an earlier click is stopped first so the id
 * stays unique and its late outcomes cannot land twice.
 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- enqueueActions cast to any below (untyped region)
const spawnCompanionRenders = enqueueActions(({ context, enqueue }) => {
  const ctx = context as ProductPipelineCtx;
  const selections = companionStyleSelections(ctx.product, ctx.selection).flatMap((attributes) => {
    const variant = findVariantByAttributes(ctx.product, attributes);
    return variant === undefined ? [] : [{ attributes, variantId: variant.id }];
  });
  if (selections.length === 0) {
    return;
  }
  enqueue.stopChild(TRY_ON_COMPANIONS_SPAWN_ID);
  enqueue.spawnChild("tryOnCompanions", {
    id: TRY_ON_COMPANIONS_SPAWN_ID,
    input: {
      client: ctx.client,
      session: ctx.session!,
      bodyId: ctx.bodyId!,
      productId: ctx.product.id,
      selections,
    },
  });
  // oxlint-disable-next-line typescript-eslint/no-explicit-any -- XState v5 enqueueActions inference inside the untyped region
}) as any;

// oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- XState v5 try-on pipeline region (`as any` below)
export const tryOnPipelineRegion = {
  on: {
    [TRY_ON_COMPANIONS_DONE_EVENT]: {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- assign return cast to any below
      actions: assign({
        tryOnHistoryByProduct: appendCompanionEntries,
        // oxlint-disable-next-line typescript-eslint/no-explicit-any -- XState v5 assign inference
      }) as any,
    },
  },
  initial: "idle",
  states: {
    idle: {
      on: {
        START_TRY_ON: [
          // The gate refuses this size and we already know it, so REFUSE it here — no request,
          // and nothing rendered. The old path sent it anyway and let the server say no, which
          // cost a full round-trip to reach a verdict the client already held: the shopper
          // watched a busy hero ("we're fetching the tape measure") and then got an error, for
          // a size that was never going to render. Staying put and recording the verdict lets
          // the size picker show "{size} is too small — we recommend {X}" immediately.
          //
          // Deliberately NOT a swap to the recommendation: rendering a size the shopper did
          // not ask for is its own surprise, and with the fit UI off there is nothing on
          // screen to explain why the picture stopped matching the picker.
          //
          // This is also the only defence that covers the auto-start path: a host that
          // preselects a gated size (`autoStartOnPreselectedVariant`) never passes through the
          // picker, so no amount of disabling a CTA there could have stopped it — which is
          // exactly how a gated size still got rendered.
          //
          // `gatePrePivotSize` is undefined when the recommendation has not landed or when
          // every size is gated; both still go to the server, which stays the backstop.
          {
            guard: ({ context }: { context: ProductPipelineCtx }) =>
              gatePrePivotSize(context.recommendation, context.selection) !== undefined,
            // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- assign cast below
            actions: assign({
              lastTryOnFailure: ({
                context,
              }: {
                context: ProductPipelineCtx;
              }): TryOnFailure | undefined => {
                const gated = gatePrePivotSize(context.recommendation, context.selection);
                const requested = context.selection["size"];
                if (gated === undefined || requested === undefined) {
                  return context.lastTryOnFailure;
                }
                return {
                  reason:
                    gated.gate === "too_small"
                      ? ("garment_too_small" as const)
                      : ("garment_too_large" as const),
                  requestedSize: requested,
                  recommendedSize: gated.size,
                };
              },
              // oxlint-disable-next-line typescript-eslint/no-explicit-any -- XState v5 assign inference
            }) as any,
          },
          // Everything below is the ordinary path for a size the gate has no objection to.
          //
          // A calibrate request is in flight (`calibrationInFlight`, set on
          // `CALIBRATION_SUBMITTED`) — queue the click as `awaitingCalibration`
          // so the UI can render it identically to `requesting` while we wait
          // for the recalibrated body to land. We intentionally do not key off
          // `work: "running"` alone: product-screen re-enters can snap that
          // region back to `running` even though calibration already finished.
          // In `productFlow` (no `postCapture` state), the partial-value
          // `stateIn` returns false and we fall through to `requesting` below.
          {
            guard: and([
              ({ context }: { context: ProductPipelineCtx }) =>
                findVariantByAttributes(context.product, context.selection) !== undefined,
              stateIn({ postCapture: { work: "running" } }),
              ({ context }: { context: ProductPipelineCtx }) => isCalibrationInFlight(context),
            ]),
            target: "awaitingCalibration",
            actions: emit(({ context }: { context: ProductPipelineCtx }) => ({
              type: "try-on-initiated" as const,
              "product-id": context.product.id,
              variants: { ...context.selection },
            })),
          },
          // Cached-success replay: the user already has a completed try-on for this
          // exact selection, still valid for the active body. Skip the round-trip and
          // re-open its result screen — reconstruct `pendingTryOn` from the entry and
          // move the carousel cursor onto it, then route to `resulting` exactly as the
          // live success branch does. Ordered before the failure cache below so an exact
          // match wins over the coarser size-only failure match (which would otherwise
          // auto-jump away from a size that actually worked). Emits `try-on-initiated`
          // for analytics parity — from the user's view this was a try-on click.
          {
            guard: ({ context }: { context: ProductPipelineCtx }) =>
              findReplayableSuccessEntry(context) !== undefined,
            target: "resulting",
            actions: [
              emit(({ context }: { context: ProductPipelineCtx }) => ({
                type: "try-on-initiated" as const,
                "product-id": context.product.id,
                variants: { ...context.selection },
              })),
              // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- assign return cast to any below
              assign({
                pendingTryOn: ({
                  context,
                }: {
                  context: ProductPipelineCtx;
                }): { result: TryOnResult } | undefined => {
                  const entry = findReplayableSuccessEntry(context);
                  return entry === undefined ? undefined : pendingTryOnFromEntry(entry);
                },
                tryOnHistoryByProduct: ({
                  context,
                }: {
                  context: ProductPipelineCtx;
                }): ProductPipelineCtx["tryOnHistoryByProduct"] => {
                  const entry = findReplayableSuccessEntry(context);
                  return entry === undefined
                    ? context.tryOnHistoryByProduct
                    : historyWithCursorAtEntry(context, entry);
                },
                // oxlint-disable-next-line typescript-eslint/no-explicit-any -- XState v5 assign inference
              }) as any,
            ],
          },
          // NB there is deliberately NO cached-failure replay here anymore: a size the gate
          // already rejected is marked in the recommendation preview, so a repeat click takes
          // the pre-pivot branch above without any cache. A gate failure the preview does NOT
          // know about (a chartless product) re-requests — the server stays the source of
          // truth rather than a session-local failure cache.
          {
            guard: ({ context }: { context: ProductPipelineCtx }) =>
              findVariantByAttributes(context.product, context.selection) !== undefined,
            target: "requesting",
            actions: emit(({ context }: { context: ProductPipelineCtx }) => ({
              type: "try-on-initiated" as const,
              "product-id": context.product.id,
              variants: { ...context.selection },
            })),
          },
        ],
      },
    },
    awaitingCalibration: {
      on: {
        // Calibration finished — fire the queued try-on now.
        CALIBRATION_DONE: { target: "requesting" },
        // Calibration failed; the user is bounced back to the height screen.
        // Drop the queued click rather than auto-firing on retry-success.
        CALIBRATION_FAILED: { target: "idle" },
      },
    },
    requesting: {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- enqueueActions cast above
      entry: spawnCompanionRenders,
      invoke: {
        id: TRY_ON_REQUEST_INVOKE_ID,
        src: "tryOnRequest" as const,
        input: ({ context }: { context: ProductPipelineCtx }) => {
          const variant = findVariantByAttributes(context.product, context.selection);
          if (variant === undefined) {
            throw new Error("tryOnPipeline: invoke entered without a resolvable variant");
          }
          return {
            client: context.client,
            session: context.session!,
            bodyId: context.bodyId!,
            productId: context.product.id,
            variantId: variant.id,
          };
        },
        onDone: [
          // Failure outcome (e.g. garment_too_small): no auto-pivot. Keep the shopper's picked
          // size selected and park the failure context so the size-selector battery can render
          // the "{size} won't fit — we recommend {X}" note. The shopper decides whether to
          // switch; we never silently re-render a different size than the one they chose.
          {
            guard: ({ event }: { event: unknown }) =>
              (event as { output: { result: TryOnResult } }).output.result.status !== "success",
            target: "idle",
            // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- assign return cast to any below
            actions: assign({
              tryOnHistoryByProduct: appendHistoryEntryFromEvent,
              // A gated pick is an explicit shopper choice, not a placeholder default — a later
              // recommendation fetch must not re-seed over it.
              sizeIsDefaultSelection: false,
              lastTryOnFailure: ({
                context,
                event,
              }: {
                context: ProductPipelineCtx;
                event: unknown;
              }): TryOnFailure | undefined => {
                const result = (event as { output: { result: TryOnResult } }).output.result;
                if (result.status === "success") {
                  return undefined;
                }
                return {
                  reason: result.reason.kind,
                  requestedSize: context.selection["size"] ?? "",
                  recommendedSize: result.reason.recommendedSize,
                };
              },
              // Selection stays on the shopper's picked size — no auto-jump.
              // oxlint-disable-next-line typescript-eslint/no-explicit-any -- XState v5 assign inference
            }) as any,
          },
          // Success outcome: route to the result screen for carousel viewing.
          {
            target: "resulting",
            // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- assign return cast to any below
            actions: assign({
              pendingTryOn: ({ event }: { event: unknown }) =>
                (event as { output: { result: TryOnResult } }).output,
              tryOnHistoryByProduct: appendHistoryEntryFromEvent,
              // oxlint-disable-next-line typescript-eslint/no-explicit-any -- XState v5 assign inference
            }) as any,
          },
        ],
        onError: [
          {
            // Terminal session expiry: escalate to the root reset instead of
            // the retryable try-on error screen.
            guard: ({ event }: { event: unknown }) =>
              isSessionExpiredError((event as { error: unknown }).error),
            target: "idle",
            actions: [assign({ pendingTryOn: undefined }), raise({ type: "SESSION_EXPIRED" })],
          },
          {
            target: "error",
            actions: assign({ pendingTryOn: undefined }),
          },
        ],
      },
    },
    error: {
      on: {
        DISMISS: { target: "idle" },
        // Clear the error immediately when the user changes their selection.
        SELECT_VARIANT: { target: "idle" },
        START_TRY_ON: {
          guard: ({ context }: { context: ProductPipelineCtx }) =>
            findVariantByAttributes(context.product, context.selection) !== undefined,
          target: "requesting",
        },
      },
    },
    resulting: {
      on: {
        START_TRY_ON: [
          // The picked variant is already rendered for this body (typically the other style,
          // which the companion render produced while the shopper looked at the first one):
          // swap the result screen onto that entry with no request. Re-entering re-invokes
          // the result child with the cached payload, exactly like the `idle` replay branch.
          {
            guard: ({ context }: { context: ProductPipelineCtx }) =>
              findReplayableSuccessEntry(context) !== undefined,
            target: "resulting",
            reenter: true,
            // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- assign return cast to any below
            actions: assign({
              pendingTryOn: ({
                context,
              }: {
                context: ProductPipelineCtx;
              }): { result: TryOnResult } | undefined => {
                const entry = findReplayableSuccessEntry(context);
                return entry === undefined ? undefined : pendingTryOnFromEntry(entry);
              },
              tryOnHistoryByProduct: ({
                context,
              }: {
                context: ProductPipelineCtx;
              }): ProductPipelineCtx["tryOnHistoryByProduct"] => {
                const entry = findReplayableSuccessEntry(context);
                return entry === undefined
                  ? context.tryOnHistoryByProduct
                  : historyWithCursorAtEntry(context, entry);
              },
              // oxlint-disable-next-line typescript-eslint/no-explicit-any -- XState v5 assign inference
            }) as any,
          },
          // Re-render in place for a newly picked size (StudioVaaiDefaultFlow's size strip dispatches
          // SELECT_VARIANT then START_TRY_ON). Handled directly here — no dependency on the result
          // child's internal state — so it's reliable even on the very first result. Drops the shown
          // result and re-requests with the updated selection.
          {
            guard: ({ context }: { context: ProductPipelineCtx }) =>
              findVariantByAttributes(context.product, context.selection) !== undefined,
            target: "requesting",
            actions: assign({ pendingTryOn: undefined }),
          },
        ],
      },
      invoke: {
        id: TRY_ON_RESULT_INVOKE_ID,
        src: "tryOnResult" as const,
        input: ({ context }: { context: ProductPipelineCtx }) => {
          const pending = context.pendingTryOn;
          if (!pending) {
            throw new Error("tryOnPipeline: missing pendingTryOn");
          }
          const r = pending.result;
          return {
            client: context.client,
            session: context.session!,
            tryOnId: r.status === "success" ? r.tryOnId : undefined,
            initialResult: r,
          };
        },
        onDone: [
          {
            guard: ({ event }: { event: unknown }) => invokeOutputDismissed(event),
            target: "idle",
            actions: assign({ pendingTryOn: undefined }),
          },
          {
            guard: ({ event }: { event: unknown }) => invokeOutputRetryRequest(event),
            target: "requesting",
            actions: assign({ pendingTryOn: undefined }),
          },
        ],
        onError: {
          target: "idle",
          actions: assign({ pendingTryOn: undefined }),
        },
      },
    },
  },
  // oxlint-disable-next-line typescript-eslint/no-explicit-any -- XState v5 invoke + parallel region typing
} as any;
