import type { ProductId } from "@studio-vaai/js-client";

import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { tryOnRequestMachine } from "../src/machines/try-on-request.js";
import { createMockClient, testBody, testSession } from "./helpers.js";

describe("tryOnRequestMachine", () => {
  it("runs createTryOn and outputs TryOnResult", async () => {
    const client = createMockClient();
    const actor = createActor(tryOnRequestMachine, {
      input: {
        client,
        session: testSession,
        bodyId: testBody,
        productId: "prod-1" as ProductId,
        variantId: "v-m-blue",
      },
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().status).toBe("done");
    });
    expect(actor.getSnapshot().output?.result.status).toBe("success");
  });
});
