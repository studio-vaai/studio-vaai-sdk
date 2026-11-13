/** A debugger projection contains no actor/snapshot reference or shopper context. */
export interface DebugSnapshot {
  phase: string;
  productPhase: string | null;
  variant: string | null;
  recommendation: string | null;
  tryOnPipeline: string | null;
  productId: string | null;
  variantResolved: string;
}

// ── Snapshot duck-type ────────────────────────────────────────────────────────

interface SnapshotLike {
  value: unknown;
  context: RootContextLike;
  matches(value: unknown): boolean;
}

interface RootContextLike {
  product?: {
    id?: unknown;
    variants?: readonly { attributes: Record<string, string> }[];
  };
  /** Attribute map (shop ids keyed by attribute name, e.g. `{ colorway: "A100-259", size: "M" }`). */
  selection?: Record<string, unknown>;
}

/** Returns "yes" / "no" / "–" for whether `selection` matches a variant in `product.variants`. */
function selectionMatchStatus(ctx: RootContextLike): string {
  const variants = ctx.product?.variants;
  const { selection } = ctx;
  if (variants === undefined || selection === undefined) {
    return "–";
  }
  const keys = Object.keys(selection);
  const matches = variants.some((v) => {
    const vKeys = Object.keys(v.attributes);
    if (vKeys.length !== keys.length) {
      return false;
    }
    return keys.every((k) => v.attributes[k] === selection[k]);
  });
  return matches ? "yes" : "no";
}

function isSnapshotLike(v: unknown): v is SnapshotLike {
  return (
    v !== null &&
    typeof v === "object" &&
    "value" in v &&
    "context" in v &&
    typeof (v as { matches?: unknown }).matches === "function"
  );
}

// ── Phase helpers ─────────────────────────────────────────────────────────────

type Phase =
  | "sessionIntro"
  | "photoCapture"
  | "photoUpload"
  | "bodyHeightCalibration"
  | "product"
  | "unknown";

function derivePhase(snap: SnapshotLike): Phase {
  if (snap.matches("photoCapture")) {
    return "photoCapture";
  }
  if (snap.matches("photoUpload")) {
    return "photoUpload";
  }
  if (snap.matches("sessionIntro")) {
    return "sessionIntro";
  }
  if (snap.matches({ postCapture: { screen: "heightCalibration" } })) {
    return "bodyHeightCalibration";
  }
  if (snap.matches({ postCapture: { screen: "product" } })) {
    return "product";
  }
  return "unknown";
}

function deriveProductPhase(snap: SnapshotLike): string | null {
  if (!snap.matches({ postCapture: { screen: "product" } })) {
    return null;
  }
  if (snap.matches({ postCapture: { screen: { product: "loadingBodyAssets" } } })) {
    return "loadingBodyAssets";
  }
  if (snap.matches({ postCapture: { screen: { product: "active" } } })) {
    return "active";
  }
  return null;
}

function deriveVariant(snap: SnapshotLike): string | null {
  if (!snap.matches({ postCapture: { screen: { product: { active: {} } } } })) {
    return null;
  }
  if (
    snap.matches({ postCapture: { screen: { product: { active: { variant: "selecting" } } } } })
  ) {
    return "selecting";
  }
  if (snap.matches({ postCapture: { screen: { product: { active: { variant: "selected" } } } } })) {
    return "selected";
  }
  return null;
}

function deriveRecommendation(snap: SnapshotLike): string | null {
  if (!snap.matches({ postCapture: { screen: { product: { active: {} } } } })) {
    return null;
  }
  for (const s of ["hidden", "loading", "visible", "dismissed", "error"] as const) {
    if (snap.matches({ postCapture: { screen: { product: { active: { recommendation: s } } } } })) {
      return s;
    }
  }
  return null;
}

function deriveTryOnPipeline(snap: SnapshotLike): string | null {
  if (!snap.matches({ postCapture: { screen: { product: { active: {} } } } })) {
    return null;
  }
  for (const s of ["idle", "requesting", "resulting", "awaitingCalibration", "error"] as const) {
    if (snap.matches({ postCapture: { screen: { product: { active: { tryOnPipeline: s } } } } })) {
      return s;
    }
  }
  return null;
}

/** Read fixed machine phases and product metadata synchronously; never retain
 * the source snapshot, its methods, children, context, blobs or history. */
export function projectDebugSnapshot(value: unknown): DebugSnapshot | null {
  if (!isSnapshotLike(value)) {
    return null;
  }
  try {
    const id = value.context.product?.id;
    return Object.freeze({
      phase: derivePhase(value),
      productPhase: deriveProductPhase(value),
      variant: deriveVariant(value),
      recommendation: deriveRecommendation(value),
      tryOnPipeline: deriveTryOnPipeline(value),
      productId:
        typeof id === "string" && id.length <= 256 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null,
      variantResolved: selectionMatchStatus(value.context),
    });
  } catch {
    return null;
  }
}
