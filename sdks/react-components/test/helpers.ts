import type {
  BodyId,
  FitAnchor,
  FitCheck,
  ProductId,
  RecommendedSizeData,
  SessionHandle,
  SizeRecommendation,
  StudioVaaiClient,
  TryOnId,
} from "@studio-vaai/js-client";
import type {
  TryOnFlowProduct,
  TryOnFlowProductVariant,
  TryOnProductColorwayOption,
  TryOnProductSizeOption,
} from "@studio-vaai/js-machine";

/** Browser and Node compatible (Storybook runs in the browser; avoid `node:timers/promises`). */
async function sleepMs(ms: number): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- setTimeout-based delay for browser + Vitest
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const testSession = "sess-test-1" as SessionHandle;
export const testBody = "body-test-1" as BodyId;
export const testProductId = "prod-test-1" as ProductId;
export const testTryOn = "tryon-test-1" as TryOnId;

const TEST_COLORS: TryOnProductColorwayOption[] = [
  { slug: "black", label: "Schwarz", hex: "#111111" },
  { slug: "espresso", label: "Espresso", hex: "#3d2c24" },
  { slug: "beige", label: "Beige", hex: "#d4c4b0", swatchRing: true },
  { slug: "navy", label: "Marine", hex: "#1e293b" },
];

const TEST_SIZES: TryOnProductSizeOption[] = [
  { slug: "xs", label: "XS" },
  { slug: "s", label: "S" },
  { slug: "m", label: "M" },
  { slug: "l", label: "L" },
  { slug: "xl", label: "XL" },
];

function buildTestVariants(): TryOnFlowProductVariant[] {
  const variants: TryOnFlowProductVariant[] = [];
  for (const size of TEST_SIZES) {
    for (const color of TEST_COLORS) {
      variants.push({
        id: `v-${size.slug}-${color.slug}`,
        attributes: { size: size.slug, colorway: color.slug },
      });
    }
  }
  return variants;
}

export const testProduct: TryOnFlowProduct = {
  id: testProductId,
  displayName: "Test Product",
  variants: buildTestVariants(),
  attributeMetadata: {
    colorways: TEST_COLORS,
    sizes: TEST_SIZES,
  },
};

// ── Size-recommendation fixture ────────────────────────────────────────────────
// A realistic Dariadeh-long-shirt-shaped recommendation so the fit panel + image
// callouts render with a mock client (no backend). One girth column (chest) drives
// the pick; two length columns are display-only. `m` is the calibrated ideal.

/** Fit-panel columns, in authored order: one girth + two lengths. */
const FIT_COLUMNS: { pointId: string; label: string; dimension: string; bodyMm: number }[] = [
  { pointId: "chest_width", label: "Chest Width", dimension: "chest", bodyMm: 970 },
  { pointId: "waist_width", label: "Waist", dimension: "waist", bodyMm: 800 },
  { pointId: "total_length", label: "Total Length", dimension: "total_length", bodyMm: 640 },
  { pointId: "sleeve_length", label: "Sleeve Length", dimension: "sleeve_length", bodyMm: 600 },
];

// Normalized image positions of each column's callout dot (x right, y down) for the striped
// long-shirt render (A-pose): chest mid-torso, waist lower, sleeve on the right cuff, total at hem.
export const testFitAnchors: readonly FitAnchor[] = [
  { dimension: "chest", x: 0.46, y: 0.4 },
  { dimension: "waist", x: 0.44, y: 0.52 },
  { dimension: "sleeve_length", side: "right", x: 0.71, y: 0.5 },
  { dimension: "total_length", x: 0.55, y: 0.57 },
];

function verdictForNorm(norm: number): string {
  if (norm <= -1.5) {
    return "too_small";
  }
  if (norm <= -0.6) {
    return "runs_tight";
  }
  if (norm >= 1.5) {
    return "too_loose";
  }
  if (norm >= 0.6) {
    return "runs_loose";
  }
  return "ideal";
}

function lengthEaseNorm(dimension: string): number {
  return dimension === "sleeve_length" ? -0.15 : 0.1;
}

/** `stepFromIdeal` = size steps away from the calibrated pick (`m` = 0). */
function fitChecksForStep(stepFromIdeal: number): readonly FitCheck[] {
  return FIT_COLUMNS.map((c) => {
    const isLength = c.dimension === "total_length" || c.dimension === "sleeve_length";
    // Chest is the girth driver (~0.95 tol-units per grade step); lengths barely move with size.
    const easeNorm = isLength ? lengthEaseNorm(c.dimension) : 0.15 + stepFromIdeal * 0.95;
    const idealShiftNorm = isLength ? 0 : 0.2; // relaxed cut, fit-model-calibrated center
    const garmentMm =
      c.bodyMm + Math.round((easeNorm - idealShiftNorm) * 50 + (isLength ? 10 : 110));
    return {
      pointId: c.pointId,
      label: c.label,
      dimension: c.dimension,
      garmentMm,
      bodyMm: c.bodyMm,
      easeMm: garmentMm - c.bodyMm,
      easeNorm,
      idealShiftNorm,
      intentSigmaNorm: 0.28,
      fit: isLength ? "ideal" : verdictForNorm(easeNorm),
      sentence: "",
    } satisfies FitCheck;
  });
}

