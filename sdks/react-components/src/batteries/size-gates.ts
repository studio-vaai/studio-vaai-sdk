/**
 * One derivation of "which sizes does the flow refuse for this body", shared by the size step and
 * the try-on view. The two screens are one step apart and must refuse exactly the same sizes; when
 * each derived its own, they drifted — the size step blocked on a verdict the try-on view still
 * offered a live button for.
 */

/** The refusal vocabulary the UI draws: a struck-through chip plus a note naming the direction. */
export type SizeGate = "too_small" | "too_large";

/** One ranked size from the recommendation payload — structural, so callers need no import. */
export interface SizeGateRecommendation {
  size: string;
  /** The hard try-on gate. Already in the UI's vocabulary. */
  gate?: string | undefined;
  /** The graded fit outlook: `too_small | runs_tight | ideal | runs_loose | too_loose`. */
  fit?: string | undefined;
}

/** A try-on the server has already refused, in the shape the flow reports it. */
export interface SizeGateFailure {
  requestedSize: string;
  reason: string;
}

/**
 * Sizes this body cannot try on, keyed by size slug.
 *
 * Three inputs, because a refusal reaches the UI in three different shapes and any one alone
 * leaves a hole a shopper walks into:
 *
 * 1. `gate` — the server's hard try-on gate, already `too_small | too_large`. It wins whenever
 *    present: it is the server's own word for WHY it refuses.
 * 2. `fit` — the graded outlook. It refuses NOTHING, at either end. It is a quality verdict by
 *    definition: `docs/fit-gating.md` says looseness "is a QUALITY verdict", and tightness is
 *    the same kind of statement one notch the other way. Both ends used to block here, and both
 *    were the same mistake — re-deciding on this side of the wire a question the backend had
 *    already answered, with different thresholds, and getting a different answer.
 *
 *    The small end was the last to go, and it went because it was observed refusing a size the
 *    server RENDERS: a shopper was told "XS is too small for you" on a body whose recommendation
 *    carried `fit: "runs_tight"` with no gate, and whose XS try-on returned `completed` when
 *    issued directly. A refusal the server disagrees with is worse than a bad-looking render.
 *
 *    It was added for a real case — the hard gate's lower bound carries a 40 mm grace, and a
 *    size once cleared it by 2 mm while sitting 4.2 cm narrower than the waist. That case is
 *    real and unaddressed, but it is a BACKEND threshold, and compensating for it here is what
 *    produced the false refusal above. If it recurs, the grace is the thing to change.
 * 3. `failure` — a try-on the server has already rejected. Without it a rejected size stayed
 *    unmarked whenever the fit-intelligence data was absent, which is precisely the case where
 *    the shopper has nothing else to go on.
 *
 * The verdict then CASCADES along the size ladder. Girth is monotonic in size, so a garment that
 * will not close in M cannot close in S or XS either, and one that swims in L swims in XL. Without
 * the cascade the smaller sizes sat unmarked and selectable beside a refused one — which reads as
 * "we didn't bother checking those" rather than as a verdict.
 *
 * `sizes` must be ordered smallest-first. The public API sorts it by the catalog's size rank
 * (`ORDER BY pieces.size_rank ASC`), which is the same order the picker row draws.
 */
