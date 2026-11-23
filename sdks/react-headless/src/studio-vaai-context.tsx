import type { StudioVaaiClient } from "@studio-vaai/js-client";
import type { HostAnalyticsSignal, TrackingSubscriber } from "@studio-vaai/js-machine";
import type { TrackingClient } from "@studio-vaai/js-tracking";
import type { JSX, ReactNode } from "react";
import type { Actor, ActorRefFrom, AnyActorLogic, InputFrom, SnapshotFrom } from "xstate";

import { applyClientInterceptors } from "@studio-vaai/js-client";
import { useActorRef, useSelector } from "@xstate/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

import { StudioVaaiProviderError, StudioVaaiProviderErrorCode } from "./errors.js";

export type StudioVaaiProviderInput<TLogic extends AnyActorLogic> = Omit<
  InputFrom<TLogic>,
  "client"
>;

/**
 * Wires emitted analytics signals from the actor into a {@link TrackingClient}.
 * Pass {@link createTrackingSubscriber} from `@studio-vaai/js-machine` for the
 * default flow; supply a custom function for other machines.
 */
export type SubscribeTrackingFn<TLogic extends AnyActorLogic> = (
  actor: ActorRefFrom<TLogic>,
  tracking: TrackingClient,
) => TrackingSubscriber;

export interface CreateStudioVaaiContextOptions<TLogic extends AnyActorLogic> {
  /** When provided, the provider wires analytics from the actor on mount. */
  subscribeTracking?: SubscribeTrackingFn<TLogic>;
  /** @deprecated Analytics no longer sends an SDK version. */
  defaultSdkVersion?: string;
}

export interface CreateStudioVaaiContextResult<TLogic extends AnyActorLogic> {
  StudioVaaiProvider: (props: StudioVaaiProviderProps<TLogic>) => JSX.Element;
  useStudioVaaiActor: () => {
    state: SnapshotFrom<TLogic>;
    dispatch: Actor<TLogic>["send"];
    actor: Actor<TLogic>;
  };
  useStudioVaaiClient: () => StudioVaaiClient;
  useStudioVaaiSelector: <T>(selector: (state: SnapshotFrom<TLogic>) => T) => T;
  /** Returns a stable function that dispatches host-driven analytics events. */
  useStudioVaaiTracking: () => (signal: HostAnalyticsSignal) => void;
  /**
   * Returns the underlying {@link TrackingClient} so merchants can fire
   * arbitrary {@link TrackingEvent}s directly (e.g. `entrypoint-impression`,
   * `order-placed`, or future custom events declared in `js-tracking`).
   *
   * Same transport the host-event dispatcher uses, so events go to the same
   * collector and shop.
   */
  useTracking: () => TrackingClient;
}

export interface StudioVaaiProviderProps<TLogic extends AnyActorLogic> {
  children: ReactNode;
  client: StudioVaaiClient;
  input: StudioVaaiProviderInput<TLogic>;
  logic?: TLogic;
  /**
   * Tracking transport for analytics. When omitted, the provider creates a
   * collector transport using the client's existing key; no lookup is needed.
   */
  tracking?: TrackingClient;
  /** @deprecated Analytics no longer sends an SDK version. */
  sdkVersion?: string;
}

const noopHostEvent: (_signal: HostAnalyticsSignal) => void = () => {
  /* no subscriber wired yet */
};

/**
 * Create React context, provider, and hooks for a given root {@link ActorLogic}.
 * Pass {@link defaultRootMachine} from `@studio-vaai/js-machine` for the default try-on flow.
 */
