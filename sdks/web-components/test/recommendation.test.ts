import { SizeRecommendationGate, normalizeRecommendation } from "@studio-vaai/core/api";
import { beforeAll, describe, expect, it } from "vitest";

import { initializeTestUi } from "./ui-fixture.js";

describe("recommendation matching", () => {
  beforeAll(initializeTestUi);

  it("uses the same winning row for admission and displayed fit", () => {
    const productId = crypto.randomUUID();
    const regularId = crypto.randomUUID();
    const longId = crypto.randomUUID();
    const general = {
      foreignIds: new Map([["size", "M"]]),
      rank: 2,
      rationale: "",
      fit: "ideal",
      fitMatch: 94,
      fitChecks: [],
    };
    const specific = {
      ...general,
      foreignIds: new Map([
        ["size", "M"],
        ["length", "long"],
      ]),
      rank: 1,
      gate: new SizeRecommendationGate.TooSmall(),
    };
    const ranked = normalizeRecommendation(
      {
        id: productId,
        variants: [
          {
            id: regularId,
            foreignIds: new Map([
              ["size", "M"],
              ["length", "regular"],
            ]),
          },
          { id: longId, foreignIds: specific.foreignIds },
        ],
      },
      { recommendations: [general, specific] },
    );

    expect(ranked.restrictions.map(({ variantId }) => variantId)).toEqual([longId]);
    expect(ranked.scores.map(({ variantIds }) => variantIds)).toEqual([[regularId]]);
    expect(ranked.scores[0]?.aggregate.fitMatch).toBe(0.94);
  });
});
