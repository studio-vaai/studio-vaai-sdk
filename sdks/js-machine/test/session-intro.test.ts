import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { sessionIntroMachine } from "../src/machines/session-intro.js";
import { createMockClient } from "./helpers.js";

describe("sessionIntroMachine", () => {
  it("reaches ready after consent and createSession", async () => {
    const client = createMockClient();
    const actor = createActor(sessionIntroMachine, { input: { client } });
    actor.start();
    expect(actor.getSnapshot().value).toBe("awaitingConsent");
    actor.send({ type: "CONSENT_GRANTED" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().status).toBe("done");
    });
    expect(actor.getSnapshot().output).toEqual({ session: expect.any(String) });
  });
});
