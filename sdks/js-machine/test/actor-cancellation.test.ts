import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { createBodyActor, tryOnCompanionsActor } from "../src/actors.js";
import { createMockClient, testBody, testProductId, testSession } from "./helpers.js";

describe("personal request lifecycle", () => {
  it("aborts a photo request when its owning actor is stopped", async () => {
    const client = createMockClient();
    const normalCreate = client.body.createBody.bind(client.body);
    let signal: AbortSignal | undefined;
    const blocked = Promise.withResolvers<unknown>();
    client.body.createBody = async (args, options) => {
      signal = options?.signal;
      signal?.addEventListener(
        "abort",
        () => {
          blocked.reject(new DOMException("Stopped", "AbortError"));
        },
        { once: true },
      );
      await blocked.promise;
      return await normalCreate(args, options);
    };
    const actor = createActor(createBodyActor, {
      input: {
        client,
        session: testSession,
        image: { type: "blob", blob: new Blob(["synthetic"]) },
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(signal).toBeDefined();
    });
    actor.stop();
    expect(signal?.aborted).toBe(true);
  });
  it("passes cancellation to companion try-on requests", async () => {
    const client = createMockClient();
    const spy = vi.spyOn(client.tryOn, "createTryOn");
    const actor = createActor(tryOnCompanionsActor, {
      input: {
        client,
        session: testSession,
        bodyId: testBody,
        productId: testProductId,
        selections: [{ style: "alternate" }],
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().status).toBe("done");
    });
    expect(spy.mock.calls[0]?.[1]?.signal).toBeDefined();
    actor.stop();
  });
});
