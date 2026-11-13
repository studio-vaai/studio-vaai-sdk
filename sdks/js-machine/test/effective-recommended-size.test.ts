import type { RecommendedSizeData, SizeRecommendation } from "@studio-vaai/js-client";

import { describe, expect, it } from "vitest";

import { effectiveRecommendedSize } from "../src/machines/product-overview-parallel.js";

function rec(size: string, rank: number, gate?: "too_small" | "too_large"): SizeRecommendation {
  return {
    size,
    rank,
    rationale: "",
    fit: "ideal",
    fitMatch: 50,
    fitChecks: [],
    ...(gate === undefined ? {} : { gate }),
  };
}

function data(recommendedSize: string, recommendations: SizeRecommendation[]): RecommendedSizeData {
  return { recommendedSize, fitProfile: "regular", recommendations };
}

describe("effectiveRecommendedSize", () => {
  it("takes the best-ranked size the gate lets through", () => {
    // Rank 1 is refused, so the recommendation moves to the next size that is not.
    expect(
      effectiveRecommendedSize(data("s", [rec("s", 1, "too_small"), rec("m", 2), rec("l", 3)])),
    ).toBe("m");
  });

  it("recommends nothing when every ranked size is refused", () => {
    // Observed on int: a single-size product whose one size the server gates `too_small`, while
    // still reporting it as `recommendedSize` — that field is rank 1 and knows nothing about the
    // gate. Surfacing it would ring and strike the same chip and call it the recommendation.
    expect(effectiveRecommendedSize(data("s", [rec("s", 1, "too_small")]))).toBe("");
    expect(
      effectiveRecommendedSize(
        data("m", [rec("s", 2, "too_small"), rec("m", 1, "too_small"), rec("l", 3, "too_large")]),
      ),
    ).toBe("");
  });

  it("keeps the server's own field when there is no ranking at all", () => {
    // No size chart: nothing was evaluated, so there is no gate verdict to contradict.
    expect(effectiveRecommendedSize(data("m", []))).toBe("m");
  });
});
