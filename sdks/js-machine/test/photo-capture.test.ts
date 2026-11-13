import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { photoCaptureMachine } from "../src/machines/photo-capture.js";
import { createMockClient, testSession } from "./helpers.js";

function makeBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
}

describe("photoCaptureMachine", () => {
  it("starts in awaitingPermission and transitions to live on CAMERA_READY", () => {
    const actor = createActor(photoCaptureMachine, {
      input: { client: createMockClient(), session: testSession },
    });
    actor.start();
    expect(actor.getSnapshot().matches("awaitingPermission")).toBe(true);
    actor.send({ type: "CAMERA_READY" });
    expect(actor.getSnapshot().matches("live")).toBe(true);
  });

  it("CAMERA_FAILED records the failure kind and surfaces the failed state", () => {
    const actor = createActor(photoCaptureMachine, {
      input: { client: createMockClient(), session: testSession },
    });
    actor.start();
    actor.send({ type: "CAMERA_FAILED", kind: "denied" });
    const snap = actor.getSnapshot();
    expect(snap.matches("failed")).toBe(true);
    expect(snap.context.lastFailureKind).toBe("denied");
  });

  it("RETRY from failed returns to awaitingPermission and clears the failure", () => {
    const actor = createActor(photoCaptureMachine, {
      input: { client: createMockClient(), session: testSession },
    });
    actor.start();
    actor.send({ type: "CAMERA_FAILED", kind: "unavailable" });
    actor.send({ type: "RETRY" });
    const snap = actor.getSnapshot();
    expect(snap.matches("awaitingPermission")).toBe(true);
    expect(snap.context.lastFailureKind).toBeUndefined();
  });

  it("AUTO_CAPTURE from live transitions to capturing; FRAME_CAPTURED terminates with output", () => {
    const actor = createActor(photoCaptureMachine, {
      input: { client: createMockClient(), session: testSession },
    });
    actor.start();
    actor.send({ type: "CAMERA_READY" });
    actor.send({ type: "AUTO_CAPTURE" });
    expect(actor.getSnapshot().matches("capturing")).toBe(true);
    const blob = makeBlob();
    actor.send({ type: "FRAME_CAPTURED", image: { type: "blob", blob } });
    const snap = actor.getSnapshot();
    expect(snap.status).toBe("done");
    expect(snap.output).toEqual({ image: { type: "blob", blob } });
  });

  it("CAPTURE_FAILED returns capturing to live so the user can re-try", () => {
    const actor = createActor(photoCaptureMachine, {
      input: { client: createMockClient(), session: testSession },
    });
    actor.start();
    actor.send({ type: "CAMERA_READY" });
    actor.send({ type: "AUTO_CAPTURE" });
    actor.send({ type: "CAPTURE_FAILED" });
    expect(actor.getSnapshot().matches("live")).toBe(true);
  });

  it("START_SELF_TIMER counts down 1s/sec and auto-captures at zero", () => {
    vi.useFakeTimers();
    try {
      const actor = createActor(photoCaptureMachine, {
        input: { client: createMockClient(), session: testSession, selfTimerDurationSeconds: 3 },
      });
      actor.start();
      actor.send({ type: "CAMERA_READY" });
      actor.send({ type: "START_SELF_TIMER" });
      expect(actor.getSnapshot().context.countdownSeconds).toBe(3);
      vi.advanceTimersByTime(1000);
      expect(actor.getSnapshot().context.countdownSeconds).toBe(2);
      vi.advanceTimersByTime(1000);
      expect(actor.getSnapshot().context.countdownSeconds).toBe(1);
      vi.advanceTimersByTime(1000);
      const snap = actor.getSnapshot();
      expect(snap.matches("capturing")).toBe(true);
      expect(snap.context.countdownSeconds).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("CANCEL_SELF_TIMER mid-countdown returns to live and clears the counter", () => {
    vi.useFakeTimers();
    try {
      const actor = createActor(photoCaptureMachine, {
        input: { client: createMockClient(), session: testSession, selfTimerDurationSeconds: 5 },
      });
      actor.start();
      actor.send({ type: "CAMERA_READY" });
      actor.send({ type: "START_SELF_TIMER" });
      vi.advanceTimersByTime(2000);
      expect(actor.getSnapshot().context.countdownSeconds).toBe(3);
      actor.send({ type: "CANCEL_SELF_TIMER" });
      const snap = actor.getSnapshot();
      expect(snap.matches("live")).toBe(true);
      expect(snap.context.countdownSeconds).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("CAMERA_FAILED mid-countdown flips to failed (permission revoked while stream is live)", () => {
    vi.useFakeTimers();
    try {
      const actor = createActor(photoCaptureMachine, {
        input: { client: createMockClient(), session: testSession, selfTimerDurationSeconds: 5 },
      });
      actor.start();
      actor.send({ type: "CAMERA_READY" });
      actor.send({ type: "START_SELF_TIMER" });
      vi.advanceTimersByTime(2000);
      expect(actor.getSnapshot().matches("countdown")).toBe(true);
      actor.send({ type: "CAMERA_FAILED", kind: "denied" });
      const snap = actor.getSnapshot();
      expect(snap.matches("failed")).toBe(true);
      expect(snap.context.lastFailureKind).toBe("denied");
    } finally {
      vi.useRealTimers();
    }
  });

  it("CAMERA_FAILED while capturing flips to failed (revocation between AUTO_CAPTURE and FRAME_CAPTURED)", () => {
    const actor = createActor(photoCaptureMachine, {
      input: { client: createMockClient(), session: testSession },
    });
    actor.start();
    actor.send({ type: "CAMERA_READY" });
    actor.send({ type: "AUTO_CAPTURE" });
    expect(actor.getSnapshot().matches("capturing")).toBe(true);
    actor.send({ type: "CAMERA_FAILED", kind: "error" });
    const snap = actor.getSnapshot();
    expect(snap.matches("failed")).toBe(true);
    expect(snap.context.lastFailureKind).toBe("error");
  });
});