// Already in rank order (best fit first) so no sort is needed.
const SIZE_STEPS: { size: string; step: number; fitMatch: number }[] = [
  { size: "m", step: 0, fitMatch: 97 },
  { size: "s", step: -1, fitMatch: 82 },
  { size: "l", step: 1, fitMatch: 84 },
  { size: "xs", step: -2, fitMatch: 58 },
  { size: "xl", step: 2, fitMatch: 61 },
];

/** Full ranked recommendation used by the mock client (and stories/tests). */
export const testRecommendation: RecommendedSizeData = {
  recommendedSize: "m",

  recommendations: SIZE_STEPS.map((s, i): SizeRecommendation => {
    const checks: readonly FitCheck[] = fitChecksForStep(s.step);
    const chest: FitCheck | undefined = checks.find((c) => c.dimension === "chest");
    const chestEaseMm: number = chest?.easeMm ?? 0;
    const chestNorm: number = chest?.easeNorm ?? 0;
    return {
      size: s.size,
      rank: i + 1,
      rationale: `Chest sits at ${chestEaseMm >= 0 ? "+" : ""}${Math.round(chestEaseMm / 10)} cm ease`,
      fit: verdictForNorm(chestNorm),
      fitMatch: s.fitMatch,
      fitChecks: checks,
    };
  }),
};

export interface CreateMockClientOptions {
  /** Artificial delay before `createBody` resolves (e.g. Storybook: visible session-intro upload). Default 0 for unit tests. */
  createBodyDelayMs?: number;
  /** Artificial delay before `setBodyHeight` resolves (e.g. Storybook: visible height step busy). Default 0 for unit tests. */
  setBodyHeightDelayMs?: number;
  /** Artificial delay before `tryOn.createTryOn` resolves (e.g. Storybook: product step try-on busy). Default 0 for unit tests. */
  createTryOnDelayMs?: number;
}

export function createMockClient(
  overrides: Partial<StudioVaaiClient> = {},
  options: CreateMockClientOptions = {},
): StudioVaaiClient {
  const { createBodyDelayMs = 0, setBodyHeightDelayMs = 0, createTryOnDelayMs = 0 } = options;
  const base: StudioVaaiClient = {
    analytics: { createTrackingClient: () => ({ trackEvent: () => ({ ok: true }) }) },
    meta: {
      getHealth: async () => ({ ok: true, data: { status: "healthy" } }),
    },
    session: {
      createSession: async () => ({
        ok: true,
        data: { session: testSession },
      }),
      getSession: async () => ({ ok: true, data: { session: testSession } }),
      refreshSession: async () => ({ ok: true, data: { session: testSession } }),
      invalidateSession: async () => ({ ok: true, data: {} }),
    },
    body: {
      listBodies: async () => ({ ok: true, data: { bodies: [] } }),
      createBody: async () => ({
        ok: true,
        data: {
          status: "ready",
          created: {
            body: {
              bodyId: testBody,
              createdAt: "",
              estimatedHeightCm: 170,
              sourceImageUrl: "https://mock.test/source.jpg",
              sourceImageUrlExpiresAt: "2026-12-01T12:00:00Z",
            },
            heightCm: 170,
          },
        },
      }),
      setBodyHeight: async () => ({ ok: true, data: {} }),
    },
    tryOn: {
      getRecommendedSize: async () => ({
        ok: true,
        data: testRecommendation,
      }),
      createTryOn: async () => ({
        ok: true,
        data: {
          status: "success",
          tryOnId: testTryOn,
          imageUrl: "https://example.com/t.png",
          scene: { overlayColor: "#09090b" },
          fitAnchors: testFitAnchors,
        },
      }),
      getTryOn: async () => ({
        ok: true,
        data: {
          status: "success",
          tryOnId: testTryOn,
          imageUrl: "https://example.com/t.png",
          scene: { overlayColor: "#09090b" },
          fitAnchors: testFitAnchors,
        },
      }),
    },
  };
  const merged = { ...base, ...overrides };
  if (createBodyDelayMs <= 0 && setBodyHeightDelayMs <= 0 && createTryOnDelayMs <= 0) {
    return merged;
  }
  let body = merged.body;
  if (createBodyDelayMs > 0) {
    const runCreateBody = body.createBody.bind(body);
    body = {
      ...body,
      createBody: async (...args: Parameters<typeof runCreateBody>) => {
        await sleepMs(createBodyDelayMs);
        return await runCreateBody(...args);
      },
    };
  }
  if (setBodyHeightDelayMs > 0) {
    const runCalibrate = body.setBodyHeight.bind(body);
    body = {
      ...body,
      setBodyHeight: async (...args: Parameters<typeof runCalibrate>) => {
        await sleepMs(setBodyHeightDelayMs);
        return await runCalibrate(...args);
      },
    };
  }
  let tryOn = merged.tryOn;
  if (createTryOnDelayMs > 0) {
    const runCreateTryOn = tryOn.createTryOn.bind(tryOn);
    tryOn = {
      ...tryOn,
      createTryOn: async (...args: Parameters<typeof runCreateTryOn>) => {
        await sleepMs(createTryOnDelayMs);
        return await runCreateTryOn(...args);
      },
    };
  }
  return { ...merged, body, tryOn };
}
