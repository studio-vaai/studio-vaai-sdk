import type { SessionHandle, StudioVaaiClient } from "@studio-vaai/js-client";
import type { AnyActorRef, EventObject } from "xstate";

import { fromCallback } from "xstate";

import type { SessionPersistenceAdapter } from "./session-persistence.js";

import { SESSION_IDLE_MS } from "./session-persistence.js";

export function sessionDeadline(value?: string, now = Date.now()): number {
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) ? Math.min(parsed, now + SESSION_IDLE_MS) : now + SESSION_IDLE_MS;
}

/** Local state follows confirmed API engagement, never passive page activity. */
export const sessionRetentionActor = fromCallback<EventObject, { root: AnyActorRef }>(
  ({ input, sendBack }) => {
    let handle: SessionHandle | undefined;
    let deadline = 0;
    let persistence: SessionPersistenceAdapter | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let client: StudioVaaiClient | undefined;
    let unsubscribeActivity: (() => void) | undefined;
    const pending = new Map<number, number>();
    const effectiveDeadline = () => Math.max(deadline, ...pending.values());

    const check = () => {
      if (handle !== undefined && Date.now() >= effectiveDeadline()) {
        handle = undefined;
        persistence?.clear();
        sendBack({ type: "SESSION_EXPIRED" });
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      if (handle !== undefined) {
        timer = setTimeout(check, Math.max(0, effectiveDeadline() - Date.now()));
        // Node/SSR actors must not keep a process alive for an idle browser timer.
        if (typeof timer === "object" && "unref" in timer) {
          timer.unref();
        }
      }
    };
    const subscription = input.root.subscribe((snapshot: unknown) => {
      const context = (snapshot as { context: unknown }).context as {
        session?: SessionHandle;
        sessionExpiresAt?: string;
        sessionPersistence: SessionPersistenceAdapter;
        client: StudioVaaiClient;
      };
      persistence = context.sessionPersistence;
      if (context.client !== client) {
        unsubscribeActivity?.();
        client = context.client;
        unsubscribeActivity = client.onSessionActivity?.((activity) => {
          if (handle === undefined || activity.session !== handle) {
            return;
          }
          check();
          if (handle === undefined) {
            return;
          }
          if (activity.phase === "started" && activity.startedAt < deadline) {
            // An already-started API call gets bounded completion time, never
            // another idle hour without a successful authenticated response.
            pending.set(
              activity.requestId,
              Math.min(deadline + 120_000, activity.startedAt + 120_000),
            );
          } else if (activity.phase === "settled") {
            pending.delete(activity.requestId);
            if (activity.accepted) {
              deadline = Math.max(deadline, activity.startedAt + SESSION_IDLE_MS);
              persistence?.write(handle, deadline);
            }
          }
          check();
          schedule();
        });
      }
      if (context.session !== handle) {
        pending.clear();
        handle = context.session;
        deadline = sessionDeadline(context.sessionExpiresAt);
        check();
        schedule();
      }
    });
    // Capturing resume checks run before later interaction handlers can reuse state.
    globalThis.window?.addEventListener("pageshow", check, true);
    globalThis.window?.addEventListener("focus", check, true);
    globalThis.document?.addEventListener("visibilitychange", check, true);
    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
      unsubscribeActivity?.();
      globalThis.window?.removeEventListener("pageshow", check, true);
      globalThis.window?.removeEventListener("focus", check, true);
      globalThis.document?.removeEventListener("visibilitychange", check, true);
    };
  },
);
