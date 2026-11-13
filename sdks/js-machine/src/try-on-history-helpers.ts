import type {
  FitAnchor,
  ProductId,
  TryOnId,
  TryOnProvenance,
  TryOnScene,
} from "@studio-vaai/js-client";

/**
 * Discriminator on a stored try-on result. `completed` carries the full success
 * payload (`tryOnId` + `scene` alongside `imageUrl`) so a repeat click on the same
 * variant can re-open the result screen without a round-trip; `failed` carries the
 * server-reported `failureReason` (so the size selector can mark pills that hit a
 * per-piece `FitConstraints` gate without re-querying the server).
 */
export type TryOnHistoryEntryStatus = "completed" | "failed";

export type TryOnHistoryFailureReason = "garment_too_small" | "garment_too_large";

/**
 * One stored try-on result. `attributes` is captured at the moment the try-on
 * terminated so consumers can label the result with the size/colorway that was actually
 * used, independent of the live PDP selection. (The variant identity *is* the
 * attribute map — there's no separate id field.)
 *
 * Both `completed` and `failed` outcomes are appended, and both are self-sufficient
 * replay sources: completions carry `tryOnId` + `scene` so a repeat click on the same
 * variant re-opens the result screen from cache; failures carry the server-recommended
 * size so the size selector can replay the same upgrade prompt — neither hits the
 * network again (no extra round-trip).
 */
export interface TryOnHistoryEntry {
  imageUrl: string;
  attributes: Readonly<Record<string, string>>;
  status: TryOnHistoryEntryStatus;
  /**
   * Set when `status === "completed"`: the server's try-on id, so a cached-replay
   * re-open can reconstruct the success {@link TryOnResult} the result machine expects.
   */
  tryOnId?: TryOnId;
  /**
   * Set when `status === "completed"`: the scene chrome captured with the result, so a
   * cached-replay re-open renders identically to the original (overlay color, etc.).
   */
  scene?: TryOnScene;
  /**
   * Set when `status === "completed"` and the render produced in-frame callout anchors: where
   * each fit-panel dimension sits in this entry's image (normalized 0–1), so carousel
   * navigation and cached replays keep each slide's callout overlay.
   */
  fitAnchors?: readonly FitAnchor[];
  /**
   * Set when `status === "completed"` and the server reported it: where this render came from
   * (publication, stored drape, builds), so a provenance overlay can label any carousel slide.
   */
  provenance?: TryOnProvenance;
  /** Set when `status === "failed"`. */
  failureReason?: TryOnHistoryFailureReason;
  /**
   * Set when `status === "failed"`: the size the server recommends as the next-up
   * fitting variant. Used by the size selector to auto-jump and to replay the
   * "this size is too small, try X" prompt without a server round-trip when the
   * user re-clicks the failed size.
   */
  recommendedSize?: string;
  /**
   * Index into {@link DefaultRootContext.bodyRevisions} of the revision active
   * when this entry was appended. The UI walks revisions back from the latest
   * to find the cutoff and flags `bodyRevisionIndex <= cutoff` entries as
   * historical (labeled with the height at their revision). Omitted when the
   * entry was appended before any calibration confirmed a height, or when the
   * flow doesn't track revisions (standalone `productFlow`).
   */
  bodyRevisionIndex?: number;
}

export interface ProductTryOnHistory {
  entries: readonly TryOnHistoryEntry[];
  cursor: number;
  currentEntry: TryOnHistoryEntry | null;
}

const EMPTY_HISTORY: ProductTryOnHistory = {
  entries: [],
  cursor: -1,
  currentEntry: null,
};

/**
 * Reads the try-on history for a single product from a `DefaultRootContext`
 * (or any context carrying `tryOnHistoryByProduct`). Missing product or `cursor < 0`
 * both map to `currentEntry: null`. Structural typing avoids importing
 * `DefaultRootContext`, which would create a cycle (DefaultRootContext itself
 * references `TryOnHistoryEntry`).
 */
export function selectProductTryOnHistory(
  context: {
    tryOnHistoryByProduct: Record<string, { entries: TryOnHistoryEntry[]; cursor: number }>;
  },
  productId: ProductId,
): ProductTryOnHistory {
  const entry = context.tryOnHistoryByProduct[productId];
  if (entry === undefined) {
    return EMPTY_HISTORY;
  }
  const currentEntry = entry.cursor >= 0 ? (entry.entries[entry.cursor] ?? null) : null;
  return {
    entries: entry.entries,
    cursor: entry.cursor,
    currentEntry,
  };
}
