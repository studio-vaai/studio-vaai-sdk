import type { Step, TrackingClient, TrackingEvent } from "@studio-vaai/js-tracking";
import type { ActorRefFrom, AnyActorRef, SnapshotFrom } from "xstate";

import type { AnalyticsSignal, HostAnalyticsSignal } from "./analytics-signal.js";
import type { defaultRootMachine } from "./default-root.js";

/** Try-on pipeline substates where the user sees the try-on result / busy UI. */
const TRY_ON_VIEW_SUBSTATES = new Set([
  "requesting",
  "resulting",
  "awaitingCalibration",
  "running",
]);

/**
 * Maps a {@link defaultRootMachine} snapshot value to the corresponding
 * {@link Step}. Acts as the single source of truth for the
 * XState-state-path → analytics-step translation.
 *
 * Heuristic: checks deepest meaningful path fragments first so parallel-region
 * states (e.g. `postCapture.screen.heightCalibration` vs. `postCapture.work`)
 * resolve to the user-visible step, not the background work region.
 *
 * Accepts either a raw XState `value` (for tests) or a full root snapshot. When
 * a full snapshot is passed, the invoked `photoUpload` child is consulted so
 * `rejected` maps to {@link Step} `"image-rejection"`.
 */
export function stepFromSnapshot(input: unknown): Step {
  if (isDefaultRootSnapshot(input)) {
    const step = stepFromValue(input.value);
    if (step !== "image-upload") {
      return step;
    }
    const childValue = photoUploadChildValue(input);
    return childValue === "rejected" ? "image-rejection" : "image-upload";
  }
  return stepFromValue(input);
}

function isDefaultRootSnapshot(input: unknown): input is DefaultRootSnapshot {
  return (
    typeof input === "object" &&
    input !== null &&
    "value" in input &&
    "context" in input &&
    "status" in input
  );
}

function photoUploadChildValue(snapshot: DefaultRootSnapshot): unknown {
  const raw = snapshot.children as
    | Map<string, AnyActorRef>
    | Record<string, AnyActorRef>
    | undefined;
  if (typeof raw === "undefined") {
    return undefined;
  }
  const refs = raw instanceof Map ? [...raw.values()] : Object.values(raw);
  for (const ref of refs) {
    const childSnap = ref.getSnapshot() as { machine?: { id?: string }; value: unknown };
    if (childSnap.machine?.id === "photoUpload") {
      return childSnap.value;
    }
  }
  const firstRef = refs[0];
  if (typeof firstRef === "undefined") {
    return undefined;
  }
  return (firstRef.getSnapshot() as { value: unknown }).value;
}

function tryOnPipelineSubstate(flat: string): string | undefined {
  const match = /\btryOnPipeline\.(\w+)/.exec(flat);
  return match?.[1];
}

function stepFromValue(value: unknown): Step {
  const flat = flattenStateValue(value);
  if (flat.includes("heightCalibration")) {
    return "height";
  }
  const tryOnSubstate = tryOnPipelineSubstate(flat);
  if (tryOnSubstate !== undefined) {
    return TRY_ON_VIEW_SUBSTATES.has(tryOnSubstate) ? "try-on" : "variant-selection";
  }
  if (flat.includes("postCapture.screen.product")) {
    return "variant-selection";
  }
  if (flat.startsWith("photoCapture")) {
    return "image-record";
  }
  if (flat.startsWith("photoUpload")) {
    return "image-upload";
  }
  if (flat.startsWith("sessionIntro")) {
    return "intro";
  }
  return "entry";
}

function flattenStateValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .map(([key, nestedValue]) => `${key}.${flattenStateValue(nestedValue)}`)
      .join("|");
  }
  return "";
}

function variantWireKeys(variants: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [axis, value] of Object.entries(variants)) {
    out[`variant-${axis}`] = value;
  }
  return out;
}

