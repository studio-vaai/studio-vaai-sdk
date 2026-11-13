import type { RecommendedSizeData } from "@studio-vaai/js-client";
import type { DefaultRootMachine } from "@studio-vaai/js-machine";
import type { SnapshotFrom } from "xstate";

import { findVariantByAttributes } from "@studio-vaai/js-machine";

export type DefaultRootPhase =
  | "sessionIntro"
  | "photoCapture"
  | "photoUpload"
  | "bodyHeightCalibration"
  | "product";

export type DefaultRootVariantUiState = "selecting" | "selected";

export type DefaultRootRecommendationUiState =
  | "hidden"
  | "loading"
  | "visible"
  | "dismissed"
  | "error";

export type DefaultRootTryOnPipelineUiState = "idle" | "requesting" | "resulting" | "error";

/** Substates of top-level `product` (after global prefix). */
export type DefaultRootProductPhase = "active";

/**
 * `awaitingCalibration` is a try-on pipeline state introduced when calibration
 * runs in the background; from a UI perspective we render it identically to
 * `requesting` (no spinner / hide affordance — the click "looks as if it
 * worked"). The view-model surfaces only `requesting` so consumers don't need
 * to special-case the queued state.
 */

/**
 * UI-facing projection of {@link defaultRootMachine} state (no JSX).
 * Use with {@link useStudioVaaiActor} `.state` or {@link useStudioVaaiSelector}.
 */
export interface DefaultRootViewModel {
  phase: DefaultRootPhase;
  /**
   * `"active"` when {@link phase} is `product` and the parallel overview/try-on
   * regions are running (`product.active`); `null` otherwise.
   */
  productPhase: DefaultRootProductPhase | null;
  /** Parallel `variant` region; `null` when not in `product.active`. */
  variant: DefaultRootVariantUiState | null;
  /** Parallel `recommendation` region; `null` when not in `product.active`. */
  recommendation: DefaultRootRecommendationUiState | null;
  /**
   * The fetched size recommendation itself (rank-1 slug + the ranked shortlist with rationale + fit),
   * or `null` before it arrives / when the product has no size chart. Lets the UI default to the
   * recommended size and show why.
   */
  recommendationData: RecommendedSizeData | null;
  /** Parallel `tryOnPipeline` region; `null` when not in `product.active`. */
  tryOnPipeline: DefaultRootTryOnPipelineUiState | null;
  /**
   * Whether `START_TRY_ON` is accepted: the pipeline is `idle` or `error` and the
   * current `selection` resolves to a variant. Mirrors the `findVariantByAttributes`
   * guard the machine's `START_TRY_ON` transitions key off.
   */
  canStartTryOn: boolean;
}

export type DefaultRootSnapshot = SnapshotFrom<DefaultRootMachine>;

function phaseFromSnapshot(snapshot: DefaultRootSnapshot): DefaultRootPhase {
  if (snapshot.matches("photoCapture")) {
    return "photoCapture";
  }
  if (snapshot.matches("photoUpload")) {
    return "photoUpload";
  }
  if (snapshot.matches("sessionIntro")) {
    return "sessionIntro";
  }
  if (snapshot.matches({ postCapture: { screen: "heightCalibration" } })) {
    return "bodyHeightCalibration";
  }
  if (snapshot.matches({ postCapture: { screen: "product" } })) {
    return "product";
  }
  return "sessionIntro";
}

function productPhaseFromSnapshot(snapshot: DefaultRootSnapshot): DefaultRootProductPhase | null {
  if (!snapshot.matches({ postCapture: { screen: "product" } })) {
    return null;
  }
  if (snapshot.matches({ postCapture: { screen: { product: "active" } } })) {
    return "active";
  }
  return null;
}

function variantFromSnapshot(snapshot: DefaultRootSnapshot): DefaultRootVariantUiState | null {
  if (!snapshot.matches({ postCapture: { screen: { product: { active: {} } } } })) {
    return null;
  }
  if (
    snapshot.matches({
      postCapture: { screen: { product: { active: { variant: "selecting" } } } },
    })
  ) {
    return "selecting";
  }
  if (
    snapshot.matches({
      postCapture: { screen: { product: { active: { variant: "selected" } } } },
    })
  ) {
    return "selected";
  }
  return null;
}

function recommendationFromSnapshot(
  snapshot: DefaultRootSnapshot,
): DefaultRootRecommendationUiState | null {
  if (!snapshot.matches({ postCapture: { screen: { product: { active: {} } } } })) {
    return null;
  }
  const states: DefaultRootRecommendationUiState[] = [
    "hidden",
    "loading",
    "visible",
    "dismissed",
    "error",
  ];
  for (const s of states) {
    if (
      snapshot.matches({
        postCapture: { screen: { product: { active: { recommendation: s } } } },
      })
    ) {
      return s;
    }
  }
  return null;
}

function tryOnPipelineFromSnapshot(
  snapshot: DefaultRootSnapshot,
): DefaultRootTryOnPipelineUiState | null {
  if (!snapshot.matches({ postCapture: { screen: { product: { active: {} } } } })) {
    return null;
  }
  // Treat `awaitingCalibration` as `requesting` for UI purposes — the click
  // looks like it kicked off a try-on; the queue is invisible to the user.
  if (
    snapshot.matches({
      postCapture: {
        screen: { product: { active: { tryOnPipeline: "awaitingCalibration" } } },
      },
    })
  ) {
    return "requesting";
  }
  const states: DefaultRootTryOnPipelineUiState[] = ["idle", "requesting", "resulting", "error"];
  for (const s of states) {
    if (
      snapshot.matches({
        postCapture: { screen: { product: { active: { tryOnPipeline: s } } } },
      })
    ) {
      return s;
    }
  }
  return null;
}

/**
 * Derives a stable view model from a {@link defaultRootMachine} snapshot for UI and tests.
 */
export function buildDefaultRootViewModel(snapshot: DefaultRootSnapshot): DefaultRootViewModel {
  const phase = phaseFromSnapshot(snapshot);
  const productPhase = productPhaseFromSnapshot(snapshot);
  const variant = variantFromSnapshot(snapshot);
  const recommendation = recommendationFromSnapshot(snapshot);
  const tryOnPipeline = tryOnPipelineFromSnapshot(snapshot);

  const canStartTryOn =
    productPhase === "active" &&
    (tryOnPipeline === "idle" || tryOnPipeline === "error") &&
    findVariantByAttributes(snapshot.context.product, snapshot.context.selection) !== undefined;

  return {
    phase,
    productPhase,
    variant,
    recommendation,
    recommendationData: snapshot.context.recommendation ?? null,
    tryOnPipeline,
    canStartTryOn,
  };
}
