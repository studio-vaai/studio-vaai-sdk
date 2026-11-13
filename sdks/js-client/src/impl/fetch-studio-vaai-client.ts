import { createFetchTrackingClient } from "@studio-vaai/js-tracking";

import type { BodyCreateResult } from "../api/body.js";
import type { ProductDetails } from "../api/catalog.js";
import type { SessionTransportPreference } from "../api/session.js";
import type { RecommendedSizeData, SizeRecommendation, TryOnResult } from "../api/try-on.js";
import type { ApiFailure, ApiResult, BodyValidationCode, StandardError } from "../base.js";
import type { ClientConfig, StudioVaaiClient, SessionActivity } from "../client.js";
import type { SessionHandle } from "../types.js";
import type {
  BodyReady,
  HealthStatus,
  ListBodiesResponse,
  PrepareBodyUploadResponse,
  ProductCatalog as ApiProductCatalog,
  ProductDetails as ApiProductDetails,
  RecommendedSize as ApiRecommendedSize,
  TryOnSuccess as ApiTryOnResult,
} from "./generated/types.gen.js";

import { asBodyValidationCode } from "../base.js";
import { API_VERSION, CLIENT_VERSION_HEADER_VALUE, HEADER_CLIENT_VERSION } from "../client.js";
import { ImageInputError } from "../image-limits.js";
import { sizeKeyOf } from "../size-key.js";
import { bodyIdFromApi, productIdFromApi, tryOnIdFromApi } from "../types.js";
import { createClient } from "./generated/client/index.js";
import {
  setBodyHeight,
  createBody as httpCreateBody,
  createTryOn as httpCreateTryOn,
  getHealth,
  getProductByForeignId,
  getProductDetails,
  listProducts,
  getRecommendedSize,
  getTryOn,
  evaluateFlag,
  evaluateFlagsBulk,
  listBodies,
  prepareBodyUpload,
} from "./generated/sdk.gen.js";
import { unwrapProblemOrUnknown } from "./http-result.js";
import { imageInputToBytes } from "./image-input.js";
import { prepareImageForUpload } from "./prepare-upload.js";
import {
  httpStatusToKind,
  networkError,
  problemDetailsToStandardError,
} from "./problem-details.js";
import { createSessionTransport } from "./session-transport.js";

function narrowValidationCode(code: string): BodyValidationCode {
  switch (code) {
    case "no_human_detected": {
      return asBodyValidationCode("no_human_detected");
    }
    case "human_occluded": {
      return asBodyValidationCode("human_occluded");
    }
    case "human_not_standing": {
      return asBodyValidationCode("human_not_standing");
    }
    case "human_too_small": {
      return asBodyValidationCode("human_too_small");
    }
    case "inappropriate_clothing": {
      return asBodyValidationCode("inappropriate_clothing");
    }
    default: {
      // Server newer than this client returned an unknown code. Default to
      // `no_human_detected` so UI layers always render a sensible fallback —
      // they should never see a code outside the union.
      return asBodyValidationCode("no_human_detected");
    }
  }
}

export interface FetchStudioVaaiClientConfig extends ClientConfig {
  /** Analytics collection base URL; defaults to https://a.studio-vaai.com. */
  analyticsBaseUrl?: string;
  /** Base URL of the studio vaai HTTP API (no trailing slash). */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** New-session policy. Omitted = auto: browsers prepare and attempt cookie creation, while native/server clients use bearer. Cookie mode never falls back. */
  sessionTransport?: SessionTransportPreference;
  /**
   * Ask for `provenance` on product details and try-ons (`include=provenance`): where each
   * came from (library revision, publication, stored drape, builds). Off by default, and then
   * the requests and responses are exactly as without the feature. A diagnostic for reviewers.
   */
  includeProvenance?: boolean;
}

function defaultHeaders(): Headers {
  const h = new Headers();
  h.set(HEADER_CLIENT_VERSION, CLIENT_VERSION_HEADER_VALUE);
  return h;
}

/** Public API shop headers: `X-Client-Api-Key` plus contract version. */
function shopAndVersionHeaders(clientApiKey: string): {
  "X-Client-Api-Key": string;
  "X-Api-Version": string;
} {
  return {
    "X-Client-Api-Key": clientApiKey,
    "X-Api-Version": API_VERSION,
  };
}

