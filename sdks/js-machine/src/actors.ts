import type {
  BodyId,
  BodyValidationFailure,
  ProductId,
  SessionHandle,
  TryOnId,
  TryOnResult,
} from "@studio-vaai/js-client";

import { ApiFailureError, type StandardError, type StudioVaaiClient } from "@studio-vaai/js-client";
import { fromPromise } from "xstate";

import type { CreateBodyLikeError } from "./context/index.js";
import type { SessionPersistenceAdapter } from "./session-persistence.js";

/**
 * Thrown by {@link createBodyActor} when the server rejected the image (typed validation
 * failure). Surfaced internally so the photo-upload machine can route to its `rejected`
 * state via {@link isCreateBodyDomainError}; not part of the public API.
 */
class BodyCreateValidationFailedError extends Error {
  readonly failure: BodyValidationFailure;
  constructor(failure: BodyValidationFailure) {
    super(failure.message ?? failure.code);
    this.name = "BodyCreateValidationFailedError";
    this.failure = failure;
  }
}

function assertOk<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-call -- ApiFailureError is a concrete subclass of Error from js-client
    throw new ApiFailureError(result.error);
  }
  return result.data;
}

/** Unwrap {@link ApiFailureError} from actors; safe for nested checks. */
export function unwrapApiFailure(e: unknown): unknown {
  return e instanceof ApiFailureError ? e.failure : e;
}

function isStandardErrorShape(e: unknown): e is StandardError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    typeof (e as { kind: unknown }).kind === "string" &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  );
}

/** Map `onError` `event.error` (possibly {@link ApiFailureError}) to {@link StandardError}. */
export function transportErrorFromActor(e: unknown): StandardError {
  const err = unwrapApiFailure(e);
  if (isStandardErrorShape(err)) {
    return err;
  }
  return { kind: "unknown", message: String(err) };
}

export const createSessionActor = fromPromise(
  async ({ input, signal }: { input: { client: StudioVaaiClient }; signal: AbortSignal }) => {
    const data = assertOk(
      await input.client.session.createSession({ dataProcessingConsent: true }, { signal }),
    );
    return data;
  },
);

export type RestoreSessionOutput =
  | { kind: "restored"; session: SessionHandle; expiresAt?: string | undefined }
  | { kind: "none" };

/** Validate persisted handle via {@link SessionApi.getSession}; clears storage on failure. */
export const restoreSessionActor = fromPromise(
  async ({
    input,
    signal,
  }: {
    signal: AbortSignal;
    input: { client: StudioVaaiClient; persistence: SessionPersistenceAdapter };
  }): Promise<RestoreSessionOutput> => {
    const handle = input.persistence.read();
    if (handle === undefined) {
      return { kind: "none" };
    }
    const result = await input.client.session.getSession({ session: handle }, { signal });
    if (!result.ok) {
      input.persistence.clear();
      return { kind: "none" };
    }
    return { kind: "restored", session: result.data.session, expiresAt: result.data.expiresAt };
  },
);

/** Output of {@link createBodyActor}; predicted height comes from {@link BodyApi.createBody}. */
export interface CreateBodyActorOutput {
  bodyId: BodyId;
  heightCm: number;
}

export const createBodyActor = fromPromise(
  async ({
    input,
    signal,
  }: {
    signal: AbortSignal;
    input: {
      client: StudioVaaiClient;
      session: SessionHandle;
      image:
        | { type: "blob"; blob: Blob; previewBlob?: Blob }
        | { type: "file"; file: File; previewBlob?: Blob };
    };
  }): Promise<CreateBodyActorOutput> => {
    const result = assertOk(
      await input.client.body.createBody(
        {
          session: input.session,
          image: input.image,
        },
        { signal },
      ),
    );
    if (result.status === "failed") {
      throw new BodyCreateValidationFailedError(result.failure);
    }
    const heightCm = result.created.heightCm;
    if (!Number.isFinite(heightCm) || heightCm <= 0) {
      throw new Error("createBody: invalid heightCm from API");
    }
    return { bodyId: result.created.body.bodyId, heightCm };
  },
);

export const setBodyHeightActor = fromPromise(
  async ({
    input,
    signal,
  }: {
    signal: AbortSignal;
    input: {
      client: StudioVaaiClient;
      session: SessionHandle;
      bodyId: BodyId;
      heightCm: number;
      productId?: ProductId | undefined;
    };
  }) => {
    assertOk(
      await input.client.body.setBodyHeight(
        {
          session: input.session,
          bodyId: input.bodyId,
          heightCm: input.heightCm,
          productId: input.productId,
        },
        { signal },
      ),
    );
    return input.bodyId;
  },
);

