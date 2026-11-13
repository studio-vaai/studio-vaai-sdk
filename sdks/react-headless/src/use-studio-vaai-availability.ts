import type { TryOnExperimentDecision } from "@studio-vaai/js-client";

import { useEffect, useRef, useState } from "react";

import { defaultStudioVaai } from "./default-studio-vaai.js";
import { getOrCreateVisitorId } from "./visitor-id.js";

const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 400;
const DEFAULT_BUDGET_MS = 4000;

export type StudioVaaiAvailabilityStatus = "checking" | "available" | "unavailable";

export interface UseStudioVaaiAvailabilityOptions {
  /**
   * Milliseconds before an unresolved decision is treated as failed and the in-flight
   * request is aborted. Per ATTEMPT, not for the whole probe. Defaults to 2500 ms.
   */
  timeoutMs?: number;
  /**
   * How many times to ask before giving up, counting the first try. Only transport
   * failures are retried — a decision the server actually returned is final, holdback
   * included. Defaults to 3.
   */
  attempts?: number;
  /**
   * Base delay between attempts, doubled each time (400 ms → 800 ms → …). Defaults to 400 ms.
   */
  retryDelayMs?: number;
  /**
   * Ceiling on the WHOLE probe. No new attempt starts once this has elapsed, so retrying
   * cannot stretch how long a host sits on `"checking"` — with an entry point that renders
   * only when `"available"`, a long probe is a long-missing CTA. Defaults to 4000 ms.
   */
  budgetMs?: number;
}

export interface UseStudioVaaiAvailabilityResult {
  status: StudioVaaiAvailabilityStatus;
}

/**
 * Decide whether to surface the try-on entry point for this visitor. Probes the
 * A/B rollout endpoint (`client.experiments.getTryOnDecision`) once on mount, so
 * a host can gate try-on CTAs before any SDK UI mounts.
 *
 * The rollout call doubles as the availability check and applies this precedence
 * server-side:
 * 1. **Global kill switch** (operator drain) → `"unavailable"` for everyone.
 * 2. **Valid session** — a returning visitor who already has a session bypasses
 *    the A/B holdback and is always `"available"` (when not drained).
 * 3. Otherwise the anonymous visitor is **bucketed** against the shop's rollout.
 *
 * Returns one of three states:
 * - `"checking"` — initial render and while the decision is in flight.
 * - `"available"` — show try-on.
 * - `"unavailable"` — holdback arm, drained, or the backend is unreachable
 *   (non-ok, thrown error, or timeout). Fails **closed**: "not rolled out" and
 *   "service down" collapse to the same "don't show" state, so a holdback
 *   visitor never sees try-on flash if the call is slow.
 *
 * Failing closed means a single blip would otherwise hide the entry point for the whole
 * page view, so transport failures are RETRIED (see {@link UseStudioVaaiAvailabilityOptions.attempts})
 * and the hook stays `"checking"` until the attempts are spent or the budget runs out. A
 * decision the server actually returned is never retried — a holdback visitor settles on the
 * first answer.
 *
 * Two rules keep retrying from making the CTA *less* reliable than a single shot would:
 * - the whole probe is bounded by {@link UseStudioVaaiAvailabilityOptions.budgetMs}, because
 *   `"checking"` renders no entry point and a longer probe is a longer-missing CTA;
 * - a failure never downgrades a decision already received. The effect re-runs when the
 *   session resolves (to upgrade a bucketed visitor), and that re-probe failing must not
 *   retract a CTA the visitor is already looking at. Only an explicit `enabled: false` does.
 *
 * Only the **validated** session restored into the machine is sent (an expired
 * token would be rejected by the auth layer), so a returning visitor may be
 * bucketed for the brief window before their session restores, then upgraded to
 * `"available"`. On a confirmed decision it fires an `experiment-assigned`
 * analytics event once — but only for genuinely anonymous visitors, since
 * returning (session-bearing) visitors are not part of the A/B population.
 *
 * Sticky per page session via an in-memory visitor id (see {@link getOrCreateVisitorId}).
 * Re-checks if the session changes; aborts the in-flight request on unmount.
 * Must be used inside `StudioVaaiProvider`.
 */
