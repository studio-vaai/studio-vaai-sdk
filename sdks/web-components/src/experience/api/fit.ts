import type { MessageId, TryOn } from "@studio-vaai/core";
import type { TryOnSuccess } from "@studio-vaai/core/api";

import { Fit, ResultFit, resultFitCallouts } from "@studio-vaai/core";

import type { SvTryOnFit } from "../../screens/try-on-view/fit.js";

const verdicts = {
  [Fit.TooSmall]: { key: "tooSmall", variant: "destructive" },
  [Fit.RunsTight]: { key: "runsTight", variant: "caution" },
  [Fit.Ideal]: { key: "ideal", variant: "positive" },
  [Fit.RunsLoose]: { key: "runsLoose", variant: "caution" },
  [Fit.TooLoose]: { key: "tooLoose", variant: "caution" },
} as const;

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
  const callouts = resultFitCallouts(result).map(({ fit, isLength, ...anchor }) => {
    const { key, variant } = verdicts[fit];
    const family = isLength ? "lengthVerdicts" : "fitVerdicts";
    return { ...anchor, description: text(`tryOnView.${family}.${key}`), variant };
  });
  return { tryOnId: id, state: "ready", score: fit.inner.score.fitMatch * 100, callouts };
}