export function createStudioVaaiContext<TLogic extends AnyActorLogic>(
  defaultLogic: TLogic,
  options: CreateStudioVaaiContextOptions<TLogic> = {},
): CreateStudioVaaiContextResult<TLogic> {
  const ActorContext = createContext<Actor<TLogic> | null>(null);
  const ClientContext = createContext<StudioVaaiClient | null>(null);
  const TrackingContext = createContext<(signal: HostAnalyticsSignal) => void>(noopHostEvent);
  const TrackingClientContext = createContext<TrackingClient | null>(null);

  function StudioVaaiProvider({
    children,
    client,
    input,
    logic = defaultLogic,
    tracking: providedTracking,
  }: StudioVaaiProviderProps<TLogic>): JSX.Element {
    // `applyClientInterceptors` lets dev tools (e.g. js-debugger) wrap the client without modifying provider call sites.
    // Memoize so React-only consumers via `useStudioVaaiClient` see a stable reference across renders.
    const wrappedClient = useMemo(() => applyClientInterceptors(client), [client]);
    // XState `InputFrom` is not expressible as `ProviderInput & { client }` for all `TLogic`; merge is runtime-correct for our machines.
    const mergedInput = {
      client: wrappedClient,
      ...input,
    } as unknown as InputFrom<TLogic>;
    const actorRef = useActorRef(logic, {
      input: mergedInput,
    });

    const tracking = useMemo(
      () => providedTracking ?? wrappedClient.analytics.createTrackingClient({}),
      [providedTracking, wrappedClient],
    );

    // Host-event forward indirected through a ref so the function identity
    // stays stable across subscription lifecycle changes — consumers can
    // capture `trackHostEvent` in deps arrays without spurious re-runs.
    const trackHostEventRef = useRef<(signal: HostAnalyticsSignal) => void>(noopHostEvent);
    const trackHostEventStable = useCallback((signal: HostAnalyticsSignal): void => {
      trackHostEventRef.current(signal);
    }, []);

    useEffect(() => {
      if (options.subscribeTracking === undefined) {
        return;
      }
      const subscriber = options.subscribeTracking(actorRef as ActorRefFrom<TLogic>, tracking);
      trackHostEventRef.current = subscriber.trackHostEvent;
      return () => {
        subscriber.unsubscribe();
        trackHostEventRef.current = noopHostEvent;
      };
    }, [actorRef, tracking]);

    return (
      <ClientContext.Provider value={wrappedClient}>
        <TrackingClientContext.Provider value={tracking}>
          <TrackingContext.Provider value={trackHostEventStable}>
            <ActorContext.Provider value={actorRef}>{children}</ActorContext.Provider>
          </TrackingContext.Provider>
        </TrackingClientContext.Provider>
      </ClientContext.Provider>
    );
  }

  function useStudioVaaiActor(): {
    state: SnapshotFrom<TLogic>;
    dispatch: Actor<TLogic>["send"];
    actor: Actor<TLogic>;
  } {
    const actor = useContext(ActorContext);
    if (!actor) {
      throw new StudioVaaiProviderError(StudioVaaiProviderErrorCode.MissingProvider);
    }

    const state = useSelector(actor, (s) => s);

    return {
      state,
      dispatch: actor.send.bind(actor),
      actor,
    };
  }

  function useStudioVaaiSelector<T>(selector: (state: SnapshotFrom<TLogic>) => T): T {
    const actor = useContext(ActorContext);
    if (!actor) {
      throw new StudioVaaiProviderError(StudioVaaiProviderErrorCode.MissingProvider);
    }
    return useSelector(actor, selector);
  }

  function useStudioVaaiClient(): StudioVaaiClient {
    const client = useContext(ClientContext);
    if (!client) {
      throw new StudioVaaiProviderError(StudioVaaiProviderErrorCode.MissingProvider);
    }
    return client;
  }

  function useStudioVaaiTracking(): (signal: HostAnalyticsSignal) => void {
    return useContext(TrackingContext);
  }

  function useTracking(): TrackingClient {
    const tracking = useContext(TrackingClientContext);
    if (!tracking) {
      throw new StudioVaaiProviderError(StudioVaaiProviderErrorCode.MissingProvider);
    }
    return tracking;
  }

  return {
    StudioVaaiProvider,
    useStudioVaaiActor,
    useStudioVaaiClient,
    useStudioVaaiSelector,
    useStudioVaaiTracking,
    useTracking,
  };
}
