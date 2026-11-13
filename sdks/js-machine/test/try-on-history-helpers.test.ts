import { describe, expect, it } from "vitest";

import { selectProductTryOnHistory } from "../src/try-on-history-helpers.js";
import { testProductId } from "./helpers.js";

const entryA = {
  imageUrl: "a.png",
  attributes: { size: "M" },
  status: "completed" as const,
};
const entryB = {
  imageUrl: "b.png",
  attributes: { size: "L" },
  status: "completed" as const,
};

describe("selectProductTryOnHistory", () => {
  it("returns empty + null entry when product is missing", () => {
    expect(selectProductTryOnHistory({ tryOnHistoryByProduct: {} }, testProductId)).toEqual({
      entries: [],
      cursor: -1,
      currentEntry: null,
    });
  });

  it("returns null entry when cursor is below zero", () => {
    expect(
      selectProductTryOnHistory(
        {
          tryOnHistoryByProduct: {
            [testProductId]: { entries: [entryA, entryB], cursor: -1 },
          },
        },
        testProductId,
      ),
    ).toEqual({
      entries: [entryA, entryB],
      cursor: -1,
      currentEntry: null,
    });
  });

  it("resolves the entry at the cursor", () => {
    expect(
      selectProductTryOnHistory(
        {
          tryOnHistoryByProduct: {
            [testProductId]: { entries: [entryA, entryB], cursor: 1 },
          },
        },
        testProductId,
      ),
    ).toEqual({
      entries: [entryA, entryB],
      cursor: 1,
      currentEntry: entryB,
    });
  });
});
