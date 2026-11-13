import type { AnyActorRef } from "xstate";

import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import type { VariantAttributes } from "../src/context/index.js";

import { defaultRootMachine } from "../src/default-root.js";
import { createMemorySessionPersistence } from "../src/session-persistence.js";
import { createMockClient, firstChildActor, testProduct, testSession } from "./helpers.js";

const initialSelection: VariantAttributes = { size: "m", colorway: "black" };

const sessionExpiredError = {
  kind: "session_expired" as const,
  message: "The session ended (inactivity or data deletion).",
};

/** Drive consent → photo upload → height confirm so the actor sits on the product screen. */
async function runToProductScreen(actor: AnyActorRef) {
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches({ sessionIntro: "creatingSession" })).toBe(true);
  });
  firstChildActor(actor)!.send({ type: "CONSENT_GRANTED" });
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches({ sessionIntro: "awaitingImage" })).toBe(true);
  });
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches({ postCapture: { screen: "heightCalibration" } })).toBe(
      true,
    );
  });
  const bodyHeight = firstChildActor(actor)!;
  bodyHeight.send({ type: "SET_HEIGHT", heightCm: 175 });
  bodyHeight.send({ type: "CONFIRM" });
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches({ postCapture: { screen: { product: "active" } } })).toBe(
      true,
    );
  });
}

function expectFullSessionReset(
  actor: AnyActorRef,
  persistence: ReturnType<typeof createMemorySessionPersistence>,
) {
  const snap = actor.getSnapshot();
  expect(snap.matches("sessionIntro")).toBe(true);
  expect(snap.context.session).toBeUndefined();
  expect(snap.context.consentGivenOrRestored).toBe(false);
  expect(snap.context.bodyId).toBeUndefined();
  expect(snap.context.bodyRevisions).toEqual([]);
  expect(snap.context.tryOnHistoryByProduct).toEqual({});
  expect(snap.context.recommendation).toBeUndefined();
  expect(snap.context.pendingTryOn).toBeUndefined();
  expect(snap.context.lastCapturedImage).toBeUndefined();
  expect(persistence.snapshot()).toBeUndefined();
}