export function useStudioVaaiAvailability(
  options: UseStudioVaaiAvailabilityOptions = {},
): UseStudioVaaiAvailabilityResult {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attempts = DEFAULT_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    budgetMs = DEFAULT_BUDGET_MS,
  } = options;
  const client = defaultStudioVaai.useStudioVaaiClient();
  const tracking = defaultStudioVaai.useTracking();
  // The validated session handle (set once `restoreSession`/`createSession`
  // succeeds) — safe to send as a bearer; a raw persisted token might be
  // expired and would be rejected by the auth layer.
  const session = defaultStudioVaai.useStudioVaaiSelector((s) => s.context.session);
  const sessionPersistence = defaultStudioVaai.useStudioVaaiSelector(
    (s) => s.context.sessionPersistence,
  );
  const [status, setStatus] = useState<StudioVaaiAvailabilityStatus>("checking");
  // Survives the effect re-running (it re-runs when the session resolves, to upgrade a
  // bucketed visitor). `true` once the server has answered at all, for this hook instance.
  const decidedRef = useRef(false);

  useEffect(() => {
    // One flag for the whole probe, not per attempt: unmount (or a dep change) has to stop
    // the retry loop as well as the request in flight.
    let cancelled = false;
    let controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A timer rather than a `Date.now()` comparison: the budget then advances with whatever
    // clock the rest of the probe is on, including a test's fake timers.
    let budgetSpent = false;
    const budgetTimer = setTimeout(() => {
      budgetSpent = true;
    }, budgetMs);

    /** One attempt. Resolves the decision, or `null` when the transport failed. */
    const askOnce = async (): Promise<TryOnExperimentDecision | null> => {
      controller = new AbortController();
      const attemptController = controller;
      // The deadline is RACED, not merely wired to the abort signal: a client that ignores
      // `signal` would otherwise leave this awaiting forever and the entry point stuck in
      // `"checking"`. Aborting still happens, to free the request that lost the race.
      // oxlint-disable-next-line promise/avoid-new -- a timer has no promise form to return
      const deadline = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          attemptController.abort();
          resolve(null);
        }, timeoutMs);
      });
      try {
        const result = await Promise.race([
          client.experiments.getTryOnDecision(
            { visitorId: getOrCreateVisitorId() },
            { signal: attemptController.signal },
          ),
          deadline,
        ]);
        return result !== null && result.ok ? result.data : null;
      } catch {
        // Aborted (timeout or teardown) or the transport threw — both are retryable.
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    const wait = async (ms: number): Promise<void> => {
      // oxlint-disable-next-line promise/avoid-new -- a timer has no promise form to return
      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });
    };

    void (async () => {
      for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
        if (attempt > 0) {
          // Never start another attempt past the budget: on this hook `checking` means the
          // host is rendering NO entry point, so a longer probe is a longer-missing CTA.
          if (budgetSpent) {
            break;
          }
          // oxlint-disable-next-line no-await-in-loop -- backoff between attempts is sequential
          await wait(retryDelayMs * 2 ** (attempt - 1));
          if (cancelled) {
            return;
          }
        }
        // oxlint-disable-next-line no-await-in-loop -- retries are sequential by definition
        const decision = await askOnce();
        if (cancelled) {
          return;
        }
        if (decision === null) {
          // Transport failure: keep trying rather than hiding the entry point on one blip.
          continue;
        }
        decidedRef.current = true;
        setStatus(decision.enabled ? "available" : "unavailable");
        // Record the assignment once, via the same Umami transport the rest
        // of the SDK uses — but only for anonymous visitors. A returning
        // visitor (session restored, or a stored session still restoring)
        // bypasses the experiment, so logging an arm for them would mislabel
        // the data. Fire-and-forget; never throws.
        const returning = session !== undefined || sessionPersistence.read() !== undefined;
        if (!returning) {
          tracking.trackEvent({
            name: "experiment-assigned",
            data: { experiment: "try-on-enabled", variant: decision.variant },
          });
        }
        return;
      }
      // Every attempt failed to reach a decision. Fail closed, as documented — but only if
      // the server has never answered. Once it HAS, an unreachable backend is not new
      // information about the rollout, and hiding a CTA the visitor is already looking at is
      // strictly worse than leaving it. An explicit `enabled: false` still hides it, so an
      // operator drain is still honored.
      if (!decidedRef.current) {
        setStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(budgetTimer);
      controller.abort();
    };
  }, [client, tracking, session, sessionPersistence, timeoutMs, attempts, retryDelayMs, budgetMs]);

  return { status };
}
