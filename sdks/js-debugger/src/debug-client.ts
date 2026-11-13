import type { BodyCreateResult, StudioVaaiClient } from "@studio-vaai/js-client";

import type { DebugMethodId } from "./types.js";

import { getDebugState, logApiCall } from "./debug-state.js";

function wrapMethod<TArgs extends unknown[], TResult extends { ok: boolean }>(
  methodId: DebugMethodId,
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const injected = getDebugState().injectedErrors[methodId];
    const start = Date.now();
    if (injected !== undefined) {
      const durationMs = Date.now() - start;
      logApiCall({
        ts: start,
        methodId,
        ok: false,
        durationMs,
        summary: `${methodId} → injected ${injected.kind} (${durationMs}ms)`,
      });
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- intentional: all client methods return ApiResult-shaped objects
      return {
        ok: false,
        error: { kind: injected.kind, message: injected.message },
      } as unknown as TResult;
    }
    const result = await fn(...args);
    const durationMs = Date.now() - start;
    logApiCall({
      ts: start,
      methodId,
      ok: result.ok,
      durationMs,
      summary: `${methodId} → ${result.ok ? "ok" : "error"} (${durationMs}ms)`,
    });
    return result;
  };
}

/**
 * Wraps {@link StudioVaaiClient.body.createBody} with both the standard transport-error
 * injection (via {@link wrapMethod}) and a typed validation-failure injection that mirrors
 * the real server's `{ status: "failed", failure: { kind: "validation", … } }` response.
 */
function wrapCreateBody(
  inner: StudioVaaiClient["body"]["createBody"],
): StudioVaaiClient["body"]["createBody"] {
  const methodId: DebugMethodId = "body.createBody";
  const wrappedTransport = wrapMethod(methodId, inner);
  return async (...args) => {
    // Transport-error injection wins when both are set — it short-circuits the network call.
    if (getDebugState().injectedErrors[methodId] !== undefined) {
      return await wrappedTransport(...args);
    }
    const validation = getDebugState().injectedBodyValidationFailures[methodId];
    if (validation !== undefined) {
      const start = Date.now();
      const durationMs = Date.now() - start;
      logApiCall({
        ts: start,
        methodId,
        ok: true,
        durationMs,
        summary: `${methodId} → injected validation:${validation.code} (${durationMs}ms)`,
      });
      const data: BodyCreateResult = {
        status: "failed",
        failure: {
          kind: "validation",
          code: validation.code,
          ...(typeof validation.message !== "undefined" && { message: validation.message }),
        },
      };
      return { ok: true, data };
    }
    return await wrappedTransport(...args);
  };
}

/** Wrap a {@link StudioVaaiClient} so every API call is intercepted for error injection and logging. */
export function createDebugClient(inner: StudioVaaiClient): StudioVaaiClient {
  return {
    ...(inner.onSessionActivity === undefined
      ? {}
      : { onSessionActivity: inner.onSessionActivity.bind(inner) }),
    ...(inner.catalog === undefined ? {} : { catalog: inner.catalog }),
    meta: {
      getHealth: wrapMethod(
        "meta.getHealth",
        async (...args) => await inner.meta.getHealth(...args),
      ),
    },
    session: {
      createSession: wrapMethod(
        "session.createSession",
        async (...args) => await inner.session.createSession(...args),
      ),
      getSession: wrapMethod(
        "session.getSession",
        async (...args) => await inner.session.getSession(...args),
      ),
      refreshSession: wrapMethod(
        "session.refreshSession",
        async (...args) => await inner.session.refreshSession(...args),
      ),
      invalidateSession: wrapMethod(
        "session.invalidateSession",
        async (...args) => await inner.session.invalidateSession(...args),
      ),
    },
    body: {
      listBodies: wrapMethod(
        "body.listBodies",
        async (...args) => await inner.body.listBodies(...args),
      ),
      createBody: wrapCreateBody(async (...args) => await inner.body.createBody(...args)),
      setBodyHeight: wrapMethod(
        "body.setBodyHeight",
        async (...args) => await inner.body.setBodyHeight(...args),
      ),
    },
    analytics: inner.analytics,
    experiments: {
      evaluateFlag: wrapMethod(
        "experiments.evaluateFlag",
        async (...args) => await inner.experiments.evaluateFlag(...args),
      ),
      evaluateFlagsBulk: wrapMethod(
        "experiments.evaluateFlagsBulk",
        async (...args) => await inner.experiments.evaluateFlagsBulk(...args),
      ),
      getTryOnDecision: wrapMethod(
        "experiments.getTryOnDecision",
        async (...args) => await inner.experiments.getTryOnDecision(...args),
      ),
    },
    tryOn: {
      getRecommendedSize: wrapMethod(
        "tryOn.getRecommendedSize",
        async (...args) => await inner.tryOn.getRecommendedSize(...args),
      ),
      createTryOn: wrapMethod(
        "tryOn.createTryOn",
        async (...args) => await inner.tryOn.createTryOn(...args),
      ),
      getTryOn: wrapMethod(
        "tryOn.getTryOn",
        async (...args) => await inner.tryOn.getTryOn(...args),
      ),
    },
  };
}
