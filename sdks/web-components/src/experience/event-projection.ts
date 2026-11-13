import type { CartRequest, ExperienceEvent } from "@studio-vaai/core";

import {
  DetachedStage,
  BackendError,
  BodyEvent,
  DeviceError,
  DeviceRecoveryEvent,
  ExperienceFact,
  JourneyEvent,
  PhotoEvent,
  PhotoRejection,
  PhotoSource,
  RefusalReason,
  TryOnRequestFailure,
  TryOnRequestOrigin,
  UncertainWork,
} from "@studio-vaai/core";

import type {
  TryOnExperienceEvent,
  TryOnExperienceEventMap,
  TryOnExperienceStep,
} from "./events.js";

import { journeyStep } from "./presentation.js";

const backendReason = {
  [BackendError.InvalidRequest]: "invalid-request",
  [BackendError.NotFound]: "not-found",
  [BackendError.BodyNotFound]: "body-not-found",
  [BackendError.Unusable]: "unusable",
  [BackendError.Internal]: "internal",
  [BackendError.Unavailable]: "unavailable",
} as const;
const photoReason = {
  [PhotoRejection.NoHumanDetected]: "no-human-detected",
  [PhotoRejection.HumanOccluded]: "human-occluded",
  [PhotoRejection.HumanNotStanding]: "human-not-standing",
  [PhotoRejection.HumanTooSmall]: "human-too-small",
  [PhotoRejection.InappropriateClothing]: "inappropriate-clothing",
} as const;
const refusalReason = {
  [RefusalReason.GarmentTooSmall]: "garment-too-small",
  [RefusalReason.GarmentTooLarge]: "garment-too-large",
} as const;

const detachedStage = {
  [DetachedStage.Waiting]: "waiting",
  [DetachedStage.Rendering]: "rendering",
  [DetachedStage.Uncertain]: "uncertain",
} as const;

const uncertainWork = {
  [UncertainWork.Photo]: "photo",
  [UncertainWork.Height]: "height",
  [UncertainWork.RequestedTryOn]: "try-on",
  [UncertainWork.BackgroundTryOn]: undefined,
  [UncertainWork.Other]: undefined,
} as const;

type EventContext = Pick<TryOnExperienceEvent["detail"], "productId" | "step">;

const deviceReason = {
  [DeviceError.PermissionDenied]: "permission-denied",
  [DeviceError.Unavailable]: "unavailable",
  [DeviceError.Failed]: "failed",
  [DeviceError.Interrupted]: "interrupted",
} as const;

function photoSource(source: PhotoSource): "camera" | "library" {
  return source === PhotoSource.Camera ? "camera" : "library";
}

export function cartDetail(
  request: CartRequest,
  step: TryOnExperienceStep,
): TryOnExperienceEventMap["sv-try-on-add-to-cart-requested"] {
  return {
    step,
    productId: request.productId,
    variantId: request.variantId,
    foreignIds: Object.freeze(Object.fromEntries(request.foreignIds)),
  };
}

function journeyEvent(journey: JourneyEvent, context: EventContext): TryOnExperienceEvent {
  if (JourneyEvent.Opened.instanceOf(journey)) {
    const { entry, subentry } = journey.inner.entry;
    return {
      type: "sv-try-on-opened",
      detail: {
        ...context,
        ...(entry === undefined ? {} : { entry }),
        ...(subentry === undefined ? {} : { subentry }),
      },
    };
  }
  if (JourneyEvent.Closed.instanceOf(journey)) {
    const { presented } = journey.inner;
    return {
      type: "sv-try-on-closed",
      detail: {
        ...context,
        ...(presented === undefined ? {} : { displayed: Object.freeze(presented) }),
      },
    };
  }
  if (JourneyEvent.StepChanged.instanceOf(journey)) {
    const { previous } = journey.inner;
    return {
      type: "sv-try-on-step-changed",
      detail: {
        ...context,
        ...(previous === undefined ? {} : { previousStep: journeyStep(previous) }),
      },
    };
  }
  if (
    JourneyEvent.PhotoSourceStarted.instanceOf(journey) ||
    JourneyEvent.PhotoSourceCancelled.instanceOf(journey)
  ) {
    return {
      type: JourneyEvent.PhotoSourceStarted.instanceOf(journey)
        ? "sv-try-on-photo-source-started"
        : "sv-try-on-photo-source-cancelled",
      detail: {
        ...context,
        source: photoSource(journey.inner.source),
        originStep: journeyStep(journey.inner.origin),
      },
    };
  }
  if (JourneyEvent.PhotoProcessing.instanceOf(journey)) {
    return {
      type: "sv-try-on-photo-processing",
      detail: { ...context, source: photoSource(journey.inner.source) },
    };
  }
  if (JourneyEvent.VariantChanged.instanceOf(journey)) {
    return {
      type: "sv-try-on-variant-changed",
      detail: {
        ...context,
        variantId: journey.inner.variantId,
        foreignIds: Object.freeze(Object.fromEntries(journey.inner.foreignIds)),
      },
    };
  }
  return { type: "sv-try-on-presented", detail: { ...context, ...journey.inner.result } };
}

