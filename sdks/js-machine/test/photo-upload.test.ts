import { asBodyValidationCode } from "@studio-vaai/js-client";
import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { photoUploadMachine } from "../src/machines/photo-upload.js";
import { createMockClient, testSession } from "./helpers.js";

describe("photoUploadMachine", () => {
  it("accepts image upload via createBody", async () => {
    const client = createMockClient();
    const actor = createActor(photoUploadMachine, {
      input: { client, session: testSession },
    });
    actor.start();
    expect(actor.getSnapshot().value).toBe("intro");
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().status).toBe("done");
    });
    expect(actor.getSnapshot().output).toEqual({
      bodyId: expect.any(String),
      heightCm: 170,
      image: { type: "blob", blob: expect.any(Blob) },
    });
  });

  it("RETRY from rejected clears image and stays in intro until a new file is chosen", async () => {
    const base = createMockClient();
    const client = createMockClient({
      body: {
        ...base.body,
        createBody: async () => ({
          ok: true,
          data: {
            status: "failed",
            failure: {
              kind: "validation",
              code: asBodyValidationCode("human_occluded"),
              message: "legs cut off",
            },
          },
        }),
      },
    });
    const actor = createActor(photoUploadMachine, {
      input: { client, session: testSession },
    });
    actor.start();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    actor.send({ type: "IMAGE_SELECTED", image: { type: "blob", blob } });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches("rejected")).toBe(true);
    });
    actor.send({ type: "RETRY" });
    const snap = actor.getSnapshot();
    expect(snap.matches("intro")).toBe(true);
    expect(snap.context.image).toBeUndefined();
    expect(snap.context.lastError).toBeUndefined();
  });
});
