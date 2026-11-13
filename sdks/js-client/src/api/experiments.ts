import type { ApiResult, CallOptions } from "../base.js";

export interface GetTryOnDecisionArgs {
  /**
   * Stable, anonymous visitor id. The same value always yields the same
   * decision (sticky bucketing), so keep it stable per visitor for as long as
   * you want the assignment to hold. `@studio-vaai/react-headless` manages this
   * for you (held in memory for the page session).
   */
  visitorId: string;
}

/** Whether to show the try-on feature for a visitor, plus the assigned arm. */
export interface TryOnExperimentDecision {
  /** `true` ⇒ render the try-on entry point; `false` ⇒ render nothing. */
  enabled: boolean;
  /** Assigned arm; pass to the `experiment-assigned` tracking event. */
  variant: "enabled" | "disabled";
}

export interface EvaluationContext extends Record<string, unknown> {
  targetingKey?: string;
}
export interface FlagEvaluation {
  key: string;
  value: boolean | string | number | Record<string, unknown>;
  reason: "STATIC" | "TARGETING_MATCH" | "SPLIT" | "DISABLED" | "UNKNOWN";
}
export interface FlagEvaluationFailure {
  key: string;
  errorCode: "PARSE_ERROR" | "TARGETING_KEY_MISSING" | "INVALID_CONTEXT" | "GENERAL";
  errorDetails?: string;
}
export type BulkEvaluationData =
  | { notModified: true; etag: string }
  | { notModified: false; flags: (FlagEvaluation | FlagEvaluationFailure)[]; etag: string };
export interface ExperimentsApi {
  evaluateFlag(
    args: { key: string; context: EvaluationContext },
    options?: CallOptions,
  ): Promise<ApiResult<FlagEvaluation>>;
  evaluateFlagsBulk(
    args: { context: EvaluationContext; ifNoneMatch?: string },
    options?: CallOptions,
  ): Promise<ApiResult<BulkEvaluationData>>;

  /**
   * Ask the backend whether this visitor should see the try-on feature for the
   * shop. Buckets `visitorId` against the shop's console-controlled rollout
   * percentage. Requires only the client API key (no session).
   */
  getTryOnDecision(
    args: GetTryOnDecisionArgs,
    options?: CallOptions,
  ): Promise<ApiResult<TryOnExperimentDecision>>;
}
