import { describe, expect, it } from "vitest";

import { placeFitCallouts } from "../src/screens/try-on-view/callout-layout.js";

const bounds = { left: 8, right: 352, top: 12, bottom: 300, gap: 10 };

describe("fit callout layout", () => {
  it("moves an edge card clear of its anchor without narrowing it", () => {
    const point = { x: 310, y: 160 };
    const [card] = placeFitCallouts([{ point, width: 144, height: 54 }], bounds);
    expect(card).toMatchObject({ x: 208, y: 170, lineEnd: point });
    expect(card?.lineStart.y).toBe(170);
  });

  it("keeps clustered cards inside the bottom edge and uses both sides", () => {
    const callouts = [286, 289, 292, 295].map((y) => ({
      point: { x: 180, y },
      width: 124,
      height: 54,
    }));
    const cards = placeFitCallouts(callouts, bounds);
    for (const x of [8, 228]) {
      const column = cards.filter((card) => card.x === x).toSorted((a, b) => a.y - b.y);
      expect(column).toHaveLength(2);
      expect(column[0]?.y).toBe(182);
      expect(column[1]?.y).toBe(246);
    }
  });
});
