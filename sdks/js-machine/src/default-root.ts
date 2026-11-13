import type { SessionHandle } from "@studio-vaai/js-client";

import { assign, emit, enqueueActions, raise, setup, stateIn } from "xstate";

import type { AnalyticsSignal } from "./analytics-signal.js";
import type { DefaultRootContext, DefaultRootInput } from "./context/index.js";
import type { ProductFlowEvent, RootNavigationEvent } from "./context/index.js";

import {
  getRecommendedSizeActor,
  isSessionExpiredError,
  restoreSessionActor,
  tryOnCompanionsActor,
} from "./actors.js";
import { findVariantByAttributes } from "./context/shared.js";
import { bodyHeightCalibrationMachine } from "./machines/body-height-calibration.js";
import { photoCaptureMachine, type PhotoCaptureOutput } from "./machines/photo-capture.js";
import {
  photoUploadMachine,
  type PhotoUploadOutput,
  type PhotoUploadSnapshot,
} from "./machines/photo-upload.js";
import {
  productOverviewParallelStates,
  selectionAfterHostPush,
} from "./machines/product-overview-parallel.js";
import { sessionIntroMachine } from "./machines/session-intro.js";
import { tryOnPipelineRegion } from "./machines/try-on-pipeline-region.js";
import { tryOnRequestMachine } from "./machines/try-on-request.js";
import { tryOnResultMachine } from "./machines/try-on-result.js";
import { createNoopSessionPersistence } from "./session-persistence.js";
import { sessionDeadline, sessionRetentionActor } from "./session-retention.js";

function tryOnHistoryBack(
  context: DefaultRootContext,
): DefaultRootContext["tryOnHistoryByProduct"] {
  const cur = context.tryOnHistoryByProduct[context.product.id];
  if (cur === undefined || cur.cursor < 0) {
    return context.tryOnHistoryByProduct;
  }
  return {
    ...context.tryOnHistoryByProduct,
    [context.product.id]: { ...cur, cursor: cur.cursor - 1 },
  };
}

export type DefaultRootEvent = RootNavigationEvent | ProductFlowEvent;

