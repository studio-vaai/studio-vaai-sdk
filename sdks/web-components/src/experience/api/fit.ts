import type { MessageId, TryOn } from "@studio-vaai/core";
import type { TryOnSuccess } from "@studio-vaai/core/api";

import { Fit, FitAxis, ResultFit, resultFitCallouts } from "@studio-vaai/core";

import type { SvTryOnFit } from "../../screens/try-on-view/fit.js";

const verdicts = {
  [Fit.TooSmall]: { key: "tooSmall", variant: "destructive" },
  [Fit.RunsTight]: { key: "runsTight", variant: "caution" },
  [Fit.Ideal]: { key: "ideal", variant: "positive" },
  [Fit.RunsLoose]: { key: "runsLoose", variant: "caution" },
  [Fit.TooLoose]: { key: "tooLoose", variant: "caution" },
} as const;

/** The catalog's name of each measurement: shoppers never see the garment's point-of-measure name. */
const axisNames = {
  [FitAxis.Chest]: "tryOnView.fitAxisNames.chest",
  [FitAxis.Waist]: "tryOnView.fitAxisNames.waist",
  [FitAxis.Hip]: "tryOnView.fitAxisNames.hip",
  [FitAxis.Bottom]: "tryOnView.fitAxisNames.bottom",
  [FitAxis.TotalLength]: "tryOnView.fitAxisNames.totalLength",
  [FitAxis.SleeveLength]: "tryOnView.fitAxisNames.sleeveLength",
  [FitAxis.ShoulderWidth]: "tryOnView.fitAxisNames.shoulderWidth",
  [FitAxis.Inseam]: "tryOnView.fitAxisNames.inseam",
  [FitAxis.Other]: "tryOnView.fitAxisNames.other",
} as const satisfies Record<FitAxis, MessageId>;

export interface ApiTryOnResult {
  result: TryOnSuccess;
}

export function fitForResult(
  result: TryOn,
  retryable: boolean,
  text: (message: MessageId) => string,
): SvTryOnFit | undefined {
  const { id, fit } = result;
  if (fit === undefined) {
    return undefined;
  }
  if (ResultFit.Pending.instanceOf(fit)) {
    return { tryOnId: id, state: "loading" };
  }
  if (ResultFit.Failed.instanceOf(fit)) {
    return { tryOnId: id, state: "error", retryable };
  }
  if (!ResultFit.Ready.instanceOf(fit)) {
    return undefined;
  }
  const callouts = resultFitCallouts(result).map(({ key, x, y, axis, fit, isLength }) => {
    const { key: verdict, variant } = verdicts[fit];
    const family = isLength ? "lengthVerdicts" : "fitVerdicts";
    return {
      key,
      x,
      y,
      label: text(axisNames[axis]),
      description: text(`tryOnView.${family}.${verdict}`),
      variant,
      alternates: (result.fitAnchors ?? [])
        .filter((anchor) => anchor.dimension === key && (anchor.x !== x || anchor.y !== y))
        .map((anchor) => ({ x: anchor.x, y: anchor.y })),
      // The length is read at the front hem: a tick across it marks it better than a dot.
      marker: axis === FitAxis.TotalLength ? ("tick" as const) : ("dot" as const),
    };
  });
  return {
    tryOnId: id,
    state: "ready",
    score: fit.inner.score.fitMatch * 100,
    callouts,
    subject: result.subjectBands ?? undefined,
  };
}
