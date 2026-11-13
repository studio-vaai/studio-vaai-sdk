import { describe, expect, it } from "vitest";

import { buildSizeGates, resolveGateAlternative } from "../src/batteries/size-gates.js";

const LADDER = ["xs", "s", "m", "l", "xl"] as const;

describe("buildSizeGates", () => {
  it("reads the hard gate and nothing else — the outlook is never a refusal", () => {
    const gates = buildSizeGates(LADDER, [
      { size: "xs", gate: "too_small" },
      // Both ends of the outlook are quality verdicts. `too_small` here is a size that will be
      // TIGHT, not one the flow refuses: a shopper was told "XS is too small for you" on a body
      // whose XS try-on returned `completed` when issued directly.
      { size: "s", fit: "too_small" },
      { size: "xl", fit: "too_loose" },
      { size: "m", fit: "ideal" },
      { size: "l", fit: "runs_loose" },
    ]);
    expect(gates.get("xs")).toBe("too_small");
    expect(gates.has("s")).toBe(false);
    expect(gates.has("xl")).toBe(false);
    expect(gates.has("m")).toBe(false);
    expect(gates.has("l")).toBe(false);
  });

  it("prefers the hard gate over the outlook when they disagree", () => {
    const gates = buildSizeGates(LADDER, [{ size: "m", gate: "too_large", fit: "too_small" }]);
    expect(gates.get("m")).toBe("too_large");
  });

  it("cascades a too-small verdict down the ladder", () => {
    // Girth is monotonic in size: if M will not close, S and XS cannot either. Leaving them
    // unmarked put selectable chips next to a refused one.
    const gates = buildSizeGates(LADDER, [{ size: "m", gate: "too_small" }]);
    expect(gates.get("xs")).toBe("too_small");
    expect(gates.get("s")).toBe("too_small");
    expect(gates.get("m")).toBe("too_small");
    expect(gates.has("l")).toBe(false);
    expect(gates.has("xl")).toBe(false);
  });

  it("cascades a too-large verdict up the ladder", () => {
    const gates = buildSizeGates(LADDER, [{ size: "m", gate: "too_large" }]);
    expect(gates.get("m")).toBe("too_large");
    expect(gates.get("l")).toBe("too_large");
    expect(gates.get("xl")).toBe("too_large");
    expect(gates.has("xs")).toBe(false);
    expect(gates.has("s")).toBe(false);
  });

  it("gates a size the server already rejected, even with no recommendation data", () => {
    // The plain flow has no per-size fit data at all, so without this a rejected size — and
    // every smaller one — rendered as freely selectable beside the refusal note.
    const gates = buildSizeGates(LADDER, undefined, {
      requestedSize: "m",
      reason: "garment_too_small",
    });
    expect(gates.get("m")).toBe("too_small");
    expect(gates.get("s")).toBe("too_small");
    expect(gates.get("xs")).toBe("too_small");
    expect(gates.has("l")).toBe(false);
  });

  it("keeps a size's own BLOCKING verdict rather than overwriting it from the other end", () => {
    const gates = buildSizeGates(LADDER, [
      { size: "s", gate: "too_small" },
      { size: "m", gate: "too_large" },
    ]);
    // Both cascades reach L: it is above the smallest `too_large` and below nothing. M keeps the
    // server's own word either way — inference never rewrites an answer that was actually given.
    expect(gates.get("m")).toBe("too_large");
    expect(gates.get("l")).toBe("too_large");
    expect(gates.get("s")).toBe("too_small");
    expect(gates.get("xs")).toBe("too_small");
  });

  it("fills only the sizes the server never ranked, and never overrides one it did", () => {
    const gates = buildSizeGates(LADDER, [
      { size: "l", gate: "too_small" },
      // Ranked and NOT gated. The server looked at this size and let it through, so that is an
      // answer rather than an omission, and this side does not overturn it — overturning it is
      // what refused sizes the try-on renders happily.
      { size: "s", fit: "ideal" },
    ]);
    expect(gates.has("s")).toBe(false);
    // Never ranked, and below a refusal: monotonicity in the server's own bounds says these
    // cannot close either, and filling them is the one inference left on this side.
    expect(gates.get("xs")).toBe("too_small");
    expect(gates.get("m")).toBe("too_small");
    expect(gates.get("l")).toBe("too_small");
  });

  it("is empty when nothing is refused", () => {
    expect(buildSizeGates(LADDER, [{ size: "m", fit: "ideal" }]).size).toBe(0);
    expect(buildSizeGates(LADDER).size).toBe(0);
    expect(buildSizeGates(LADDER, []).size).toBe(0);
  });

  it("ignores sizes the product does not offer", () => {
    const gates = buildSizeGates(LADDER, [{ size: "xxl", gate: "too_large" }]);
    expect(gates.get("xxl")).toBe("too_large");
    // `xxl` is not on this ladder, so it anchors no cascade over sizes that are.
    for (const slug of LADDER) {
      expect(gates.has(slug)).toBe(false);
    }
  });
});