export const getRecommendedSizeActor = fromPromise(
  async ({
    input,
    signal,
  }: {
    signal: AbortSignal;
    input: {
      client: StudioVaaiClient;
      session: SessionHandle;
      bodyId: BodyId;
      productId: ProductId;
    };
  }) => {
    const data = assertOk(
      await input.client.tryOn.getRecommendedSize(
        {
          session: input.session,
          bodyId: input.bodyId,
          productId: input.productId,
        },
        { signal },
      ),
    );
    // The full recommendation (rank-1 size key + the ranked shortlist with rationale + fit), so the UI can
    // default to the recommended size and show why.
    return data;
  },
);

export const createTryOnActor = fromPromise(
  async ({
    input,
    signal,
  }: {
    signal: AbortSignal;
    input: {
      client: StudioVaaiClient;
      session: SessionHandle;
      bodyId: BodyId;
      productId: ProductId;
      variantId: string;
    };
  }) => {
    const result = await input.client.tryOn.createTryOn(
      {
        session: input.session,
        bodyId: input.bodyId,
        productId: input.productId,
        variantId: input.variantId,
      },
      { signal },
    );
    if (!result.ok) {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-call -- ApiFailureError is a concrete subclass of Error from js-client
      throw new ApiFailureError(result.error);
    }
    return result.data;
  },
);

/**
 * One try-on outcome of a companion-style render (see `tryOnCompanionsActor`): the
 * attributes it was requested for and the server's terminal result. Transport failures
 * are dropped before they reach the parent — a companion is a convenience render, never
 * the reason a shopper sees an error screen.
 */
export interface CompanionTryOnOutcome {
  attributes: Readonly<Record<string, string>>;
  result: TryOnResult;
}

/**
 * Render every OTHER style of a garment in parallel with the primary try-on, so the
 * result view can flip between styles without another round-trip. Requests go out
 * together; each settles independently and a failed transport simply yields nothing for
 * that style (the primary request owns error handling).
 */
export const tryOnCompanionsActor = fromPromise(
  async ({
    input,
    signal,
  }: {
    signal: AbortSignal;
    input: {
      client: StudioVaaiClient;
      session: SessionHandle;
      bodyId: BodyId;
      productId: ProductId;
      selections: readonly {
        attributes: Readonly<Record<string, string>>;
        variantId: string;
      }[];
    };
  }): Promise<{ productId: ProductId; outcomes: CompanionTryOnOutcome[] }> => {
    const settled = await Promise.allSettled(
      input.selections.map(async ({ attributes, variantId }) => {
        const result = await input.client.tryOn.createTryOn(
          {
            session: input.session,
            bodyId: input.bodyId,
            productId: input.productId,
            variantId,
          },
          { signal },
        );
        if (!result.ok) {
          // oxlint-disable-next-line typescript-eslint/no-unsafe-call -- ApiFailureError is a concrete subclass of Error from js-client
          throw new ApiFailureError(result.error);
        }
        return { attributes, result: result.data };
      }),
    );
    const outcomes: CompanionTryOnOutcome[] = [];
    for (const entry of settled) {
      if (entry.status === "fulfilled") {
        outcomes.push(entry.value);
      }
    }
    return { productId: input.productId, outcomes };
  },
);

export const getTryOnActor = fromPromise(
  async ({
    input,
    signal,
  }: {
    signal: AbortSignal;
    input: { client: StudioVaaiClient; session: SessionHandle; tryOnId: TryOnId };
  }) => {
    const result = await input.client.tryOn.getTryOn(
      {
        session: input.session,
        tryOnId: input.tryOnId,
      },
      { signal },
    );
    if (!result.ok) {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-call -- ApiFailureError is a concrete subclass of Error from js-client
      throw new ApiFailureError(result.error);
    }
    return result.data;
  },
);

export function isStandardError(e: unknown): boolean {
  return isStandardErrorShape(unwrapApiFailure(e));
}

/**
 * True when an actor error (or an already-mapped {@link StandardError}) is the
 * server's terminal `session_expired` rejection — the session was idle-expired
 * (60 min) or its data deleted by the retention sweep. The root machine reacts
 * by clearing the persisted session and returning to the consent screen
 * (`SESSION_EXPIRED` root event); retrying the failed call is never useful.
 */
export function isSessionExpiredError(e: unknown): boolean {
  const inner = unwrapApiFailure(e);
  return isStandardErrorShape(inner) && inner.kind === "session_expired";
}

/** True when a `createBody` failure is the image being rejected by validation (user-actionable), not transport/system. */
export function isCreateBodyDomainError(e: unknown): boolean {
  const inner = unwrapApiFailure(e);
  return inner instanceof BodyCreateValidationFailedError;
}

export function toCreateBodyLikeError(e: unknown): CreateBodyLikeError {
  const inner = unwrapApiFailure(e);
  if (inner instanceof BodyCreateValidationFailedError) {
    const { failure } = inner;
    return {
      kind: "validation",
      code: failure.code,
      message: failure.message ?? (failure.code as unknown as string),
    };
  }
  if (isStandardErrorShape(inner)) {
    return inner;
  }
  return {
    kind: "validation_error",
    message: inner instanceof Error ? inner.message : String(inner),
  };
}
