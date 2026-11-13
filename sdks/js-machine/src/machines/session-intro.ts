import type { SessionHandle } from "@studio-vaai/js-client";

import { assign, setup } from "xstate";

import type { SessionIntroContext, SessionIntroInput } from "../context/index.js";

import { createSessionActor, transportErrorFromActor } from "../actors.js";

export type SessionIntroEvent = { type: "CONSENT_GRANTED" } | { type: "RETRY" };

export type SessionIntroOutput = { session: SessionHandle; expiresAt?: string };

export const sessionIntroMachine = setup({
  types: {
    context: {} as SessionIntroContext,
    events: {} as SessionIntroEvent,
    input: {} as SessionIntroInput,
    output: {} as SessionIntroOutput,
  },
  actors: {
    createSession: createSessionActor,
  },
}).createMachine({
  id: "sessionIntro",
  initial: "awaitingConsent",
  context: ({ input }) => ({
    client: input.client,
    session: undefined,
    lastError: undefined,
  }),
  states: {
    awaitingConsent: {
      on: {
        CONSENT_GRANTED: { target: "creatingSession" },
      },
    },
    creatingSession: {
      entry: assign({ lastError: undefined }),
      invoke: {
        src: "createSession",
        input: ({ context }) => ({ client: context.client }),
        onDone: {
          target: "ready",
          actions: assign({
            session: ({ event }) => event.output.session,
            expiresAt: ({ event }) => event.output.expiresAt,
          }),
        },
        onError: {
          target: "failed",
          actions: assign({
            lastError: ({ event }) => transportErrorFromActor(event.error),
          }),
        },
      },
    },
    failed: {
      on: {
        RETRY: { target: "creatingSession" },
        CONSENT_GRANTED: { target: "creatingSession" },
      },
    },
    ready: {
      type: "final",
    },
  },
  output: ({ context }): SessionIntroOutput => ({
    session: context.session!,
    ...(context.expiresAt === globalThis.undefined ? {} : { expiresAt: context.expiresAt }),
  }),
});