describe("resolveGateAlternative", () => {
  // The eight-size run from the reported screenshot: refused at S, with M…3XL offered beside it.
  const RUN = ["2xs", "xs", "s", "m", "l", "xl", "2xl", "3xl"] as const;

  it("names a larger size instead of claiming the style does not come any larger", () => {
    // The server refused S and suggested nothing — the case the copy used to read as a dead end.
    const gates = buildSizeGates(RUN, undefined, {
      requestedSize: "s",
      reason: "garment_too_small",
    });
    expect(gates.get("2xs")).toBe("too_small");
    expect(gates.get("xs")).toBe("too_small");
    expect(resolveGateAlternative(RUN, gates, "s", "too_small", "")).toBe("m");
  });

  it("never points at a size the gates refuse", () => {
    // `effectiveRecommendedSize` would offer "s" here: the server refuses it, but it is still
    // rank 1. That is how the note came to read "S is too small … recommendation: S".
    const gates = buildSizeGates(RUN, [
      { size: "s", gate: "too_small" },
      { size: "m", fit: "ideal" },
    ]);
    expect(gates.get("s")).toBe("too_small");
    expect(resolveGateAlternative(RUN, gates, "s", "too_small", "s")).toBe("m");
  });

  it("keeps the server's suggestion when it survives the gates", () => {
    const gates = buildSizeGates(RUN, [{ size: "s", gate: "too_small" }]);
    // Intent the ladder walk cannot reconstruct: L, not the adjacent M.
    expect(resolveGateAlternative(RUN, gates, "s", "too_small", "l")).toBe("l");
  });

  it("walks down for a too-large refusal", () => {
    const gates = buildSizeGates(RUN, [{ size: "2xl", gate: "too_large" }]);
    expect(resolveGateAlternative(RUN, gates, "2xl", "too_large", "")).toBe("xl");
  });

  it("returns undefined only when the direction is genuinely exhausted", () => {
    const gates = buildSizeGates(RUN, undefined, {
      requestedSize: "3xl",
      reason: "garment_too_small",
    });
    // 3XL is the largest size there is — the dead-end copy is now the truthful one.
    expect(resolveGateAlternative(RUN, gates, "3xl", "too_small", "")).toBeUndefined();
  });

  it("ignores a suggestion the product does not stock", () => {
    const gates = buildSizeGates(RUN, undefined, {
      requestedSize: "s",
      reason: "garment_too_small",
    });
    expect(resolveGateAlternative(RUN, gates, "s", "too_small", "4xl")).toBe("m");
  });
});

describe("buildSizeGates and the loose end", () => {
  const RUN = ["xs", "s", "m", "l", "xl"] as const;
  const LOOSE_ABOVE = [
    { size: "s", fit: "runs_tight" },
    { size: "m", fit: "ideal" },
    { size: "l", fit: "runs_loose" },
    { size: "xl", fit: "too_loose" },
  ] as const;

  // `docs/fit-gating.md`: shoulder-anchored garments "only gate too-small — an oversized tee
  // stays on, so looseness is a quality verdict"; waist-anchored ones gate both ends, and that
  // is "a declared property of the category, not a code branch per garment type". The backend
  // applies it (`Wearability::TooLarge` is guarded on `GarmentCategory::LowerBody`) and ships
  // the result as `gate`. Nothing here re-decides it.
  it("never refuses a size for being loose, whatever the garment", () => {
    const gates = buildSizeGates(RUN, LOOSE_ABOVE);
    expect(gates.has("xl")).toBe(false);
    expect(gates.has("l")).toBe(false);
  });

  it("refuses above only when the server said so", () => {
    // This is how trousers stay bounded above — no category knowledge on this side of the wire.
    const gates = buildSizeGates(RUN, [...LOOSE_ABOVE, { size: "xl", gate: "too_large" }]);
    expect(gates.get("xl")).toBe("too_large");
  });

  it("refuses below only when the server said so", () => {
    // Symmetric with the loose end: the outlook informs, the gate refuses.
    expect(buildSizeGates(RUN, [{ size: "xs", fit: "too_small" }]).has("xs")).toBe(false);
    expect(buildSizeGates(RUN, [{ size: "xs", gate: "too_small" }]).get("xs")).toBe("too_small");
  });
});

describe("buildSizeGates ownership", () => {
  const RUN = ["xs", "s", "m", "l", "xl"] as const;

  // The whole contract in one case: for a size the server ranked, its answer stands verbatim,
  // whatever the outlook says about how it will LOOK.
  it("offers every ranked size the server did not gate", () => {
    const gates = buildSizeGates(RUN, [
      { size: "xs", fit: "too_small" },
      { size: "s", fit: "runs_tight" },
      { size: "m", fit: "ideal" },
      { size: "l", fit: "runs_loose" },
      { size: "xl", fit: "too_loose" },
    ]);
    expect(gates.size).toBe(0);
  });

  it("refuses exactly what the server refused", () => {
    const gates = buildSizeGates(RUN, [
      { size: "xs", fit: "too_small" },
      { size: "s", fit: "runs_tight" },
      { size: "m", fit: "ideal" },
      { size: "l", fit: "runs_loose", gate: "too_large" },
      { size: "xl", fit: "too_loose", gate: "too_large" },
    ]);
    expect([...gates.keys()].toSorted()).toEqual(["l", "xl"]);
  });

  // A try-on the server actually refused is newer information than the ranking, and is the one
  // verdict this side contributes.
  it("remembers a refusal the try-on itself returned", () => {
    const gates = buildSizeGates(RUN, [{ size: "m", fit: "ideal" }], {
      requestedSize: "m",
      reason: "garment_too_small",
    });
    expect(gates.get("m")).toBe("too_small");
  });
});