function enrichSignal(signal: AnalyticsSignal, source: Step): TrackingEvent {
  switch (signal.type) {
    case "intro-opened": {
      return { name: "intro-opened", data: { "product-id": signal["product-id"], source } };
    }
    case "consent-granted": {
      return { name: "consent-granted", data: { "product-id": signal["product-id"] } };
    }
    case "image-record-initiated": {
      return {
        name: "image-record-initiated",
        data: { "product-id": signal["product-id"], source: signal.source },
      };
    }
    case "image-record-aborted": {
      return {
        name: "image-record-aborted",
        data: { "product-id": signal["product-id"], source: signal.source },
      };
    }
    case "image-upload-initiated": {
      return {
        name: "image-upload-initiated",
        data: { "product-id": signal["product-id"], source: signal.source },
      };
    }
    case "image-upload-aborted": {
      return {
        name: "image-upload-aborted",
        data: { "product-id": signal["product-id"], source: signal.source },
      };
    }
    case "image-uploaded": {
      // Map raw machine `photoSource` to the event spec's narrower union.
      // `camera` is exclusively self-timer in our capture flow today; if the
      // machine grows a system-dialog distinction, refine here.
      const imageSource: "select" | "record-self-timer" =
        signal["photo-source"] === "gallery" ? "select" : "record-self-timer";
      return {
        name: "image-uploaded",
        data: { "product-id": signal["product-id"], "image-source": imageSource },
      };
    }
    case "height-entered": {
      return { name: "height-entered", data: { "product-id": signal["product-id"], source } };
    }
    case "variant-selection-initiated": {
      return {
        name: "variant-selection-initiated",
        data: {
          "product-id": signal["product-id"],
          source,
          ...(signal.via === undefined ? {} : { via: signal.via }),
        },
      };
    }
    case "try-on-initiated": {
      return {
        name: "try-on-initiated",
        data: { "product-id": signal["product-id"], ...variantWireKeys(signal.variants) },
      };
    }
    case "gated-size-selected": {
      return {
        name: "gated-size-selected",
        data: {
          "product-id": signal["product-id"],
          "variant-size": signal.size,
          gate: signal.gate,
        },
      };
    }
    default: {
      const _exhaustive: never = signal;
      throw new Error(`Unhandled analytics signal: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function enrichHostSignal(signal: HostAnalyticsSignal, currentStep: Step): TrackingEvent {
  switch (signal.type) {
    case "entrypoint-impression": {
      return {
        name: "entrypoint-impression",
        data: { "product-id": signal["product-id"], entry: signal.entry },
      };
    }
    case "entrypoint-clicked": {
      return {
        name: "entrypoint-clicked",
        data: {
          "product-id": signal["product-id"],
          entry: signal.entry,
          ...(signal.subentry === undefined ? {} : { subentry: signal.subentry }),
          "current-step": currentStep,
        },
      };
    }
    case "intro-opened": {
      return {
        name: "intro-opened",
        data: { "product-id": signal["product-id"], source: signal.source },
      };
    }
    case "cart-item-added": {
      return {
        name: "cart-item-added",
        data: { "product-id": signal["product-id"], ...variantWireKeys(signal.variants) },
      };
    }
    case "order-placed": {
      return {
        name: "order-placed",
        data: { "product-id": signal["product-id"], ...variantWireKeys(signal.variants) },
      };
    }
    case "view-closed": {
      return {
        name: "view-closed",
        data: { "product-id": signal["product-id"], "current-step": currentStep },
      };
    }
    default: {
      const _exhaustive: never = signal;
      throw new Error(`Unhandled host analytics signal: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

type DefaultRootActor = ActorRefFrom<typeof defaultRootMachine>;
type DefaultRootSnapshot = SnapshotFrom<typeof defaultRootMachine>;

/** Return value of {@link createTrackingSubscriber}. */
export interface TrackingSubscriber {
  /** Detach every snapshot + emit listener. Idempotent. */
  unsubscribe: () => void;
  /**
   * Forward a host-driven analytics signal (entrypoint impression/click, view
   * dismissal, cart/order events). Enriches with `current-step` from the
   * snapshot delta where the event spec requires it, then calls
   * `tracking.trackEvent`. Best-effort — same fire-and-forget semantics as
   * the machine-driven path.
   */
  trackHostEvent: (signal: HostAnalyticsSignal) => void;
}

/** Every {@link AnalyticsSignal} type we want to listen for. */
const ALL_SIGNAL_TYPES = [
  "intro-opened",
  "consent-granted",
  "image-record-initiated",
  "image-record-aborted",
  "image-upload-initiated",
  "image-upload-aborted",
  "image-uploaded",
  "height-entered",
  "variant-selection-initiated",
  "try-on-initiated",
] as const;

/**
 * Wires an actor's emitted {@link AnalyticsSignal}s into a
 * {@link TrackingClient}, and exposes {@link TrackingSubscriber.trackHostEvent}
 * for events the host fires directly.
 *
 * - Subscribes to snapshots to track the current {@link Step} (XState's state
 *   delta is the source of truth — no context bookkeeping required).
 * - Listens to every emit type, enriches with derived fields, forwards to
 *   `tracking.trackEvent`.
 */
export function createTrackingSubscriber(
  actor: DefaultRootActor,
  tracking: TrackingClient,
): TrackingSubscriber {
  // Seeded to "entry" (pre-flow). XState publishes the snapshot AFTER entry
  // actions run, so at emit time `lastObservedStep` still reflects the step
  // the actor was IN immediately before the emit — that's the natural
  // "source" semantic for events that need it (intro-opened, height-entered,
  // etc.). Initialising from `getSnapshot()` would prematurely advance the
  // value to the machine's initial state and break the very first emit.
  let lastObservedStep: Step = "entry";

  const snapshotSub = actor.subscribe((snapshot: DefaultRootSnapshot) => {
    lastObservedStep = stepFromSnapshot(snapshot);
  });

  const forward = (signal: AnalyticsSignal): void => {
    const event = enrichSignal(signal, lastObservedStep);
    tracking.trackEvent(event);
  };

  const emitSubs = ALL_SIGNAL_TYPES.map((t) => actor.on(t, forward));

  return {
    unsubscribe: () => {
      snapshotSub.unsubscribe();
      for (const sub of emitSubs) {
        sub.unsubscribe();
      }
    },
    trackHostEvent: (signal) => {
      const event = enrichHostSignal(signal, lastObservedStep);
      tracking.trackEvent(event);
    },
  };
}
