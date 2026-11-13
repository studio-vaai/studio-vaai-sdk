import type { TryOnId } from "@studio-vaai/core";

import type { SvFitCalloutProps } from "../../components/fit-score/sv-fit-callout.js";

/** A fit detail at fractional x/y coordinates within its result image. */
export interface SvTryOnFitCallout extends Omit<SvFitCalloutProps, "active"> {
  key: string;
  x: number;
  y: number;
}

/** Fit display state for one try-on result. */
export type SvTryOnFit =
  | { tryOnId: TryOnId; state: "loading" }
  | {
      tryOnId: TryOnId;
      state: "ready";
      /** Fit score from 0 to 100. */
      score: number;
      /** Localized intended-fit description. */
      description?: string | undefined;
      /** Localized fit details. x and y range from 0 to 1. */
      callouts?: readonly SvTryOnFitCallout[] | undefined;
    }
  | { tryOnId: TryOnId; state: "error"; retryable?: boolean };