function deviceEvent(
  recovery: DeviceRecoveryEvent,
  context: EventContext,
): TryOnExperienceEvent | undefined {
  if (DeviceRecoveryEvent.PickerCancelled.instanceOf(recovery)) {
    return undefined;
  }
  const reason = deviceReason[recovery.inner.error];
  if (DeviceRecoveryEvent.PickerFailed.instanceOf(recovery)) {
    return { type: "sv-try-on-picker-failed", detail: { ...context, reason } };
  }
  if (DeviceRecoveryEvent.CaptureFailed.instanceOf(recovery)) {
    return { type: "sv-try-on-capture-failed", detail: { ...context, reason } };
  }
  return {
    type: "sv-try-on-camera-failed",
    detail: {
      ...context,
      phase: DeviceRecoveryEvent.CameraAcquireFailed.instanceOf(recovery) ? "acquire" : "stream",
      reason,
    },
  };
}

/** Translate a complete Rust fact into the existing DOM event contract. */
export function experienceEvent({
  productId,
  step,
  fact,
}: ExperienceEvent): TryOnExperienceEvent | undefined {
  const context = { productId, step: journeyStep(step) };
  if (ExperienceFact.Journey.instanceOf(fact)) {
    return journeyEvent(fact.inner.event, context);
  }
  if (ExperienceFact.ConsentGranted.instanceOf(fact)) {
    return { type: "sv-try-on-consent-granted", detail: context };
  }
  if (ExperienceFact.SessionFailed.instanceOf(fact)) {
    return {
      type: "sv-try-on-session-failed",
      detail: { ...context, reason: backendReason[fact.inner.error] },
    };
  }
  if (ExperienceFact.Photo.instanceOf(fact)) {
    const { event } = fact.inner;
    const detail = { ...context, source: photoSource(event.inner.photo.source) };
    if (PhotoEvent.Committed.instanceOf(event)) {
      return { type: "sv-try-on-photo-accepted", detail };
    }
    if (PhotoEvent.Rejected.instanceOf(event)) {
      return {
        type: "sv-try-on-photo-rejected",
        detail: { ...detail, reason: photoReason[event.inner.reason] },
      };
    }
    return {
      type: "sv-try-on-photo-failed",
      detail: { ...detail, reason: backendReason[event.inner.error] },
    };
  }
  if (ExperienceFact.Height.instanceOf(fact)) {
    const { event } = fact.inner;
    return BodyEvent.HeightSet.instanceOf(event)
      ? { type: "sv-try-on-height-confirmed", detail: context }
      : {
          type: "sv-try-on-height-failed",
          detail: { ...context, reason: backendReason[event.inner.error] },
        };
  }
  if (ExperienceFact.OperationUncertain.instanceOf(fact)) {
    const work = uncertainWork[fact.inner.work];
    return work === undefined
      ? undefined
      : { type: "sv-try-on-operation-uncertain", detail: { ...context, work } };
  }
  if (ExperienceFact.DeviceRecovery.instanceOf(fact)) {
    return deviceEvent(fact.inner.event, context);
  }
  if (ExperienceFact.TryOnRequested.instanceOf(fact)) {
    const { foreignIds, origin, ...request } = fact.inner;
    return {
      type: "sv-try-on-requested",
      detail: {
        ...context,
        ...request,
        origin: origin === TryOnRequestOrigin.Shopper ? "shopper" : "automatic",
        foreignIds: Object.freeze(Object.fromEntries(foreignIds)),
      },
    };
  }
  if (ExperienceFact.TryOnRendered.instanceOf(fact)) {
    return { type: "sv-try-on-rendered", detail: { ...context, ...fact.inner } };
  }
  if (ExperienceFact.TryOnResolved.instanceOf(fact)) {
    return { type: "sv-try-on-request-resolved", detail: { ...context, ...fact.inner } };
  }
  if (ExperienceFact.TryOnRefused.instanceOf(fact)) {
    const { reason, ...request } = fact.inner;
    return {
      type: "sv-try-on-refused",
      detail: { ...context, ...request, reason: refusalReason[reason] },
    };
  }
  if (ExperienceFact.TryOnFailed.instanceOf(fact)) {
    const { failure, ...request } = fact.inner;
    return {
      type: "sv-try-on-failed",
      detail: {
        ...context,
        ...request,
        reason:
          TryOnRequestFailure.Backend.instanceOf(failure) ||
          TryOnRequestFailure.SetHeightFailed.instanceOf(failure)
            ? backendReason[failure.inner.error]
            : "inadmissible",
      },
    };
  }
  if (ExperienceFact.TryOnDetached.instanceOf(fact)) {
    const { stage, ...request } = fact.inner;
    return {
      type: "sv-try-on-detached",
      detail: { ...context, ...request, stage: detachedStage[stage] },
    };
  }
  return {
    type: "sv-try-on-add-to-cart-requested",
    detail: cartDetail(fact.inner.request, context.step),
  };
}
