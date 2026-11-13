import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { bodyHeightCalibrationMachine } from "../src/machines/body-height-calibration.js";
import { createMockClient, testBody, testSession } from "./helpers.js";

describe("bodyHeightCalibrationMachine", () => {
  it("calibrates height and reaches success with the calibrated body id in context", async () => {
    const client = createMockClient();
    const actor = createActor(bodyHeightCalibrationMachine, {
      input: { client, session: testSession, bodyId: testBody, initialHeightCm: 170 },
    });
    actor.start();
    actor.send({ type: "SET_HEIGHT", heightCm: 175 });
    actor.send({ type: "CONFIRM" });
    // `success` is a non-final state so the user can re-edit height afterwards;
    // completion is observed via the state value + context, not actor `output`.
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("success");
    });
    expect(actor.getSnapshot().context.bodyId).toBe(testBody);
    expect(actor.getSnapshot().context.heightCm).toBe(175);
    expect(actor.getSnapshot().status).toBe("active");
  });

  it("can finish with retryCapture for another photo", () => {
    const client = createMockClient();
    const actor = createActor(bodyHeightCalibrationMachine, {
      input: { client, session: testSession, bodyId: testBody, initialHeightCm: 170 },
    });
    actor.start();
    actor.send({ type: "USE_ANOTHER_IMAGE" });
    expect(actor.getSnapshot().status).toBe("done");
    expect(actor.getSnapshot().output).toEqual({ kind: "retryCapture" });
  });
});
