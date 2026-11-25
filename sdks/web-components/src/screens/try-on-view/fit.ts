import type { TryOnId } from "@studio-vaai/core";

import type { SvFitCalloutProps } from "../../components/fit-score/sv-fit-callout.js";

/** A fit detail at fractional x/y coordinates within its result image. */
export interface SvTryOnFitCallout extends Omit<SvFitCalloutProps, "active"> {
  key: string;
  x: number;
  y: number;
  /** The same measurement's other anchors (the other sleeve), used when a crop hides x/y. */
  alternates?: readonly { x: number; y: number }[] | undefined;
  /** What marks the anchor: a halo dot (default), or a tick across the hem for the length. */
  marker?: "dot" | "tick" | undefined;
}

/** One horizontal band of the person's outline in a result image; all values range from 0 to 1. */
export interface SvTryOnFitSubjectBand {
  top: number;
  bottom: number;
  left: number;
  right: number;
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
      /** The person's outline, so the details stand beside them instead of over them. */
      subject?: readonly SvTryOnFitSubjectBand[] | undefined;
    }
  | { tryOnId: TryOnId; state: "error"; retryable?: boolean };