function mapTryOnTerminal(value: ApiTryOnResult): TryOnResult | null {
  if (value.status === "completed") {
    return {
      status: "success",
      tryOnId: tryOnIdFromApi(value.tryOnId),
      ...(typeof value.variantId === "undefined" ? {} : { variantId: value.variantId }),
      imageUrl: value.imageUrl,
      scene: { overlayColor: value.scene.overlayColor },
      ...(typeof value.fitAnchors === "undefined" ? {} : { fitAnchors: value.fitAnchors }),
      ...(typeof value.provenance === "undefined" ? {} : { provenance: value.provenance }),
    };
  }
  return null;
}

async function putStagingObject(args: {
  prepare: PrepareBodyUploadResponse;
  bytes: Uint8Array;
  signal: AbortSignal | undefined;
  fetchImpl: typeof fetch;
}): Promise<StandardError | null> {
  let init: RequestInit;
  try {
    const headers = new Headers();
    for (const h of args.prepare.requiredHeaders) {
      headers.set(h.name, h.value);
    }
    init = {
      method: args.prepare.method,
      credentials: "omit",
      headers,
      body: new Blob([Uint8Array.from(args.bytes)]),
    };
    if (typeof args.signal !== "undefined") {
      init.signal = args.signal;
    }
  } catch {
    return networkError("Staging upload failed");
  }
  let res: Response;
  try {
    res = await args.fetchImpl(args.prepare.uploadUrl, init);
  } catch {
    return networkError("Staging upload failed");
  }
  if (!res.ok) {
    try {
      await res.body?.cancel();
    } catch {
      /* Do not surface an unreviewed storage error body. */
    }
    return {
      kind: "unknown",
      message: `Staging upload failed with HTTP ${String(res.status)}`,
      details: { httpStatus: res.status },
    };
  }
  return null;
}

function isForeignIds(value: unknown): value is Readonly<Record<string, string>> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((id) => typeof id === "string")
  );
}

function tryOnResponse(raw: {
  data?: ApiTryOnResult;
  error?: unknown;
  response?: Response;
}): ApiResult<TryOnResult> {
  if (
    raw.response?.status === 422 &&
    raw.error !== null &&
    typeof raw.error === "object" &&
    "kind" in raw.error &&
    raw.error.kind === "try-on-size-rejected" &&
    "reason" in raw.error &&
    (raw.error.reason === "garment_too_small" || raw.error.reason === "garment_too_large")
  ) {
    // Absent when the shop sells no size in that direction: no alternative to offer.
    const recommendedSize =
      "recommendedForeignIds" in raw.error && isForeignIds(raw.error.recommendedForeignIds)
        ? sizeKeyOf(raw.error.recommendedForeignIds)
        : "";
    return {
      ok: true,
      data: { status: "error", reason: { kind: raw.error.reason, recommendedSize } },
    };
  }
  const result = unwrapProblemOrUnknown(raw, problemDetailsToStandardError);
  if (!result.ok) {
    return result;
  }
  const mapped = mapTryOnTerminal(result.data);
  return mapped
    ? { ok: true, data: mapped }
    : { ok: false, error: { kind: "unknown", message: "Invalid try-on response" } };
}

function ofrepFailure(raw: { error?: unknown; response?: Response }): ApiFailure<StandardError> {
  let message = "Feature evaluation failed";
  if (
    typeof raw.error === "object" &&
    raw.error !== null &&
    "errorDetails" in raw.error &&
    typeof raw.error.errorDetails === "string"
  ) {
    message = raw.error.errorDetails;
  }
  return {
    ok: false,
    error: { kind: httpStatusToKind(raw.response?.status ?? 0), message, details: raw.error },
  };
}

/** The `include=provenance` query when the client opts in; nothing (no `?`) otherwise. */
type ProvenanceQuery = { query: { include: string } } | Record<string, never>;

function provenanceQueryFor(includeProvenance: boolean | undefined): ProvenanceQuery {
  return includeProvenance === true ? { query: { include: "provenance" } } : {};
}

/** The wire details in the client's shape: product id branded. */
function productDetailsFromApi({ productId, ...details }: ApiProductDetails): ProductDetails {
  return { ...details, productId: productIdFromApi(productId) };
}

/** The wire recommendation in the client's shape: every size also named by its size key. */
function recommendedSizeFromApi({
  recommendedForeignIds,
  recommendations,
}: ApiRecommendedSize): RecommendedSizeData {
  return {
    recommendations: recommendations.map(
      ({ foreignIds, ...recommendation }): SizeRecommendation => ({
        ...recommendation,
        size: sizeKeyOf(foreignIds),
        options: foreignIds,
      }),
    ),
    ...(typeof recommendedForeignIds === "undefined"
      ? {}
      : {
          recommendedSize: sizeKeyOf(recommendedForeignIds),
          recommendedOptions: recommendedForeignIds,
        }),
  };
}