export const defaultRootMachine = setup({
  types: {
    context: {} as DefaultRootContext,
    events: {} as DefaultRootEvent,
    input: {} as DefaultRootInput,
    emitted: {} as AnalyticsSignal,
  },
  actors: {
    sessionRetention: sessionRetentionActor,
    restoreSession: restoreSessionActor,
    sessionIntro: sessionIntroMachine,
    photoCapture: photoCaptureMachine,
    photoUpload: photoUploadMachine,
    bodyHeight: bodyHeightCalibrationMachine,
    getRecommendedSize: getRecommendedSizeActor,
    tryOnRequest: tryOnRequestMachine,
    tryOnCompanions: tryOnCompanionsActor,
    tryOnResult: tryOnResultMachine,
  },
  guards: {
    onTryOnResultScreen: stateIn({
      postCapture: { screen: { product: { active: { tryOnPipeline: "resulting" } } } },
    }),
  },
  actions: {
    emitIntroOpened: emit(({ context }) => ({
      type: "intro-opened" as const,
      "product-id": context.product.id,
    })),
  },
}).createMachine({
  id: "defaultRoot",
  invoke: {
    id: "sessionRetention",
    src: "sessionRetention",
    input: ({ self }) => ({ root: self }),
  },
  initial: "sessionIntro",
  context: ({ input }) => ({
    client: input.client,
    sessionPersistence: input.sessionPersistence ?? createNoopSessionPersistence(),
    session: undefined,
    sessionExpiresAt: undefined,
    consentGivenOrRestored: false,
    bodyId: undefined,
    bodyPredictedHeightCm: undefined,
    bodyHeightCm: undefined,
    bodyRevisions: [],
    calibrationInFlight: false,
    product: input.product,
    selection: input.selection ?? {},
    pendingAutoStartTryOn: input.autoStartOnPreselectedVariant ?? false,
    sizeIsDefaultSelection: input.selectedSizeIsDefault ?? false,
    autoStartOnRecommendedSize: input.autoStartOnRecommendedSize ?? false,
    recommendation: undefined,
    recommendationError: undefined,
    pendingTryOn: undefined,
    lastTryOnFailure: undefined,
    tryOnHistoryByProduct: {},
    lastPhotoRejection: undefined,
    lastCalibrationError: undefined,
  }),
  on: {
    // The host pushing its own latest selection has to land in ANY state, not just on the product
    // screen where the fuller handler lives. The actor outlives the sheet — it is keyed by product
    // so try-on history survives closing — so after a render it is parked on the try-on screen,
    // which is exactly where it sits while the shopper is back on the page changing the size.
    // Handling this only on the product screen dropped those pushes, and re-opening the sheet
    // resumed the last render's size while silently ignoring the size the shop was showing.
    //
    // Both branches assign without transitioning: they cannot disturb an in-flight try-on or move
    // the shopper off the screen they are on. On the product screen they never run: `postCapture`
    // is parallel, and XState falls back to an ancestor's handler only when no region handled the
    // event, so the product screen's own handler takes it (a DIFFERENT product re-enters the
    // screen's regions there to reset them).
    PRODUCT_CHANGED: [
      {
        guard: ({ context, event }) => event.product.id === context.product.id,
        actions: assign({
          selection: ({ context, event }) => selectionAfterHostPush(context, event),
          product: ({ event }) => event.product,
          // A host-side push means the shopper picked a variant on the page, so the size is no
          // longer a default the recommendation may override — unless the host says it still is.
          sizeIsDefaultSelection: ({ event }) => event.selectedSizeIsDefault ?? false,
        }),
      },
      // A different product anywhere else: a host that keeps one actor across its product pages
      // (so the shopper's photo and body carry over) switches pages while the shopper is still
      // before the photo, or on the height screen. Dropping it left the flow on the previous
      // page's garment, and the product screen then offered to try that one on. The same fields
      // as the product-screen reset go; the body stays, which is the point of keeping the actor.
      {
        actions: assign({
          product: ({ event }) => event.product,
          selection: ({ event }) => event.selection,
          // The new page's own say, when it gives one: a pick on the last page is not one here.
          sizeIsDefaultSelection: ({ context, event }) =>
            event.selectedSizeIsDefault ?? context.sizeIsDefaultSelection,
          recommendation: undefined,
          recommendationError: undefined,
          pendingTryOn: undefined,
          lastTryOnFailure: undefined,
        }),
      },
    ],
    // Terminal server-side session end (60-min inactivity expiry or
    // retention-sweep deletion). Everything derived from the session — photo,
    // body, try-on history, recommendation — is gone on the server, so drop it
    // all client-side too, clear the persisted handle (a restore would only
    // re-discover the expiry), and restart at the intro for fresh consent
    // (consent is per-session). Raised internally from API error paths via
    // `isSessionExpiredError`; hosts may also dispatch it.
    SESSION_EXPIRED: {
      target: ".sessionIntro",
      reenter: true,
      actions: [
        ({ context }) => {
          context.sessionPersistence.clear();
        },
        assign({
          session: undefined,
          sessionExpiresAt: undefined,
          consentGivenOrRestored: false,
          pendingSelectedImage: undefined,
          lastCapturedImage: undefined,
          bodyId: undefined,
          bodyPredictedHeightCm: undefined,
          bodyHeightCm: undefined,
          bodyRevisions: [],
          calibrationInFlight: false,
          tryOnHistoryByProduct: {},
          recommendation: undefined,
          recommendationError: undefined,
          pendingTryOn: undefined,
          lastTryOnFailure: undefined,
          useAnotherImageSource: undefined,
          photoSource: undefined,
          lastPhotoRejection: undefined,
          lastCalibrationError: undefined,
          variantSelectionVia: undefined,
          imageFlowSource: undefined,
        }),
        "emitIntroOpened",
      ],
    },
    BACK_TO_HEIGHT: {
      // Just swap the screen region; the work region (and its long-lived
      // bodyHeight child) is preserved so an in-flight calibration keeps
      // running and a previously-done calibration stays "done".
      target: ".postCapture.screen.heightCalibration",
    },
    // Root-level so hosts can route back to the camera flow from anywhere —
    // e.g. the height-calibration back / retry buttons when `photoSource ===
    // "camera"`. From `sessionIntro.awaitingImage` the assigned fields are
    // already undefined, so the cleanup is a no-op there.
    OPEN_CAMERA: {
      target: ".photoCapture",
      reenter: true,
      actions: [
        emit(({ context, event }) => ({
          type: "image-record-initiated" as const,
          "product-id": context.product.id,
          source: event.source,
        })),
        assign({
          imageFlowSource: ({ event }) => event.source,
          recommendation: undefined,
          recommendationError: undefined,
          pendingTryOn: undefined,
          lastTryOnFailure: undefined,
          pendingSelectedImage: undefined,
          tryOnHistoryByProduct: {},
          bodyRevisions: [],
          calibrationInFlight: false,
        }),
      ],
    },
    INITIATE_IMAGE_UPLOAD: {
      actions: [
        emit(({ context, event }) => ({
          type: "image-upload-initiated" as const,
          "product-id": context.product.id,
          source: event.source,
        })),
        assign({ imageFlowSource: ({ event }) => event.source }),
      ],
    },
    CANCEL_UPLOAD: [
      {
        guard: stateIn("photoUpload"),
        target: ".sessionIntro.awaitingImage",
        actions: [
          emit(({ context, event }) => ({
            type: "image-upload-aborted" as const,
            "product-id": context.product.id,
            source: event.source ?? context.imageFlowSource ?? "intro",
          })),
          assign({ pendingSelectedImage: undefined, imageFlowSource: undefined }),
          "emitIntroOpened",
        ],
      },
      {
        actions: [
          emit(({ context, event }) => ({
            type: "image-upload-aborted" as const,
            "product-id": context.product.id,
            source: event.source ?? context.imageFlowSource ?? "intro",
          })),
          assign({ imageFlowSource: undefined }),
        ],
      },
    ],
    USE_ANOTHER_IMAGE: {
      target: ".photoUpload",
      reenter: true,
      actions: [
        assign({
          recommendation: undefined,
          recommendationError: undefined,
          pendingTryOn: undefined,
          lastTryOnFailure: undefined,
          pendingSelectedImage: undefined,
          tryOnHistoryByProduct: {},
          bodyRevisions: [],
          calibrationInFlight: false,
          lastCalibrationError: undefined,
          useAnotherImageSource: ({ event }) => event.source,
          // "Use another image" opens the system file picker today, so the
          // upstream source is the gallery. (If a future entry point routes
          // through the camera, it'll set this back to "camera" explicitly.)
          photoSource: "gallery" as const,
        }),
      ],
    },
    CANCEL_USE_ANOTHER_IMAGE: [
      {
        guard: ({ context }) => context.useAnotherImageSource === "bodyHeightCalibration",
        // Re-enter postCapture from scratch: work region invokes a fresh
        // bodyHeight child in `editing`, screen lands on `heightCalibration`.
        // The user lands back on the height screen with the same
        // predicted/last height pre-filled.
        target: [".postCapture.work.running", ".postCapture.screen.heightCalibration"],
        actions: assign({ useAnotherImageSource: undefined }),
      },
      {
        guard: ({ context }) => context.useAnotherImageSource === "product",
        // The user already finished calibration before tapping "use another
        // image"; cancelling restores them to the product screen WITHOUT a
        // redundant calibrate round-trip. Targeting `work.done` directly
        // skips invoking the actor, while re-invoking the bodyHeight child
        // (kept alive at the work-region level) so future edits work.
        target: [".postCapture.work.done", ".postCapture.screen.product"],
        actions: assign({ useAnotherImageSource: undefined }),
      },
      {
        target: ".sessionIntro.awaitingImage",
        actions: [
          assign({
            useAnotherImageSource: undefined,
            pendingSelectedImage: undefined,
          }),
          "emitIntroOpened",
        ],
      },
    ],
    RESET_PRODUCT: {
      target: ".postCapture.screen.product",
      reenter: true,
      actions: assign({
        recommendation: undefined,
        recommendationError: undefined,
        pendingTryOn: undefined,
        lastTryOnFailure: undefined,
        selection: {},
      }),
    },
    RETURN_TO_SESSION_INTRO_FOR_GUIDE: {
      target: ".sessionIntro.awaitingImage",
      guard: ({ context }) => context.session !== undefined,
      actions: [
        assign({
          pendingSelectedImage: undefined,
        }),
        "emitIntroOpened",
      ],
    },
    RETURN_TO_VARIANT_SELECTION: {
      guard: "onTryOnResultScreen",
      target: ".postCapture.screen.product",
      reenter: true,
      actions: assign({
        variantSelectionVia: ({ event }) => event.via,
        pendingTryOn: undefined,
        tryOnHistoryByProduct: ({ context, event }) =>
          event.via === "back" ? tryOnHistoryBack(context) : context.tryOnHistoryByProduct,
      }),
    },
    ATTACH_PREVIEW_BLOB: {
      actions: assign({
        pendingSelectedImage: ({ context, event }) => {
          const image = context.pendingSelectedImage;
          if (image === undefined) {
            return;
          }
          if (image.type === "blob") {
            return image.blob === event.previewFor
              ? { ...image, previewBlob: event.previewBlob }
              : image;
          }
          return image.file === event.previewFor
            ? { ...image, previewBlob: event.previewBlob }
            : image;
        },
        lastCapturedImage: ({ context, event }) => {
          const image = context.lastCapturedImage;
          if (image === undefined) {
            return;
          }
          if (image.type === "blob") {
            return image.blob === event.previewFor
              ? { ...image, previewBlob: event.previewBlob }
              : image;
          }
          return image.file === event.previewFor
            ? { ...image, previewBlob: event.previewBlob }
            : image;
        },
      }),
    },
  },
  states: {
    sessionIntro: {
      // `intro-opened` is emitted when the user actually sees this screen:
      // via host `trackHostEvent` on entrypoint open (source: `entry`), or on
      // machine transitions back here (`emitIntroOpened` on the root handlers).
      initial: "restoringSession",
      states: {
        restoringSession: {
          invoke: {
            src: "restoreSession",
            input: ({ context }) => ({
              client: context.client,
              persistence: context.sessionPersistence,
            }),
            onDone: [
              {
                guard: ({ event }) => (event.output as { kind: string }).kind === "restored",
                target: "awaitingImage",
                actions: assign({
                  session: ({ event }) =>
                    (event.output as { kind: "restored"; session: SessionHandle }).session,
                  sessionExpiresAt: ({ event }) =>
                    (event.output as { expiresAt?: string }).expiresAt,
                  consentGivenOrRestored: true,
                }),
              },
              { target: "creatingSession" },
            ],
          },
        },
        creatingSession: {
          invoke: {
            src: "sessionIntro",
            input: ({ context }) => ({ client: context.client }),
            onDone: {
              target: "awaitingImage",
              actions: [
                assign({
                  session: ({ event }) => (event.output as { session: SessionHandle }).session,
                  sessionExpiresAt: ({ event }) =>
                    (event.output as { expiresAt?: string }).expiresAt,
                }),
                ({ context, event }) => {
                  const session = (event.output as { session: SessionHandle }).session;
                  context.sessionPersistence.write(
                    session,
                    sessionDeadline(context.sessionExpiresAt),
                  );
                },
                // Successful session creation = user implicitly granted consent
                // (the sessionIntro child only resolves once the consent UI is
                // confirmed; a refused consent never reaches `onDone`).
                emit(({ context }) => ({
                  type: "consent-granted" as const,
                  "product-id": context.product.id,
                })),
              ],
            },
          },
        },
        awaitingImage: {
          on: {
            IMAGE_SELECTED: {
              target: "#defaultRoot.photoUpload",
              actions: assign({
                pendingSelectedImage: ({ event }) => event.image,
                photoSource: "gallery" as const,
              }),
            },
            // OPEN_CAMERA is handled at the root level so the same dispatch
            // works from postCapture screens (back / retry on height) too.
          },
        },
      },
    },
    // Browser-camera flow. Sibling to `photoUpload`; both converge on the same
    // upload path via `pendingSelectedImage` so the rest of the root tree
    // (rejection handling, `useAnotherImage`, …) needs no further changes.
    photoCapture: {
      invoke: {
        src: "photoCapture",
        input: ({ context }) => ({
          client: context.client,
          session: context.session!,
        }),
        onDone: {
          target: "photoUpload",
          actions: assign({
            pendingSelectedImage: ({ event }) => (event.output as PhotoCaptureOutput).image,
            photoSource: "camera" as const,
          }),
        },
      },
      on: {
        CANCEL_CAMERA: {
          target: "sessionIntro.awaitingImage",
          actions: [
            emit(({ context }) => ({
              type: "image-record-aborted" as const,
              "product-id": context.product.id,
              source: context.imageFlowSource ?? "intro",
            })),
            assign({ imageFlowSource: undefined }),
            "emitIntroOpened",
          ],
        },
      },
    },
    photoUpload: {
      invoke: {
        src: "photoUpload",
        input: ({ context }) => ({
          client: context.client,
          session: context.session!,
          initialImage: context.pendingSelectedImage,
        }),
        onSnapshot: [
          {
            // The child swallows transport errors into `uploadFailed`; a
            // terminal session expiry must instead reset the whole flow.
            guard: ({ event }) => {
              const snap = event.snapshot as PhotoUploadSnapshot;
              return snap.value === "uploadFailed" && isSessionExpiredError(snap.context.lastError);
            },
            actions: raise({ type: "SESSION_EXPIRED" }),
          },
          {
            guard: ({ event }) => {
              const snap = event.snapshot as PhotoUploadSnapshot;
              return (
                snap.value === "rejected" &&
                snap.context.image !== undefined &&
                snap.context.lastError !== undefined
              );
            },
            actions: assign({
              lastPhotoRejection: ({ event }) => {
                const snap = event.snapshot as PhotoUploadSnapshot;
                return {
                  image: snap.context.image!,
                  error: snap.context.lastError!,
                };
              },
            }),
          },
        ],
        onDone: {
          target: "postCapture",
          actions: [
            assign({
              bodyId: ({ event }) => (event.output as PhotoUploadOutput).bodyId,
              bodyPredictedHeightCm: ({ event }) => (event.output as PhotoUploadOutput).heightCm,
              lastCapturedImage: ({ event }) => (event.output as PhotoUploadOutput).image,
              pendingSelectedImage: undefined,
              consentGivenOrRestored: true,
              useAnotherImageSource: undefined,
              lastPhotoRejection: undefined,
              imageFlowSource: undefined,
            }),
            // Upload settled — emit with the originating capture path so the
            // bridge can map to the event spec's `image-source` literal.
            // Defaults to "gallery" if photoSource was somehow never set.
            emit(({ context }) => ({
              type: "image-uploaded" as const,
              "product-id": context.product.id,
              "photo-source": context.photoSource ?? "gallery",
            })),
          ],
        },
      },
    },
    // Two parallel regions: `work` runs the calibration child machine in the
    // background while `screen` routes the visible UI between height and
    // product. The child sends CALIBRATION_SUBMITTED / DONE / FAILED events
    // (handled inside each region) to coordinate the swap and unblock try-on.
    // See `bodyHeightCalibrationMachine` for the child contract.
    //
    // Cross-region events live at region level (not at the parallel parent),
    // so each region's transition LCCA stays inside that region. Hoisting a
    // CALIBRATION_DONE handler to `postCapture` would put the LCCA at the
    // parallel itself, re-entering all sibling regions and snapping `screen`
    // back to its initial `heightCalibration` on every successful calibrate.
    postCapture: {
      type: "parallel",
      states: {
        work: {
          // The bodyHeight child invocation lives at the region level so it
          // outlives screen-region transitions (BACK_TO_HEIGHT swaps screen
          // without restarting the calibration child).
          // The bodyHeight child's only top-level final is `retryCapture`
          // (USE_ANOTHER_IMAGE), which the root-level handler above
          // intercepts before the event reaches the child. So no `onDone`
          // is needed here — calibrated completion comes through the
          // CALIBRATION_DONE parent event instead.
          invoke: {
            src: "bodyHeight",
            id: "bodyHeight",
            input: ({ context }) => {
              const initialHeightCm = context.bodyHeightCm ?? context.bodyPredictedHeightCm;
              if (initialHeightCm === undefined) {
                throw new Error("defaultRoot: missing initial height for body height calibration");
              }
              return {
                client: context.client,
                session: context.session!,
                bodyId: context.bodyId!,
                initialHeightCm,
                // Forward the picked product so the server can speculatively
                // prewarm the body-for-product latent while the user is on
                // the product page waiting on calibration.
                productId: context.product.id,
              };
            },
          },
          initial: "running",
          on: {
            CALIBRATION_DONE: {
              // Single source of truth for the recalibrated body. The new bodyId
              // lands in root context (try-on requests pull it from there) and
              // this region transitions to `done` to unblock the queued try-on
              // (if any).
              target: ".done",
              actions: [
                assign({
                  bodyId: ({ event }) => event.bodyId,
                  bodyHeightCm: ({ event }) => event.heightCm,
                  calibrationInFlight: false,
                  lastCalibrationError: undefined,
                  // Append a body revision whenever the active body changes — a new
                  // image mints a new `bodyId` (calibrating an existing body keeps it,
                  // so a same-height re-confirm of the same body stays a no-op) or the
                  // confirmed height changes, plus the first calibration of the session.
                  // Gating on `bodyId` as well as height matters for cached-success
                  // replay: re-uploading a photo and confirming the same height still
                  // advances the revision index, so a prior result rendered against the
                  // old image is correctly invalidated instead of being replayed. Future
                  // fields (e.g. weight) can be added without touching this append rule.
                  bodyRevisions: ({ context, event }) => {
                    const last = context.bodyRevisions.at(-1);
                    if (
                      last !== undefined &&
                      last.bodyId === event.bodyId &&
                      last.bodyHeightCm === event.heightCm
                    ) {
                      return context.bodyRevisions;
                    }
                    return [
                      ...context.bodyRevisions,
                      { bodyId: event.bodyId, bodyHeightCm: event.heightCm },
                    ];
                  },
                }),
                // Calibration changes the body's measurements IN PLACE (same
                // bodyId), so a size recommendation fetched pre-calibration is
                // stale without any context field changing. Re-request it; the
                // recommendation region reloads when mounted (product screen),
                // and the raise is dropped harmlessly when it is not.
                raise({ type: "RECOMMENDATION_REQUEST" }),
              ],
            },
          },
          states: {
            // `running` covers the entire pre-completion lifecycle of the
            // child (editing / calibrating / failed). `tryOnPipelineRegion`
            // queues `START_TRY_ON` in `awaitingCalibration` only when
            // `calibrationInFlight` is true (see `CALIBRATION_SUBMITTED`).
            running: {},
            done: {
              on: {
                // User went BACK_TO_HEIGHT and re-confirmed a new height.
                // Drop back to `running` until the next CALIBRATION_DONE
                // arrives, gating any new try-on click in the meantime.
                CALIBRATION_SUBMITTED: {
                  target: "running",
                  actions: assign({ calibrationInFlight: true, lastCalibrationError: undefined }),
                },
              },
            },
          },
        },
        screen: {
          initial: "heightCalibration",
          // CALIBRATION_FAILED yanks the user back to the height screen from
          // wherever they are (typically `product` after backgrounding) and
          // records the error in `lastCalibrationError` so the height-screen
          // error UI can surface it even after the child resets to `editing`.
          on: {
            CALIBRATION_FAILED: [
              {
                // Session terminally gone — escalate to the root reset instead
                // of parking the user on the height screen with a dead session.
                guard: ({ event }) => isSessionExpiredError(event.error),
                actions: raise({ type: "SESSION_EXPIRED" }),
              },
              {
                target: ".heightCalibration",
                actions: assign({
                  calibrationInFlight: false,
                  // Capture the error at the root so it outlives the child's
                  // transient `failed` state (see `lastCalibrationError` docs).
                  lastCalibrationError: ({ event }) => event.error,
                }),
              },
            ],
          },
          states: {
            heightCalibration: {
              // Fires on every entry to the height-calibration screen:
              // initially via postCapture after photoUpload completes, plus on
              // every BACK_TO_HEIGHT navigation. Host enriches with `source`
              // from the snapshot delta — typically image-upload or
              // variant-selection per the event spec.
              entry: emit(({ context }) => ({
                type: "height-entered" as const,
                "product-id": context.product.id,
              })),
              on: {
                // First successful CONFIRM advances the screen to product
                // while the actual calibration request continues in the
                // background `work` region.
                CALIBRATION_SUBMITTED: {
                  target: "product",
                  actions: assign({ calibrationInFlight: true, lastCalibrationError: undefined }),
                },
              },
            },
            product: {
              // Fires on every entry to the product/variant-selection screen:
              // initial via CALIBRATION_SUBMITTED (source: height) and any
              // re-entry, e.g. via PRODUCT_CHANGED's reenter branch or
              // RETURN_TO_VARIANT_SELECTION (via: back | go-to-product-overview).
              // Host enriches with `source` from the snapshot delta.
              entry: [
                emit(({ context }) => ({
                  type: "variant-selection-initiated" as const,
                  "product-id": context.product.id,
                  ...(context.variantSelectionVia === undefined
                    ? {}
                    : { via: context.variantSelectionVia }),
                })),
                assign({ variantSelectionVia: undefined }),
                // One-shot auto-start: hosts that already know the pick (size
                // chosen in the shop) skip the picker. On the FIRST arrival here
                // we consume `pendingAutoStartTryOn` and, if the preselected
                // selection resolves to a variant, raise `START_TRY_ON`. The
                // raised event is handled by the `tryOnPipeline` child once the
                // product state's children have entered — it routes to
                // `awaitingCalibration` while the background calibration is still
                // in flight, exactly as a manual click would. Consuming the flag
                // regardless of resolution keeps this to the single intended
                // (height -> product) transition; manual returns to variant
                // selection then render the picker normally.
                enqueueActions(({ context, enqueue }) => {
                  if (!context.pendingAutoStartTryOn) {
                    return;
                  }
                  // The host marked the size as a mere DEFAULT — the shopper never picked it.
                  if (context.sizeIsDefaultSelection) {
                    // Fit-intelligence hosts opt into auto-rendering the recommendation: DEFER
                    // — the `recommendation` region's auto-fetch consumes the flag after
                    // seeding the recommended size (or on fetch error, falling back to the
                    // default), so the auto-started try-on renders the shopper's *recommended*
                    // size, not the host's placeholder.
                    if (
                      context.autoStartOnRecommendedSize &&
                      context.bodyId !== undefined &&
                      context.session !== undefined
                    ) {
                      return;
                    }
                    // Default behaviour: starting a render on a size nobody chose is wrong, so
                    // the one-shot is spent WITHOUT starting anything — the shopper lands on
                    // the size-selection screen, pre-seeded with the recommendation once it
                    // arrives, and decides for themself.
                    enqueue.assign({ pendingAutoStartTryOn: false });
                    return;
                  }
                  enqueue.assign({ pendingAutoStartTryOn: false });
                  if (findVariantByAttributes(context.product, context.selection) !== undefined) {
                    enqueue.raise({ type: "START_TRY_ON" });
                  }
                }),
              ],
              initial: "active",
              on: {
                // Two branches keyed on whether the product id actually changed:
                //   - same product: just update selection + product (in case e.g. variant list
                //     changed); don't re-enter, don't reset recommendation / pendingTryOn / history.
                //     Lets hosts use `PRODUCT_CHANGED` from external state as a "push my
                //     latest selection" event without footgunning the in-flight try-on.
                //   - different product: full reset + re-enter, original semantics.
                PRODUCT_CHANGED: [
                  {
                    guard: ({ context, event }) => event.product.id === context.product.id,
                    actions: assign({
                      selection: ({ context, event }) => selectionAfterHostPush(context, event),
                      product: ({ event }) => event.product,
                      // The external-selection hook only pushes on genuine host-side changes, so a
                      // same-product push means the shopper picked a variant on the host page —
                      // the size is no longer a default the recommendation may override, unless
                      // the host says it still is.
                      sizeIsDefaultSelection: ({ event }) => event.selectedSizeIsDefault ?? false,
                    }),
                  },
                  {
                    target: ".active",
                    reenter: true,
                    actions: assign({
                      product: ({ event }) => event.product,
                      selection: ({ event }) => event.selection,
                      // As at the root: the new page says whether its size is a default.
                      sizeIsDefaultSelection: ({ context, event }) =>
                        event.selectedSizeIsDefault ?? context.sizeIsDefaultSelection,
                      recommendation: undefined,
                      recommendationError: undefined,
                      pendingTryOn: undefined,
                      lastTryOnFailure: undefined,
                    }),
                  },
                ],
              },
              states: {
                active: {
                  type: "parallel",
                  // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- parallel regions from XState-asserted modules
                  states: {
                    ...productOverviewParallelStates,
                    // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment
                    tryOnPipeline: tryOnPipelineRegion,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

export type DefaultRootMachine = typeof defaultRootMachine;