describe("session expiry handling", () => {
  it("does not renew a second bearer session sharing the same client", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const listeners = new Set<Parameters<NonNullable<typeof client.onSessionActivity>>[0]>();
    client.onSessionActivity = (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    const secondSession = "sess-other" as typeof testSession;
    let created = 0;
    client.session.createSession = async () => {
      const session = created === 0 ? testSession : secondSession;
      created += 1;
      return { ok: true, data: { session } };
    };
    const first = createActor(defaultRootMachine, { input: { client, product: testProduct } });
    const secondPersistence = createMemorySessionPersistence();
    const second = createActor(defaultRootMachine, {
      input: { client, product: testProduct, sessionPersistence: secondPersistence },
    });
    try {
      first.start();
      await runToProductScreen(first);
      second.start();
      await runToProductScreen(second);
      await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
      for (const listener of listeners) {
        listener({
          session: testSession,
          requestId: 1,
          startedAt: Date.now(),
          phase: "settled",
          accepted: true,
        });
      }
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
      expect(first.getSnapshot().context.session).toBe(testSession);
      expectFullSessionReset(second, secondPersistence);
    } finally {
      first.stop();
      second.stop();
      vi.useRealTimers();
    }
  });

  it("gives an already-started request bounded time to confirm renewal", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    let notify: Parameters<NonNullable<typeof client.onSessionActivity>>[0] | undefined;
    client.onSessionActivity = (listener) => {
      notify = listener;
      return () => {
        notify = undefined;
      };
    };
    const actor = createActor(defaultRootMachine, { input: { client, product: testProduct } });
    try {
      actor.start();
      await runToProductScreen(actor);
      await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
      const activity = { session: testSession, requestId: 1, startedAt: Date.now() };
      notify?.({ ...activity, phase: "started", accepted: false });
      await vi.advanceTimersByTimeAsync(90_000);
      expect(actor.getSnapshot().context.session).toBe(testSession);
      notify?.({ ...activity, phase: "settled", accepted: true });
      expect(actor.getSnapshot().context.session).toBe(testSession);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(actor.getSnapshot().context.session).toBeUndefined();
    } finally {
      actor.stop();
      vi.useRealTimers();
    }
  });

  it("clears idle state without waiting for another server request", async () => {
    vi.useFakeTimers();
    const persistence = createMemorySessionPersistence();
    const actor = createActor(defaultRootMachine, {
      input: {
        client: createMockClient(),
        product: testProduct,
        sessionPersistence: persistence,
      },
    });
    try {
      actor.start();
      await runToProductScreen(actor);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(actor.getSnapshot().context.session).toBeUndefined();
      expectFullSessionReset(actor, persistence);
    } finally {
      actor.stop();
      vi.useRealTimers();
    }
  });

  it("extends local idle state only for confirmed API engagement", async () => {
    vi.useFakeTimers();
    let engaged:
      | Parameters<NonNullable<ReturnType<typeof createMockClient>["onSessionActivity"]>>[0]
      | undefined;
    const client = createMockClient();
    client.onSessionActivity = (listener) => {
      engaged = listener;
      return () => {
        engaged = undefined;
      };
    };
    const persistence = createMemorySessionPersistence();
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        sessionPersistence: persistence,
      },
    });
    try {
      actor.start();
      await runToProductScreen(actor);
      await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
      engaged?.({
        session: testSession,
        requestId: 1,
        startedAt: Date.now(),
        phase: "settled",
        accepted: true,
      });
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
      expect(actor.getSnapshot().context.session).toBe(testSession);
      await vi.advanceTimersByTimeAsync(49 * 60 * 1000);
      expectFullSessionReset(actor, persistence);
    } finally {
      actor.stop();
      vi.useRealTimers();
    }
  });

  it("host-dispatched SESSION_EXPIRED clears context + persistence and returns to intro", async () => {
    const persistence = createMemorySessionPersistence();
    const actor = createActor(defaultRootMachine, {
      input: {
        client: createMockClient(),
        product: testProduct,
        selection: initialSelection,
        sessionPersistence: persistence,
      },
    });
    actor.start();
    await runToProductScreen(actor);
    expect(persistence.snapshot()).toBe(testSession);

    actor.send({ type: "SESSION_EXPIRED" });
    expectFullSessionReset(actor, persistence);
  });

  it("a session_expired recommendation failure escalates to the full reset", async () => {
    const persistence = createMemorySessionPersistence();
    const client = createMockClient();
    client.tryOn.getRecommendedSize = async () => ({ ok: false, error: sessionExpiredError });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
        sessionPersistence: persistence,
      },
    });
    actor.start();
    await runToProductScreen(actor);

    actor.send({ type: "RECOMMENDATION_REQUEST" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches("sessionIntro")).toBe(true);
    });
    expectFullSessionReset(actor, persistence);
  });

  it("a session_expired try-on failure escalates to the full reset", async () => {
    const persistence = createMemorySessionPersistence();
    const client = createMockClient();
    client.tryOn.createTryOn = async () => ({ ok: false, error: sessionExpiredError });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
        sessionPersistence: persistence,
      },
    });
    actor.start();
    await runToProductScreen(actor);

    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches("sessionIntro")).toBe(true);
    });
    expectFullSessionReset(actor, persistence);
  });

  it("a non-expiry try-on failure keeps the existing retryable error state", async () => {
    const persistence = createMemorySessionPersistence();
    const client = createMockClient();
    client.tryOn.createTryOn = async () => ({
      ok: false,
      error: { kind: "internal_server_error" as const, message: "boom" },
    });
    const actor = createActor(defaultRootMachine, {
      input: {
        client,
        product: testProduct,
        selection: initialSelection,
        sessionPersistence: persistence,
      },
    });
    actor.start();
    await runToProductScreen(actor);

    actor.send({ type: "START_TRY_ON" });
    await vi.waitFor(() => {
      expect(
        actor.getSnapshot().matches({
          postCapture: { screen: { product: { active: { tryOnPipeline: "error" } } } },
        }),
      ).toBe(true);
    });
    // Session untouched: persistence still holds the handle.
    expect(persistence.snapshot()).toBe(testSession);
    expect(actor.getSnapshot().context.session).toBe(testSession);
  });
});
