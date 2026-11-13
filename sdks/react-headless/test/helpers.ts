import type { StudioVaaiClient } from "@studio-vaai/js-client";
import type { BodyId, ProductId, SessionHandle, TryOnId } from "@studio-vaai/js-client";
import type {
  TryOnFlowProduct,
  TryOnFlowProductVariant,
  TryOnProductColorwayOption,
  TryOnProductSizeOption,
} from "@studio-vaai/js-machine";
import type { AnyActorRef } from "xstate";

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

/** First child actor (e.g. invoked machine) from a parent snapshot. */
export function firstChildActor(actor: AnyActorRef): AnyActorRef | undefined {
  const raw = actor.getSnapshot().children as
    | Map<string, AnyActorRef>
    | Record<string, AnyActorRef>;
  if (raw instanceof Map) {
    return [...raw.values()].find((child) => child.id !== "sessionRetention");
  }
  const values = Object.values(raw ?? {});
  return values.find((child) => child.id !== "sessionRetention");
}

export function createMockClient(overrides: Partial<StudioVaaiClient> = {}): StudioVaaiClient {
  const base: StudioVaaiClient = {
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
        data: { recommendedSize: "M" },
      }),
      createTryOn: async () => ({
        ok: true,
        data: {
          status: "success",
          tryOnId: testTryOn,
          imageUrl: "https://example.com/t.png",
          scene: { overlayColor: "#09090b" },
        },
      }),
      getTryOn: async () => ({
        ok: true,
        data: {
          status: "success",
          tryOnId: testTryOn,
          imageUrl: "https://example.com/t.png",
          scene: { overlayColor: "#09090b" },
        },
      }),
    },
    analytics: { createTrackingClient: () => ({ trackEvent: () => ({ ok: true }) }) },
    experiments: {
      evaluateFlag: async (args) => ({
        ok: true,
        data: { key: args.key, value: true, reason: "STATIC" },
      }),
      evaluateFlagsBulk: async () => ({
        ok: true,
        data: { notModified: false, etag: '"mock"', flags: [] },
      }),
      getTryOnDecision: async () => ({ ok: true, data: { enabled: true, variant: "enabled" } }),
    },
  };
  return { ...base, ...overrides };
}
