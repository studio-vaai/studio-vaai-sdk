import type { StandardError } from "@studio-vaai/js-client";
import type { BodyId } from "@studio-vaai/js-client";
import type { ProductId } from "@studio-vaai/js-client";
import type { SessionHandle } from "@studio-vaai/js-client";
import type { StudioVaaiClient } from "@studio-vaai/js-client";

import type { JsMachineInput } from "./shared.js";

export interface BodyHeightCalibrationInput extends JsMachineInput {
  session: SessionHandle;
  bodyId: BodyId;
  /** Initial picker value: predicted height from create-body, or last confirmed height when re-entering. */
  initialHeightCm: number;
  /**
   * Product the user is heading toward after calibration. Forwarded to the
   * server so it can speculatively prewarm the body-for-product (background
   * removal) while the user moves on. Optional — calibration works without it,
   * the subsequent try-on just won't be cache-warm.
   */
  productId?: ProductId | undefined;
}

export interface BodyHeightCalibrationContext {
  client: StudioVaaiClient;
  session: SessionHandle;
  bodyId: BodyId;
  heightCm: number;
  productId?: ProductId | undefined;
  lastError?: StandardError | undefined;
  /** Set when entering a terminal state; read by root `output`. */
  completed?: BodyHeightCalibrationOutput | undefined;
}

/** Emitted when the user wants a new photo instead of calibrating height. */
export interface BodyHeightRetryCaptureOutput {
  kind: "retryCapture";
}

export type BodyHeightCalibrationOutput =
  | { kind: "calibrated"; bodyId: BodyId; heightCm: number }
  | BodyHeightRetryCaptureOutput;