export function buildSizeGates(
  sizes: readonly string[],
  recommendations?: readonly SizeGateRecommendation[],
  failure?: SizeGateFailure,
): Map<string, SizeGate> {
  const direct = new Map<string, SizeGate>();
  // Every size the server actually returned a verdict for — gated or not. Its silence is the
  // only thing this function is entitled to fill in.
  const evaluated = new Set<string>();
  for (const r of recommendations ?? []) {
    evaluated.add(r.size);
    const blocking: SizeGate | undefined =
      r.gate === "too_small" || r.gate === "too_large" ? r.gate : undefined;
    if (blocking !== undefined) {
      direct.set(r.size, blocking);
    }
  }
  // ONLY a fit verdict gates. Every other rejection — a failed render, a transport error — is
  // about the request, not about the body, and `reason` carries which. Mapping the whole union
  // onto "too_small" by default marked a size the shopper could have retried as one that will
  // never fit: struck through in the picker, described as too small, and with the retry button
  // suppressed because the flow refuses to re-offer a gated size.
  if (failure !== undefined && failure.requestedSize.length > 0) {
    evaluated.add(failure.requestedSize);
    if (failure.reason === "garment_too_small") {
      direct.set(failure.requestedSize, "too_small");
    } else if (failure.reason === "garment_too_large") {
      direct.set(failure.requestedSize, "too_large");
    }
  }
  if (direct.size === 0) {
    return direct;
  }

  // Anchor the fill on the OUTERMOST verdict at each end: below the largest `too_small` and
  // above the smallest `too_large`, monotonicity says the answer is the same.
  let lastTooSmall = -1;
  let firstTooLarge = sizes.length;
  for (const [index, slug] of sizes.entries()) {
    const verdict = direct.get(slug);
    if (verdict === "too_small") {
      lastTooSmall = index;
    } else if (verdict === "too_large" && index < firstTooLarge) {
      firstTooLarge = index;
    }
  }

  const gates = new Map(direct);
  for (const [index, slug] of sizes.entries()) {
    // ONLY sizes the server never spoke about. It ranks every size in the chart, and its own
    // bounds are monotonic in size — `max_accommodated` and the garment circumference both grow
    // with it — so if it ranked a size and did not gate it, that is an answer, not an omission,
    // and filling over it substitutes this side's arithmetic for the physics that produced it.
    //
    // This used to overwrite exactly that case, reasoning that "the server cannot coherently
    // say L will not close while S fits". It can: the gate compares against the narrowest ring
    // of the waist–hip band while the fit outlook compares against its centre, so a size can be
    // refused above and accepted below without contradiction.
    //
    // What is left is the real gap: a product may offer a size the CHART does not carry, and
    // the server can say nothing about that one. Monotonicity fills it from its neighbours.
    if (evaluated.has(slug)) {
      continue;
    }
    // Contradictory input (a `too_large` ranked below a `too_small`) would satisfy both tests.
    // "Too small" is checked first so the shopper is pushed UP the ladder, the direction that
    // can still produce a wearable size.
    if (index < lastTooSmall) {
      gates.set(slug, "too_small");
    } else if (index > firstTooLarge) {
      gates.set(slug, "too_large");
    }
  }
  return gates;
}

/**
 * The size to point a refused shopper at: the nearest size the flow will actually accept.
 *
 * The server's own suggestion is preferred when it survives {@link buildSizeGates} — it carries
 * fit intent this ladder walk cannot reconstruct. But it is only a suggestion, and two ways it
 * goes wrong were both visible in the UI:
 *
 *  - It names a size this screen refuses. `effectiveRecommendedSize` skips sizes carrying a hard
 *    `gate`, while `buildSizeGates` ALSO refuses a failing `fit` verdict and cascades along the
 *    ladder — so the two disagree, and the note read "Size S is too small for you. Our
 *    recommendation: S" while S sat struck through in the row beside it.
 *  - It is absent, which the copy used to treat as "this style doesn't come any larger". That
 *    claim was never checked against the ladder: on an eight-size run refused at S it printed the
 *    dead end with M, L, XL, 2XL and 3XL all offered and ungated directly beside it.
 *
 * So the suggestion is validated, and when it does not hold the ladder decides: refused for being
 * too small, walk UP to the first size that is not refused; too large, walk DOWN. `undefined` only
 * when that direction is genuinely exhausted — which is the one case the dead-end copy may claim.
 *
 * `sizes` must be ordered smallest-first, the same order {@link buildSizeGates} expects.
 */
export function resolveGateAlternative(
  sizes: readonly string[],
  gates: ReadonlyMap<string, SizeGate>,
  refusedSize: string,
  gate: SizeGate,
  preferred?: string,
): string | undefined {
  const viable = (slug: string): boolean => !gates.has(slug);
  if (
    preferred !== undefined &&
    preferred.length > 0 &&
    preferred !== refusedSize &&
    sizes.includes(preferred) &&
    viable(preferred)
  ) {
    return preferred;
  }
  const index = sizes.indexOf(refusedSize);
  // Too small pushes UP the ladder, too large DOWN. An unknown refused size (a chart slug the
  // product does not stock) still gets an answer: scan the whole run from the helpful end.
  const candidates =
    gate === "too_small"
      ? sizes.slice(index === -1 ? 0 : index + 1)
      : sizes.slice(0, index === -1 ? sizes.length : index).toReversed();
  return candidates.find((slug) => viable(slug));
}
