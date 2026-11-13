import type {
  MessageId,
  FlowView,
  PresentationView,
  TryOn,
  TryOnExperienceStep,
  PhotoUploadView,
  ScreenView,
  TryOnId,
} from "@studio-vaai/core";

import {
  DisplayedImage,
  BodyProgress,
  JourneyStep,
  TryOnProgress,
  TryOnFailureKind,
  TryOnWarning,
  variantLabelValue,
} from "@studio-vaai/core";

export function tryOnResults(view: FlowView): TryOn[] {
  return view.domain.tryOns;
}

export function displayedTryOnId(presentation: PresentationView): TryOnId | undefined {
  return DisplayedImage.TryOn.instanceOf(presentation.displayed)
    ? presentation.displayed.inner.tryOnId
    : undefined;
}

export function heightPending(view: FlowView): boolean {
  return view.journey.bodyProgress === BodyProgress.SavingHeight;
}

export function uncertainBodyMessage(view: FlowView): MessageId | undefined {
  // oxlint-disable-next-line eslint/default-case -- Every body progress state is handled.
  switch (view.journey.bodyProgress) {
    case BodyProgress.HeightUncertain: {
      return "experience.heightUncertain";
    }
    case BodyProgress.RenderUncertain: {
      return "experience.renderUncertain";
    }
    case BodyProgress.Idle:
    case BodyProgress.SavingHeight: {
      return undefined;
    }
  }
}

const journeySteps = {
  [JourneyStep.Intro]: "intro",
  [JourneyStep.Camera]: "camera",
  [JourneyStep.PhotoUpload]: "photo-upload",
  [JourneyStep.PhotoRejected]: "photo-rejected",
  [JourneyStep.Height]: "height",
  [JourneyStep.VariantSelection]: "variant-selection",
  [JourneyStep.TryOn]: "try-on",
} as const satisfies Record<JourneyStep, TryOnExperienceStep>;

export function journeyStep(step: JourneyStep): TryOnExperienceStep {
  return journeySteps[step];
}

type ExperienceScreen =
  | ({ step: "photo-upload" } & PhotoUploadView)
  | { step: Exclude<TryOnExperienceStep, "photo-upload"> };

export function experienceScreen(view: FlowView): ExperienceScreen {
  const step = journeyStep(view.journey.step);
  if (step === "photo-upload" && view.journey.photoUpload !== undefined) {
    return { step, ...view.journey.photoUpload };
  }
  return { step: step === "photo-upload" ? "intro" : step };
}

const warnings = {
  [TryOnWarning.HeightUncertain]: "experience.heightUncertain",
  [TryOnWarning.RenderUncertain]: "experience.renderUncertain",
  [TryOnWarning.PickerFailed]: "experience.pickerFailed",
  [TryOnWarning.TooSmall]: "experience.tryOnTooSmall",
  [TryOnWarning.TooLarge]: "experience.tryOnTooLarge",
  [TryOnWarning.OutOfStock]: "experience.variantUnavailable",
} as const satisfies Record<TryOnWarning, MessageId>;

const failures = {
  [TryOnFailureKind.TooSmall]: ["experience.tryOnTooSmall", "experience.namedTryOnTooSmall"],
  [TryOnFailureKind.TooLarge]: ["experience.tryOnTooLarge", "experience.namedTryOnTooLarge"],
  [TryOnFailureKind.BodyMissing]: ["experience.bodyMissing"],
  [TryOnFailureKind.VariantMissing]: ["experience.tryOnVariantMissing"],
  [TryOnFailureKind.InputsUnavailable]: ["experience.tryOnInputsUnavailable"],
  [TryOnFailureKind.NoSuitableSize]: ["experience.noSuitableSize"],
  [TryOnFailureKind.Failed]: ["experience.tryOnFailed", "experience.namedTryOnFailed"],
} satisfies Record<TryOnFailureKind, readonly [MessageId, MessageId?]>;

export function tryOnScreenState(view: FlowView, screen: InstanceType<typeof ScreenView.TryOn>) {
  const { selection, presentation } = screen.inner;
  const { feedback, progress } = presentation;
  const variants = view.domain.product?.variants ?? [];
  const requested =
    feedback?.variantId === undefined
      ? undefined
      : variantLabelValue(feedback.variantId, variants, selection.rows, selection.labelFormats);
  const messages = feedback?.failure === undefined ? undefined : failures[feedback.failure];
  const failure =
    requested === undefined || requested.axes.length === 0
      ? messages?.[0]
      : (messages?.[1] ?? messages?.[0]);
  const suggestedLabel =
    presentation.suggestedVariantId === undefined
      ? undefined
      : variantLabelValue(
          presentation.suggestedVariantId,
          variants,
          selection.rows.filter(({ key }) => feedback?.suggestionAxes.includes(key) === true),
          selection.labelFormats,
        );
  const savingHeight = heightPending(view);
  let progressMessage: MessageId | undefined;
  if (savingHeight) {
    progressMessage = "experience.savingHeight";
  } else if (progress === TryOnProgress.Queued) {
    progressMessage = "experience.renderQueued";
  }
  return {
    displayed: displayedTryOnId(presentation),
    progress,
    progressMessage,
    savingHeight,
    failure,
    requested,
    retryVariantId: presentation.retryVariantId,
    suggestedLabel:
      suggestedLabel !== undefined && suggestedLabel.axes.length > 0 ? suggestedLabel : undefined,
    warning: feedback?.warning === undefined ? undefined : warnings[feedback.warning],
    noSize: feedback?.noSuitableSize === true,
  };
}
