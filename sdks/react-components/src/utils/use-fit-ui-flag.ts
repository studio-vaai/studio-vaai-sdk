import { useEffect, useState } from "react";

/** Browser query param that opts into the fit-intelligence UI (default off). Enable with `?fitUi=1`. */
const FIT_UI_QUERY_PARAM = "fitui"; // compared lowercased, so ?fitUi / ?fitUI / ?FITUI all match
const FIT_UI_TRUTHY = new Set(["1", "true", "on", "yes"]);

/**
 * Whether the fit-UI query param opts in. The param NAME is matched case-insensitively (`fitUi`,
 * `fitUI`, `FITUI`, …) and only an explicit truthy value enables it. SSR-safe (no `location` →
 * false), so in-render callers read it in an effect to avoid a hydration mismatch. Exported for
 * hosts that need the flag OUTSIDE render — e.g. to build the machine input
 * (`autoStartOnRecommendedSize`) when creating the actor.
 */
export function readFitUiQueryFlag(): boolean {
  const loc = globalThis.location as Location | undefined;
  if (loc === undefined) {
    return false;
  }
  for (const [key, value] of new URLSearchParams(loc.search)) {
    if (key.toLowerCase() === FIT_UI_QUERY_PARAM) {
      return FIT_UI_TRUTHY.has(value.toLowerCase());
    }
  }
  return false;
}

/**
 * Resolve the fit-intelligence opt-in for a screen. The explicit `fitIntelligence` prop wins when set
 * (Storybook / host rollout); otherwise the `?fitUi=1` browser query param enables it. The query flag
 * is read after mount so SSR (no query → off) and the first client render agree — no hydration
 * mismatch — and off by default so the existing UI is what ships.
 */
export function useFitUiFlag(fitIntelligence?: boolean): boolean {
  const [fitUiQuery, setFitUiQuery] = useState(false);
  useEffect(() => {
    setFitUiQuery(readFitUiQueryFlag());
  }, []);
  return fitIntelligence ?? fitUiQuery;
}
