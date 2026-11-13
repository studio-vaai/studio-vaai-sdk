import type { StandardError } from "@studio-vaai/js-client";
import type { SessionHandle } from "@studio-vaai/js-client";
import type { TryOnId, TryOnResult } from "@studio-vaai/js-client";
import type { StudioVaaiClient } from "@studio-vaai/js-client";

import type { JsMachineInput } from "./shared.js";

export interface TryOnResultInput extends JsMachineInput {
  session: SessionHandle;
  /** Required when {@link initialResult} is absent (fetch via {@link TryOnApi.getTryOn}). */
  tryOnId?: TryOnId | undefined;
  initialResult?: TryOnResult | undefined;
}

export interface TryOnResultContext {
  client: StudioVaaiClient;
  session: SessionHandle;
  tryOnId?: TryOnId | undefined;
  /** When set, {@link TryOnApi.getTryOn} is skipped. */
  initialResult?: TryOnResult | undefined;
  /** Resolved try-on payload for routing (from `initialResult` or `getTryOn`). */
  resolved?: TryOnResult | undefined;
  lastTransportError?: StandardError | undefined;
  /** Set when entering a terminal state; read by root `output`. */
  completion?: { kind: "dismissed" } | { kind: "retryRequest" } | undefined;
}
