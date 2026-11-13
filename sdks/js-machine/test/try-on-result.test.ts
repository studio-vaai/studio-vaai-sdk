import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { tryOnResultMachine } from "../src/machines/try-on-result.js";
import { createMockClient, testSession, testTryOn } from "./helpers.js";

describe("tryOnResultMachine", () => {
  it("routes success when initialResult is success", async () => {
    const client = createMockClient();
    const actor = createActor(tryOnResultMachine, {
      input: {
        client,
        session: testSession,
        tryOnId: testTryOn,
        initialResult: {
          status: "success",
          tryOnId: testTryOn,
          imageUrl: "https://example.com/t.png",
          scene: { overlayColor: "#09090b" },
        },
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("success");
    });
  });

  it("can dismiss from success", async () => {
    const client = createMockClient();
    const actor = createActor(tryOnResultMachine, {
      input: {
        client,
        session: testSession,
        tryOnId: testTryOn,
        initialResult: {
          status: "success",
          tryOnId: testTryOn,
          imageUrl: "https://example.com/t.png",
          scene: { overlayColor: "#09090b" },
        },
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("success");
    });
    actor.send({ type: "DISMISS" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().status).toBe("done");
    });
    expect(actor.getSnapshot().output).toEqual({ kind: "dismissed" });
  });
});