const DEFAULT_BASE_URL = "https://api.studio-vaai.com";

/**
 * HTTP transport for {@link StudioVaaiClient} using the OpenAPI `2026-11-05` contract
 * (Hey API generated fetch SDK under `src/impl/generated/`).
 */
export function createFetchStudioVaaiClient(config: FetchStudioVaaiClientConfig): StudioVaaiClient {
  // Bind so bare calls like `fetchImpl(url, init)` never hit "Illegal invocation" (native fetch requires Window `this`).
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  const activityListeners = new Set<(activity: SessionActivity) => void>();
  let requestSequence = 0;
  const withSessionActivity = async <T extends { response?: Response; error?: unknown }>(
    session: SessionHandle,
    request: () => Promise<T>,
  ): Promise<T> => {
    const startedAt = Date.now();
    requestSequence += 1;
    const requestId = requestSequence;
    const notify = (phase: SessionActivity["phase"], accepted: boolean) => {
      for (const listener of activityListeners) {
        try {
          listener({ session, requestId, startedAt, phase, accepted });
        } catch {
          // An observer must not alter request delivery or other subscribers.
        }
      }
    };
    notify("started", false);
    try {
      const result = await request();
      const { error } = result;
      // These terminal outcomes follow admission to processing even though the
      // requested photo/calibration/size could not produce a usable result.
      const processingRejection =
        result.response?.status === 422 &&
        typeof error === "object" &&
        error !== null &&
        "kind" in error &&
        (error.kind === "body-validation-failed" ||
          error.kind === "body-unusable" ||
          error.kind === "height-calibration-failed" ||
          error.kind === "try-on-size-rejected");
      notify("settled", result.response?.ok === true || processingRejection);
      return result;
    } catch (error) {
      notify("settled", false);
      throw error;
    }
  };
  const provenanceQuery = provenanceQueryFor(config.includeProvenance);
  const http = createClient({
    baseUrl: config.baseUrl?.replace(/\/$/, "") ?? DEFAULT_BASE_URL,
    fetch: fetchImpl,
    credentials: "omit",
    headers: defaultHeaders(),
  });

  const meta: StudioVaaiClient["meta"] = {
    getHealth: async (_args, options) => {
      const raw = await getHealth({
        client: http,
        signal: options?.signal,
      });
      return unwrapProblemOrUnknown<HealthStatus>(raw, problemDetailsToStandardError);
    },
  };

  const sessionTransport = createSessionTransport({
    http,
    headers: shopAndVersionHeaders(config.clientApiKey),
    mode: config.sessionTransport ?? "auto",
    // Native/server clients use bearer in auto mode. Explicit cookie mode can
    // still be used with a caller-provided cookie-aware transport.
    browser: typeof globalThis.document !== "undefined",
    scope: `${config.baseUrl?.replace(/\/$/, "") ?? DEFAULT_BASE_URL}|${config.clientApiKey}`,
  });
  const session = sessionTransport.api;
  const sessionOptions = sessionTransport.requestOptions;

  const body: StudioVaaiClient["body"] = {
    listBodies: async (args, options) => {
      const raw = await listBodies({
        client: http,
        ...sessionOptions(args.session),
        headers: shopAndVersionHeaders(config.clientApiKey),
        signal: options?.signal,
      });
      const out = unwrapProblemOrUnknown<ListBodiesResponse>(raw, problemDetailsToStandardError);
      if (!out.ok) {
        return out;
      }
      return {
        ok: true,
        data: {
          bodies: out.data.bodies.map((b) => ({
            ...b,
            bodyId: bodyIdFromApi(b.bodyId),
          })),
        },
      };
    },
    createBody: async (args, options): Promise<ApiResult<BodyCreateResult>> => {
      // Downscale oversized camera-roll photos before upload (the server keeps
      // only a low-resolution image) and read the original's camera EXIF so
      // focal length survives that downscale. No-op in Node / for already-small
      // images.
      let prepared;
      let normalized;
      try {
        prepared = await prepareImageForUpload(args.image, args.imageMetadata, options?.signal);
        normalized = await imageInputToBytes(prepared.image, options?.signal);
      } catch (error) {
        return {
          ok: false,
          error: {
            kind: error instanceof ImageInputError ? "validation_error" : "unknown",
            message: error instanceof ImageInputError ? error.message : "Unable to prepare photo.",
          },
        };
      }
      const prepareRaw = await prepareBodyUpload({
        client: http,
        ...sessionOptions(args.session),
        headers: shopAndVersionHeaders(config.clientApiKey),
        body: {
          contentType: normalized.mimeType,
          byteSize: normalized.data.byteLength,
        },
        signal: options?.signal,
      });
      const prepareUn = unwrapProblemOrUnknown<PrepareBodyUploadResponse>(
        prepareRaw,
        problemDetailsToStandardError,
      );
      if (!prepareUn.ok) {
        return prepareUn;
      }
      const putErr = await putStagingObject({
        prepare: prepareUn.data,
        bytes: normalized.data,
        signal: options?.signal,
        fetchImpl,
      });
      if (putErr !== null) {
        return { ok: false, error: putErr };
      }
      const finalizeRaw = await withSessionActivity(
        args.session,
        async () =>
          await httpCreateBody({
            client: http,
            ...sessionOptions(args.session),
            headers: shopAndVersionHeaders(config.clientApiKey),
            body: {
              stagingKey: prepareUn.data.stagingKey,
              mimeType: normalized.mimeType,
              ...(prepared.imageMetadata && { imageMetadata: prepared.imageMetadata }),
            },
            signal: options?.signal,
          }),
      );
      if (
        finalizeRaw.response?.status === 422 &&
        finalizeRaw.error &&
        "reason" in finalizeRaw.error &&
        finalizeRaw.error.kind === "body-validation-failed"
      ) {
        return {
          ok: true,
          data: {
            status: "failed",
            failure: {
              kind: "validation",
              code: narrowValidationCode(finalizeRaw.error.reason),
              ...(typeof finalizeRaw.error.detail === "string" &&
              finalizeRaw.error.detail.length > 0
                ? { message: finalizeRaw.error.detail }
                : {}),
            },
          },
        };
      }
      const finalizeUn = unwrapProblemOrUnknown<BodyReady>(
        finalizeRaw,
        problemDetailsToStandardError,
      );
      if (!finalizeUn.ok) {
        return finalizeUn;
      }
      const b = finalizeUn.data.body;
      const estimated = b.estimatedHeightCm;
      return {
        ok: true,
        data: {
          status: "ready",
          created: {
            body: {
              bodyId: bodyIdFromApi(b.bodyId),
              createdAt: b.createdAt,
              estimatedHeightCm: b.estimatedHeightCm,
              sourceImageUrl: b.sourceImageUrl,
              sourceImageUrlExpiresAt: b.sourceImageUrlExpiresAt,
            },
            heightCm: estimated,
          },
        },
      };
    },
    setBodyHeight: async (args, options) => {
      const raw = await withSessionActivity(
        args.session,
        async () =>
          await setBodyHeight({
            client: http,
            ...sessionOptions(args.session),
            headers: shopAndVersionHeaders(config.clientApiKey),
            path: { bodyId: args.bodyId },
            body: {
              heightCm: args.heightCm,
              productId: args.productId,
            },
            signal: options?.signal,
          }),
      );
      if (raw.response?.status === 204) {
        return { ok: true, data: {} };
      }
      const out = unwrapProblemOrUnknown(raw, problemDetailsToStandardError);
      return out.ok
        ? { ok: false, error: { kind: "unknown", message: "Expected 204 from setBodyHeight" } }
        : out;
    },
  };

  const tryOn: StudioVaaiClient["tryOn"] = {
    getRecommendedSize: async (args, options) => {
      const raw = await getRecommendedSize({
        client: http,
        ...sessionOptions(args.session),
        headers: shopAndVersionHeaders(config.clientApiKey),
        path: { productId: args.productId },
        query: { bodyId: args.bodyId },
        signal: options?.signal,
      });
      const out = unwrapProblemOrUnknown<ApiRecommendedSize>(raw, problemDetailsToStandardError);
      return out.ok ? { ok: true, data: recommendedSizeFromApi(out.data) } : out;
    },
    createTryOn: async (args, options) => {
      const raw = await withSessionActivity(
        args.session,
        async () =>
          await httpCreateTryOn({
            client: http,
            ...sessionOptions(args.session),
            headers: shopAndVersionHeaders(config.clientApiKey),
            path: { productId: args.productId },
            body: { variantId: args.variantId },
            query: {
              bodyId: args.bodyId,
              ...("query" in provenanceQuery ? provenanceQuery.query : {}),
            },
            signal: options?.signal,
          }),
      );
      return tryOnResponse(raw);
    },
    getTryOn: async (args, options) =>
      tryOnResponse(
        await getTryOn({
          client: http,
          ...sessionOptions(args.session),
          headers: shopAndVersionHeaders(config.clientApiKey),
          path: { tryOnId: args.tryOnId },
          ...provenanceQuery,
          signal: options?.signal,
        }),
      ),
  };

  const analytics: StudioVaaiClient["analytics"] = {
    createTrackingClient: (options) =>
      createFetchTrackingClient({
        ...options,
        clientApiKey: config.clientApiKey,
        ...(typeof config.analyticsBaseUrl === "undefined"
          ? {}
          : { baseUrl: config.analyticsBaseUrl }),
        ...(typeof config.fetch === "undefined" ? {} : { fetch: config.fetch }),
      }),
  };

  const experiments: StudioVaaiClient["experiments"] = {
    evaluateFlag: async (args, options) => {
      const raw = await evaluateFlag({
        client: http,
        credentials: "omit",
        headers: { "X-API-Key": config.clientApiKey },
        path: { key: args.key },
        body: { context: args.context },
        signal: options?.signal,
      });
      if (raw.data) {
        return { ok: true, data: raw.data };
      }
      return ofrepFailure(raw);
    },
    evaluateFlagsBulk: async (args, options) => {
      const raw = await evaluateFlagsBulk({
        client: http,
        credentials: "omit",
        headers: {
          "X-API-Key": config.clientApiKey,
          ...(typeof args.ifNoneMatch === "string" ? { "If-None-Match": args.ifNoneMatch } : {}),
        },
        body: { context: args.context },
        signal: options?.signal,
      });
      if (raw.response?.status !== 200 && raw.response?.status !== 304) {
        return ofrepFailure(raw);
      }
      const etag = raw.response.headers.get("ETag");
      if (etag === null || etag.length === 0) {
        return {
          ok: false,
          error: { kind: "unknown", message: "Bulk evaluation response is missing ETag" },
        };
      }
      if (raw.response?.status === 304) {
        return { ok: true, data: { notModified: true, etag } };
      }
      if (raw.data) {
        return { ok: true, data: { notModified: false, flags: raw.data.flags, etag } };
      }
      return ofrepFailure(raw);
    },
    getTryOnDecision: async (args, options) => {
      const result = await experiments.evaluateFlag(
        { key: "try-on-enabled", context: { targetingKey: args.visitorId } },
        options,
      );
      if (!result.ok) {
        return result;
      }
      if (typeof result.data.value !== "boolean") {
        return { ok: false, error: { kind: "unknown", message: "Expected boolean try-on flag" } };
      }
      return {
        ok: true,
        data: { enabled: result.data.value, variant: result.data.value ? "enabled" : "disabled" },
      };
    },
  };

  const catalog: NonNullable<StudioVaaiClient["catalog"]> = {
    listProducts: async (_args, options) => {
      const raw = await listProducts({
        client: http,
        headers: shopAndVersionHeaders(config.clientApiKey),
        signal: options?.signal,
      });
      const out = unwrapProblemOrUnknown<ApiProductCatalog>(raw, problemDetailsToStandardError);
      if (!out.ok) {
        return out;
      }
      return {
        ok: true,
        data: out.data.products.map((product) => productIdFromApi(product.productId)),
      };
    },
    getProductDetails: async (args, options) => {
      const raw = await getProductDetails({
        client: http,
        headers: shopAndVersionHeaders(config.clientApiKey),
        path: { productId: args.productId },
        ...provenanceQuery,
        signal: options?.signal,
      });
      const out = unwrapProblemOrUnknown<ApiProductDetails>(raw, problemDetailsToStandardError);
      return out.ok ? { ok: true, data: productDetailsFromApi(out.data) } : out;
    },
    getProductByForeignId: async (args, options) => {
      const raw = await getProductByForeignId({
        client: http,
        headers: shopAndVersionHeaders(config.clientApiKey),
        path: { foreignId: args.foreignId },
        ...provenanceQuery,
        signal: options?.signal,
      });
      const out = unwrapProblemOrUnknown<ApiProductDetails>(raw, problemDetailsToStandardError);
      return out.ok ? { ok: true, data: productDetailsFromApi(out.data) } : out;
    },
  };

  return {
    meta,
    session,
    body,
    analytics,
    tryOn,
    experiments,
    catalog,
    onSessionActivity: (listener) => {
      activityListeners.add(listener);
      return () => {
        activityListeners.delete(listener);
      };
    },
  };
}
