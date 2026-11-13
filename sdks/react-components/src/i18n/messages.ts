import type { BodyValidationCode } from "@studio-vaai/js-client";
import type { MessagePart } from "messageformat";

import { MessageFormat } from "messageformat";
import { createElement, Fragment, type ReactNode } from "react";

/**
 * Unicode MessageFormat 2 (MF2) source strings for studio vaai batteries.
 * Placeholders use `{$name}` (see {@link https://unicode.org/reports/tr35/tr35-messageFormat.html}).
 *
 * Inline links use MF2 literal markup: `"... {#link href=|https://example.com|}label{/link} ..."`
 * (escape `|` inside the URL as `\|`). Hosts that need a different URL — e.g. their own
 * privacy/DSE page — override the relevant source string via the `messages` prop on
 * {@link StudioVaaiDefaultFlow}; the bundled `legalFooter` ships with generic
 * `studio-vaai.com` AGB + Datenschutz URLs per locale.
 */
export interface StudioVaaiUiMessagesSource {
  sessionIntro: {
    sheetTitle: string;
    /**
     * One-line orientation under the sheet title. No longer rendered by the default
     * intro screen — its subtitle row now carries the "powered by" attribution — but
     * kept for hosts that compose their own intro.
     */
    sheetSubtitle: string;
    /**
     * The three-step "how this works" list. Keep each step to a short verb phrase —
     * they render beside a counter disc, not as sentences.
     */
    steps: {
      uploadPhoto: string;
      enterHeight: string;
      trySizes: string;
    };
    /** Header of the collapsible photo-handling reassurances. */
    photoFactsTitle: string;
    /** The reassurances themselves, in the order they render (image / eye / bin). */
    photoFacts: {
      onlyForTryOn: string;
      nobodyElseSees: string;
      deletedAfter: string;
    };
    /**
     * Label of the inline disclosure under the consent checkbox that reveals
     * {@link withdrawalDisclosureBody} — the Art. 7(3) GDPR withdrawal notice.
     */
    withdrawalDisclosureLabel: string;
    /** Body revealed by {@link withdrawalDisclosureLabel}. */
    withdrawalDisclosureBody: string;
    /**
     * Consent checkbox label — the explicit Art. 9 GDPR opt-in for processing the
     * user's photo and derived body measurements. Plain text (no inline links);
     * the AGB / Datenschutz links live in {@link legalFooter}.
     */
    consentLegal: string;
    /**
     * Legal notice rendered above the primary CTA in the session-intro footer.
     * Communicates implicit T&C acceptance on click and points to the privacy
     * policy. The default bundles generic `studio-vaai.com` URLs for both links;
     * hosts override this whole string to point at their own AGB / DSE pages.
     */
    legalFooter: string;
    /** Primary CTA — open the system file picker for an existing photo. */
    primaryCtaPhoto: string;
    /** Secondary CTA — open the in-browser camera flow with self-timer capture. */
    secondaryCtaCamera: string;
    busyUploadSr: string;
    defaultProductName: string;
    defaultSizeLabel: string;
    /** MF2: `{$product}`, `{$size}` */
    createSessionError: string;
    uploadError: string;
    /**
     * Shown when the user clicks the primary CTA without having ticked the
     * consent checkbox. The button looks disabled but stays clickable via the
     * always-enabled, explain-on-click pattern, so this surfaces on click.
     */
    consentRequired: string;
  };
  photoUpload: {
    title: string;
    primaryRetry: string;
    fallbackError: string;
    guideLink: string;
    guideSheetTitle: string;
    guideClose: string;
    /** Screen reader label while a retry upload is in flight (matches primary button spinner). */
    busyRetryUploadSr: string;
  };
  /**
   * @deprecated No longer rendered: the intro's guide figure ships as per-locale artwork with
   * the labels baked in (see `GuideGraphic`), so these strings have nothing to annotate. Kept
   * so existing host overrides keep compiling; remove on the next major.
   */
  guideGraphic: {
    fullBody: string;
    naturalPose: string;
    everydayClothing: string;
  };
  photoCapture: {
    /** Sheet header. */
    title: string;
    /** One-line orientation under the sheet title. */
    subtitle: string;
    /** Body copy in the live state, describing pose + auto-shutter for the self-timer. */
    infoBody: string;
    /**
     * Body shown in the `idle` state while the browser permission prompt is visible —
     * instructs the user to accept camera access so the live preview can open.
     */
    permissionPromptBody: string;
    /** CTA shown in the `idle` (pre-permission) state to trigger getUserMedia. */
    allowCameraCta: string;
    /** Ghost CTA under the self-timer button — bail out of the camera into the system file picker. */
    uploadFromLibraryCta: string;
    /** Primary CTA in the `live` state. MF2: `{$seconds}` — e.g. "Start self-timer (10s)". */
    selfTimerCta: string;
    /** Primary CTA while a countdown is running — cancels the self-timer. */
    cancelTimerCta: string;
    /** Heading for the `denied` state (permission rejected by the browser / OS). */
    permissionDeniedTitle: string;
    /** Body for the `denied` state, instructing the user where to flip the setting. */
    permissionDeniedBody: string;
    /** Body for the `unavailable` state (no camera hardware / not allowed by policy). */
    unavailableBody: string;
    /** Body for the generic `error` state (NotReadableError / OverconstrainedError / …). */
    fallbackError: string;
    /** Retry CTA on error / denied / unavailable states. */
    retry: string;
    /** Screen-reader label while an auto-capture is in flight (matches primary button spinner). */
    busyAutoCaptureSr: string;
    /**
     * Status shown once the shutter has fired and the still is being uploaded. Distinct from
     * {@link busyAutoCaptureSr}: by this point the capture is DONE, and saying it is still
     * running described the wrong step.
     */
    busyUpload: string;
    /** Screen-reader label for the "switch camera" affordance shown when the host has multiple video inputs. */
    switchCameraSr: string;
    /** Screen-reader live announcement for the countdown overlay. MF2: `{$seconds}`. */
    countdownSr: string;
    /** Confirmation before discarding a self-recorded photo to open the camera again. */
    retakeTitle: string;
    retakeBody: string;
    retakeContinue: string;
    retakeCancel: string;
  };
  heightCalibration: {
    title: string;
    /** One-line orientation under the sheet title. */
    subtitle: string;
    heightPickerLabel: string;
    confirm: string;
    useOtherImage: string;
    /** Screen reader label while height is being saved (matches primary button spinner). */
    busyCalibrateSr: string;
    fallbackError: string;
    /** Screen-reader name of the height picker when no visible heading labels it. */
    heightInputSr: string;
    /** Screen-reader names of the height stepper's up and down buttons. */
    increaseHeightSr: string;
    decreaseHeightSr: string;
  };
  productOverview: {
    busyTryOnSr: string;
    /**
     * MF2: `{$sizeLabel}`, `{$colorLabel}`, internal selector `hasColor` (`yes` vs fallback).
     * Uses `.match` so locales can phrase size-only vs size+color in one bundle.
     */
    tryOnCta: string;
    /**
     * Shown in place of `tryOnCta` when the host hasn't picked a full variant yet
     * (size / color not yet chosen, or the picked combo doesn't match a known variant).
     * The CTA is non-actionable in this state but stays clickable via the
     * always-enabled, explain-on-click pattern (`aria-disabled`, routing to
     * {@link selectionRequired} on click) — see `Button.onClickDisabled`.
     */
    selectVariantCta: string;
    /** One-line orientation under the sheet title of the size-selection step. */
    sheetSubtitle: string;
    /**
     * Shown when the user clicks the try-on CTA before picking a full variant
     * (the button looks disabled but stays clickable and explains what's missing
     * on click — the always-enabled, explain-on-click pattern).
     * MF2: `{$missing :list}` — a conjunction list of the missing axis names
     * (drawn from {@link attributeName}), e.g. "Bitte wähle eine Größe und eine
     * Farbe aus." The `:list` custom function handles the locale conjunction, so
     * one template covers any number of missing axes.
     */
    selectionRequired: string;
    /**
     * Localized axis *names* (article included so the `:list` reads naturally),
     * fed into {@link selectionRequired}. Product metadata carries value labels
     * (e.g. "Espresso", "M") but no axis-name label, so these live SDK-side.
     * Adding a new attribute axis = add one key here + one branch in `deriveError`.
     */
    attributeName: {
      size: string;
      color: string;
    };
    useAnotherImage: string;
    /** MF2: `{$colorLabel}` */
    colorHeading: string;
    sizeSectionLabel: string;
    getRecommendation: string;
    /** The primary try-on CTA — size-agnostic; renders the currently-selected (defaulted-to-recommended) size. */
    /** MF2: `{$sizeLabel}`. The proactive "your recommended size is X" note above the size grid. */
    recommendedSizeNote: string;
    /**
     * MF2: `{$requestedSize}`, `{$recommendedSize}`. STATEMENT rendered below the size grid
     * after a `garment_too_small` try-on rejection that could not auto-pivot, while the
     * failure is still active (i.e. the user hasn't manually picked a different size since).
     * Informs, never asks — the selection has already jumped to `$recommendedSize`, so the
     * primary CTA is the next step. Server-side hard gate is the source of truth.
     */
    garmentTooSmallNote: string;
    /**
     * MF2: `{$requestedSize}`, `{$recommendedSize}`. Rendered below the size grid
     * after a `garment_too_large` try-on. See `garmentTooSmallNote`.
     */
    garmentTooLargeNote: string;
    /**
     * MF2: `{$requestedSize}`. The `garment_too_small` rejection when the gate has NO other
     * size to send the shopper to — a single-size style, or the smallest/largest already
     * picked. The sized variants above would contradict themselves here ("we recommend S"
     * when S is what just failed), which is why this case used to render nothing at all and
     * left the shopper tapping a CTA that could only fail again.
     */
    garmentTooSmallNoAlternativeNote: string;
    /** MF2: `{$requestedSize}`. See `garmentTooSmallNoAlternativeNote`. */
    garmentTooLargeNoAlternativeNote: string;
    /** Inline chip marker for a size the try-on hard gate would reject as too small. */
    sizeGateTooSmallBadge: string;
    /** Inline chip marker for a size the try-on hard gate would reject as too large. */
    sizeGateTooLargeBadge: string;
    tryOnError: string;
    recommendationError: string;
  };
  tryOnView: {
    /**
     * MF2: `{$size}`, `{$price}`, internal selector `hasPrice` (`yes` vs fallback).
     * The secondary "add to bag" link under the primary CTA. Hosts that don't pass a
     * price label fall through to the size-only phrasing.
     */
    addToCart: string;
    goToProductOverview: string;
    /**
     * MF2: `{$sizeLabel}`, `{$colorLabel}`, internal selector `hasColor` (`yes` vs fallback).
     * The header subtitle naming the variant currently on screen.
     */
    variantSubtitle: string;
    /** MF2: `{$sizeLabel}` — heading of the fit-score ribbon, naming the size it scores. */
    fitScoreTitle: string;
    /** Screen-reader name for the fit-score ribbon's expand/collapse toggle. */
    fitScoreToggleSr: string;
    /** Replaces the fit-score ribbon when the recommendation request failed. */
    fitScoreUnavailable: string;
    /** Screen-reader name for the retry control on the unavailable fit-score bar. */
    fitScoreRetrySr: string;
    /**
     * MF2: `{$sizeLabel}` — inline note under the picker when the rendering of a picked
     * variant failed. States the failure without moving the shopper off the screen; the
     * primary CTA becomes {@link retryTryOnCta}.
     */
    tryOnFailedForVariant: string;
    /** Primary CTA replacing the commit action after a failed try-on render. */
    retryTryOnCta: string;
    /**
     * MF2: `{$sizeLabel}` — inline note replacing the recommendation pill when the shopper
     * taps a size the brand has no stock for.
     */
    sizeSoldOutNote: string;
    /** Screen-reader suffix marking an out-of-stock size chip. */
    sizeSoldOutSr: string;
    /** Accessible name for the strip of already-rendered try-ons under the photo. */
    triedVariantsLabel: string;
    /** Accessible name of the style toggle floating over the try-on image. */
    styleToggleSr: string;
    /**
     * MF2: `{$description}` — the garment's intended look, rendered inside the expanded
     * fit-score card. `$description` is the same auto-derived phrase the fit panel uses
     * (see `intendedLook`), so this string only supplies the lead-in.
     */
    intendedFit: string;
    /** Header of the collapsible size/color section. */
    variantPickerTitle: string;
    /** Screen-reader name for the size/color section's expand/collapse toggle. */
    variantPickerToggleSr: string;
    /** Axis label before the size chips on single-axis products. */
    sizeAxisLabel: string;
    /** MF2: `{$sizeLabel}` — the green recommendation pill beside an axis label. */
    recommendedChip: string;
    /** MF2: `{$colorLabel}` — the label above the color swatches. */
    colorAxisLabel: string;
    /**
     * MF2: `{$axisLabel}`, `{$valueLabel}` — the label above one axis of a product sold along
     * several (`Waist: 27`, `Length: 30`). The axis names come from the shop's listing.
     */
    variantAxisLabel: string;
    /** Screen-reader suffix for a chip not offered with the other axes' current picks. */
    variantUnavailableSr: string;
    /**
     * MF2: `{$sizeLabel}`, `{$colorLabel}`, internal selector `hasColor` (`yes` vs fallback).
     * Primary CTA while the size/color section is open — renders the picked combination.
     */
    tryOnVariantCta: string;
    /** Corner caption on the try-on image disclosing that the render is synthesized. */
    aiGeneratedLabel: string;
    /** Accessible name for the corner control that saves the current render. */
    downloadImage: string;
    /** MF2: `{$colorLabel}` */
    colorLine: string;
    /** MF2: `{$sizeLabel}` */
    sizeLine: string;
    /** Shown when the displayed size IS the chart-recommended one; the server rationale is appended raw. */
    recommendedHere: string;
    /** MF2: `{$sizeLabel}`. Nudge when the displayed size differs from the recommended one. */
    recommendedOther: string;
    /**
     * MF2: `{$sizeLabel}`, `{$recommendedSize}`. Shown when the shopper INSPECTS a gated size
     * on the size strip: the fit panel re-scores for it but no try-on is rendered (gated sizes
     * are never simulated), so this note explains why the hero image didn't change.
     *
     * Kept to one short line on purpose — it renders inside `AxisBadge`, which truncates, so a
     * full sentence is cut off mid-word on a phone. States the verdict flatly rather than
     * hedging ("likely"): this is the HARD gate, and the size really is refused.
     */
    gateInspectTooSmallNote: string;
    /** MF2: `{$sizeLabel}`, `{$recommendedSize}`. See `gateInspectTooSmallNote`. */
    gateInspectTooLargeNote: string;
    /**
     * Localized verdict phrases for the per-measurement fit checks, keyed by the server's
     * traffic-light `fit` value. Rendered as `{label}: {verdict} ({±X cm})`.
     */
    fitVerdicts: {
      tooSmall: string;
      runsTight: string;
      ideal: string;
      runsLoose: string;
      tooLoose: string;
    };
    /** Length-dimension variants (sleeves, total length): short/long instead of tight/loose. */
    lengthVerdicts: {
      tooSmall: string;
      runsTight: string;
      ideal: string;
      runsLoose: string;
      tooLoose: string;
    };
    /**
     * Ideal-verdict variant for a length whose INTENT is deliberately styled long (the fit
     * model demonstrates it; band shift ≥ 1): the garment may visibly read long, so the green
     * verdict says it's by design instead of a bare "as intended".
     */
    lengthStyledLong: string;
    /** Mirror of `lengthStyledLong` for deliberately cropped/short intents (shift ≤ −1). */
    lengthStyledShort: string;
    /** Heading of the fit-panel card on the result screen (e.g. "Overall Fit"). */
    fitPanelTitle: string;
    /** Caption under the big fit-match percentage. */
    fitMatchLabel: string;
    /** Heading for the fit-colored size-picker strip (e.g. "Choose your size"). */
    sizePickerTitle: string;
    /** Screen-reader suffix marking the recommended size in the picker (e.g. "recommended"). */
    sizePickerRecommendedSr: string;
    /**
     * Screen-reader suffix for a size the try-on gate rejects. The chip shows this visually as
     * a strike-through, which assistive tech does not announce, so it needs saying in words.
     */
    sizeGateTooSmallSr: string;
    /** Mirror of {@link sizeGateTooSmallSr} for sizes the gate rejects as too large. */
    sizeGateTooLargeSr: string;
    /** MF2: `{$fitProfile}` — a localized profile name from `fitProfiles`. */
    basedOnFitProfile: string;
    /**
     * MF2: `{$height}` (the model's height in cm, a bare number) + `{$size}` (the product's size
     * label). Replaces `fitMatchInfo` as the ⓘ-tooltip body when the brand's published fit model
     * calibrated the recommendation — the fit-model detail lives HERE, not inline next to the
     * score (the shopper is looking at their own photo; a model's stats inline read as noise).
     */
    fitMatchInfoCalibrated: string;
    /**
     * Replaces `fitMatchInfo` as the ⓘ-tooltip body when the size chart was DERIVED from the
     * garment's pattern measurements rather than authored by the brand — the numbers are
     * geometry-true, but the fit intent is an estimate, and the copy must say so.
     */
    fitMatchInfoDerived: string;
    /** Localized names for the chart's authored fit intent. */
    fitProfiles: {
      compression: string;
      close: string;
      slim: string;
      regular: string;
      relaxed: string;
      oversized: string;
    };
    /**
     * Auto-generated intended-look chips after the fit-match label, derived from the intent's
     * band positions (`idealShiftNorm`): one cut word (from the dominant girth) plus notable
     * length traits, dot-separated. Keep each chip short — 1–3 words.
     */
    intendedLook: {
      fitted: string;
      regular: string;
      relaxed: string;
      oversized: string;
      sleevesLong: string;
      sleevesShort: string;
      longline: string;
      cropped: string;
    };
    /** Axis captions under each girth slider, left → right. */
    fitAxis: {
      loose: string;
      regular: string;
      tight: string;
    };
    /** Axis captions under each length slider, left → right. */
    lengthAxis: {
      short: string;
      regular: string;
      long: string;
    };
    /** Tooltip body on a row whose measurement barely differs between the chart's sizes. */
    sameAcrossSizes: string;
    /** Short inline note next to that row's label (keep it a few words — it renders at 11px). */
    sameAcrossSizesShort: string;
    /**
     * Per-dimension ⓘ-tooltip openers on the metric rows: one sentence saying what the
     * measurement means on the shopper's body. Followed by `metricGirthDelta` /
     * `metricLengthDelta` with the concrete cm value.
     */
    metricInfo: {
      chest: string;
      waist: string;
      totalLength: string;
      sleeveLength: string;
      other: string;
    };
    /** MF2: `{$cm}` — signed cm of ease vs the body, appended to a girth row's tooltip. */
    metricGirthDelta: string;
    /** MF2: `{$cm}` — signed cm vs the intended length, appended to a length row's tooltip. */
    metricLengthDelta: string;
    /** Tooltip body on the fit-match headline: how the score is computed, in shopper terms. */
    fitMatchInfo: string;
    /** Screen-reader label for the little info-icon tooltip triggers. */
    infoSr: string;
    /**
     * Roster shown over the hero shimmer while the try-on request is in flight.
     * Rotated periodically in random order; empty array suppresses the overlay (shimmer only).
     */
    busyMessages: string[];
  };
  /**
   * Server-side image-validation rejections. One message per `BodyValidationCode`,
   * surfaced when `BodyApi.createBody` returns `{ status: "failed", failure: { kind: "validation", code, ... } }`.
   * Use {@link bodyFailureMessage} to look up the right message for a given failure.
   */
  bodyFailure: {
    noHumanDetected: string;
    humanOccluded: string;
    humanNotStanding: string;
    humanTooSmall: string;
    inappropriateClothing: string;
  };
  /** Screen-reader labels of the back and close buttons in every sheet's and modal's header. */
  surface: {
    backSr: string;
    closeSr: string;
    /** Visible text before the studio vaai wordmark in the attribution lockup. */
    poweredBy: string;
    /** Accessible name of the whole attribution lockup, wordmark included. */
    poweredBySr: string;
  };
}

/**
 * Compiled UI strings + formatters (MessageFormat v2 at runtime).
 *
 * Fields are `ReactNode` by default so translations can embed `{#link ...}` markup.
 * A handful stay `string` because the call site requires a plain string:
 * - screen-reader / Spinner labels (`busyUploadSr`, `busyCalibrateSr`, `busyTryOnSr`)
 * - data fallbacks passed into MF2 formatters (`defaultProductName`, `defaultSizeLabel`)
 */
export interface StudioVaaiUiMessages {
  /**
   * The canonical BCP 47 tag the bundle formats numbers and lists with. Its language lets
   * components pick locale-variant ASSETS (e.g. the pre-annotated guide graphic, whose labels
   * are baked into the artwork) alongside the localized strings.
   */
  locale: StudioVaaiUiLocale;
  sessionIntro: {
    sheetTitle: ReactNode;
    sheetSubtitle: ReactNode;
    steps: {
      uploadPhoto: ReactNode;
      enterHeight: ReactNode;
      trySizes: ReactNode;
    };
    photoFactsTitle: ReactNode;
    photoFacts: {
      onlyForTryOn: ReactNode;
      nobodyElseSees: ReactNode;
      deletedAfter: ReactNode;
    };
    withdrawalDisclosureLabel: ReactNode;
    withdrawalDisclosureBody: ReactNode;
    primaryCtaPhoto: ReactNode;
    secondaryCtaCamera: ReactNode;
    busyUploadSr: string;
    defaultProductName: string;
    defaultSizeLabel: string;
    consentLegal: ReactNode;
    legalFooter: ReactNode;
    createSessionError: ReactNode;
    uploadError: ReactNode;
    consentRequired: ReactNode;
  };
  photoUpload: {
    title: ReactNode;
    primaryRetry: ReactNode;
    fallbackError: ReactNode;
    guideLink: ReactNode;
    guideSheetTitle: ReactNode;
    guideClose: ReactNode;
    busyRetryUploadSr: string;
  };
  /**
   * @deprecated No longer rendered: the intro's guide figure ships as per-locale artwork with
   * the labels baked in (see `GuideGraphic`), so these strings have nothing to annotate. Kept
   * so existing host overrides keep compiling; remove on the next major.
   */
  guideGraphic: {
    fullBody: string;
    naturalPose: string;
    everydayClothing: string;
  };
  photoCapture: {
    title: ReactNode;
    subtitle: ReactNode;
    infoBody: ReactNode;
    permissionPromptBody: ReactNode;
    allowCameraCta: ReactNode;
    uploadFromLibraryCta: ReactNode;
    selfTimerCta: (seconds: number) => ReactNode;
    cancelTimerCta: ReactNode;
    permissionDeniedTitle: ReactNode;
    permissionDeniedBody: ReactNode;
    unavailableBody: ReactNode;
    fallbackError: ReactNode;
    retry: ReactNode;
    busyAutoCaptureSr: string;
    busyUpload: string;
    switchCameraSr: string;
    countdownSr: (seconds: number) => string;
    retakeTitle: ReactNode;
    retakeBody: ReactNode;
    retakeContinue: ReactNode;
    retakeCancel: ReactNode;
  };
  heightCalibration: {
    title: ReactNode;
    subtitle: ReactNode;
    heightPickerLabel: ReactNode;
    confirm: ReactNode;
    useOtherImage: ReactNode;
    busyCalibrateSr: string;
    fallbackError: ReactNode;
    heightInputSr: string;
    increaseHeightSr: string;
    decreaseHeightSr: string;
  };
  productOverview: {
    busyTryOnSr: string;
    tryOnCta: (sizeLabel: string, colorLabel?: string) => ReactNode;
    /** CTA while the variant is incomplete. `hasColor` picks the size-only wording. */
    selectVariantCta: (hasColor: boolean) => ReactNode;
    sheetSubtitle: ReactNode;
    /** Renders the "what's missing" prompt from a list of localized axis names. */
    selectionRequired: (missing: string[]) => ReactNode;
    /** Localized axis names (plain strings) fed into {@link selectionRequired}. */
    attributeName: {
      size: string;
      color: string;
    };
    useAnotherImage: ReactNode;
    colorHeading: (colorLabel: string) => ReactNode;
    sizeSectionLabel: ReactNode;
    getRecommendation: ReactNode;
    recommendedSizeNote: (sizeLabel: string) => ReactNode;
    garmentTooSmallNote: (requestedSize: string, recommendedSize: string) => ReactNode;
    garmentTooLargeNote: (requestedSize: string, recommendedSize: string) => ReactNode;
    garmentTooSmallNoAlternativeNote: (requestedSize: string) => ReactNode;
    garmentTooLargeNoAlternativeNote: (requestedSize: string) => ReactNode;
    sizeGateTooSmallBadge: ReactNode;
    sizeGateTooLargeBadge: ReactNode;
    tryOnError: ReactNode;
    recommendationError: ReactNode;
  };
  tryOnView: {
    /** `price` is a fully formatted, localized price label (e.g. "€89"); omit for size-only copy. */
    addToCart: (size: string, price?: string) => ReactNode;
    goToProductOverview: ReactNode;
    variantSubtitle: (sizeLabel: string, colorLabel?: string) => ReactNode;
    fitScoreTitle: (sizeLabel: string) => ReactNode;
    fitScoreToggleSr: string;
    fitScoreUnavailable: ReactNode;
    fitScoreRetrySr: string;
    tryOnFailedForVariant: (sizeLabel: string) => ReactNode;
    retryTryOnCta: ReactNode;
    sizeSoldOutNote: (sizeLabel: string) => ReactNode;
    sizeSoldOutSr: string;
    triedVariantsLabel: string;
    styleToggleSr: string;
    intendedFit: (description: string) => ReactNode;
    variantPickerTitle: ReactNode;
    variantPickerToggleSr: string;
    /** Axis label naming the pick ("Size: 32"), mirroring {@link colorAxisLabel}. */
    sizeAxisLabel: (sizeLabel?: string) => ReactNode;
    recommendedChip: (sizeLabel: string) => ReactNode;
    colorAxisLabel: (colorLabel: string) => ReactNode;
    variantAxisLabel: (axisLabel: string, valueLabel: string) => ReactNode;
    variantUnavailableSr: string;
    tryOnVariantCta: (sizeLabel: string, colorLabel?: string) => ReactNode;
    aiGeneratedLabel: ReactNode;
    downloadImage: string;
    colorLine: (colorLabel: string) => ReactNode;
    sizeLine: (sizeLabel: string) => ReactNode;
    recommendedHere: ReactNode;
    recommendedOther: (sizeLabel: string) => ReactNode;
    gateInspectTooSmallNote: (sizeLabel: string, recommendedSize: string) => ReactNode;
    gateInspectTooLargeNote: (sizeLabel: string, recommendedSize: string) => ReactNode;
    /** Plain strings (not rich) so they compose into one-line check rows. */
    fitVerdicts: {
      tooSmall: string;
      runsTight: string;
      ideal: string;
      runsLoose: string;
      tooLoose: string;
    };
    /** Length-dimension variants (sleeves, total length): short/long instead of tight/loose. */
    lengthVerdicts: {
      tooSmall: string;
      runsTight: string;
      ideal: string;
      runsLoose: string;
      tooLoose: string;
    };
    /**
     * Ideal-verdict variant for a length whose INTENT is deliberately styled long (the fit
     * model demonstrates it; band shift ≥ 1): the garment may visibly read long, so the green
     * verdict says it's by design instead of a bare "as intended".
     */
    lengthStyledLong: string;
    /** Mirror of `lengthStyledLong` for deliberately cropped/short intents (shift ≤ −1). */
    lengthStyledShort: string;
    fitPanelTitle: ReactNode;
    fitMatchLabel: ReactNode;
    sizePickerTitle: ReactNode;
    sizePickerRecommendedSr: string;
    sizeGateTooSmallSr: string;
    sizeGateTooLargeSr: string;
    basedOnFitProfile: (fitProfile: string) => ReactNode;
    /**
     * Calibrated ⓘ-tooltip body; `height` is the model's height in cm (bare number string),
     * `size` the product size label.
     */
    fitMatchInfoCalibrated: (height: string, size: string) => ReactNode;
    fitMatchInfoDerived: ReactNode;
    /** Plain strings: fed into {@link basedOnFitProfile} and rendered inline. */
    fitProfiles: {
      compression: string;
      close: string;
      slim: string;
      regular: string;
      relaxed: string;
      oversized: string;
    };
    /** Plain strings: the auto-generated intended-look chips. */
    intendedLook: {
      fitted: string;
      regular: string;
      relaxed: string;
      oversized: string;
      sleevesLong: string;
      sleevesShort: string;
      longline: string;
      cropped: string;
    };
    /** Plain strings: the three axis captions under each girth slider. */
    fitAxis: {
      loose: string;
      regular: string;
      tight: string;
    };
    /** Plain strings: the three axis captions under each length slider. */
    lengthAxis: {
      short: string;
      regular: string;
      long: string;
    };
    /** Plain string: tooltip body when a measurement barely differs between sizes. */
    sameAcrossSizes: string;
    /** Plain string: short inline note for such a row. */
    sameAcrossSizesShort: string;
    /** Plain strings: per-dimension metric explainers for the row tooltips. */
    metricInfo: {
      chest: string;
      waist: string;
      totalLength: string;
      sleeveLength: string;
      other: string;
    };
    /** `cm` is the signed value preformatted (e.g. `"+18"`). */
    metricGirthDelta: (cm: string) => ReactNode;
    metricLengthDelta: (cm: string) => ReactNode;
    /** Plain string: tooltip body explaining the fit-match score. */
    fitMatchInfo: string;
    /** Plain string: aria-label for info-icon tooltip triggers. */
    infoSr: string;
    busyMessages: string[];
  };
  bodyFailure: {
    noHumanDetected: ReactNode;
    humanOccluded: ReactNode;
    humanNotStanding: ReactNode;
    humanTooSmall: ReactNode;
    inappropriateClothing: ReactNode;
  };
  surface: {
    backSr: string;
    closeSr: string;
    poweredBy: string;
    poweredBySr: string;
  };
}

/**
 * The UI language: any BCP 47 tag, such as `de`, `de-AT`, `en-GB` or `fr`.
 *
 * The tag's language picks the catalog. The SDK ships `de` and `en`; any other language uses
 * the English catalog unless the host supplies its own through `messages`. Number and list
 * formatting follows the full tag, so `de-CH` gets Swiss separators. An invalid tag falls back
 * to `en`.
 */
// `string & {}` keeps editor completion for the shipped languages while accepting any tag.
// oxlint-disable-next-line typescript/ban-types -- the idiom above, not an object type.
export type StudioVaaiUiLocale = "de" | "en" | (string & {});

/**
 * Deep partial for MF2 overrides passed to {@link StudioVaaiUiProvider}. A complete
 * {@link StudioVaaiUiMessagesSource} is accepted too: that is how a host ships a language the SDK
 * has no catalog for. Keys left out keep the base catalog's text.
 */
export interface PartialStudioVaaiUiMessagesSource {
  sessionIntro?: Partial<StudioVaaiUiMessagesSource["sessionIntro"]>;
  photoUpload?: Partial<StudioVaaiUiMessagesSource["photoUpload"]>;
  guideGraphic?: Partial<StudioVaaiUiMessagesSource["guideGraphic"]>;
  photoCapture?: Partial<StudioVaaiUiMessagesSource["photoCapture"]>;
  heightCalibration?: Partial<StudioVaaiUiMessagesSource["heightCalibration"]>;
  productOverview?: Partial<StudioVaaiUiMessagesSource["productOverview"]>;
  tryOnView?: Partial<StudioVaaiUiMessagesSource["tryOnView"]>;
  bodyFailure?: Partial<StudioVaaiUiMessagesSource["bodyFailure"]>;
  surface?: Partial<StudioVaaiUiMessagesSource["surface"]>;
}

/**
 * Custom MF2 `:list` function — formats an array operand into a locale-correct
 * conjunction list ("Größe und Farbe" / "size, color and length") via
 * `Intl.ListFormat`. Used by `productOverview.selectionRequired` so a single
 * template phrases "what's missing" regardless of how many attribute axes a
 * product exposes. Returns a `string`-typed message value (collapses to the
 * built-in string part, so {@link partsToReactNode} renders it as plain text).
 */
function listFunction(
  ctx: { locales: string[] },
  _options: Record<string, unknown>,
  operand?: unknown,
): {
  type: "string";
  toString: () => string;
  toParts: () => { type: "string"; locale: string; value: string }[];
  valueOf: () => string;
} {
  let items: string[];
  if (Array.isArray(operand)) {
    items = operand.map(String);
  } else if (operand === undefined || operand === null) {
    items = [];
  } else if (typeof operand === "object") {
    items = [JSON.stringify(operand)];
  } else {
    // oxlint-disable-next-line typescript/no-base-to-string -- Objects and arrays were handled above; stringify the remaining primitive or function.
    items = [String(operand)];
  }
  const value = new Intl.ListFormat(ctx.locales, { type: "conjunction", style: "long" }).format(
    items,
  );
  const locale = ctx.locales[0] ?? "en";
  return {
    type: "string",
    toString: () => value,
    toParts: () => [{ type: "string", locale, value }],
    valueOf: () => value,
  };
}

const MF2_OPTIONS = { bidiIsolation: "none" as const, functions: { list: listFunction } };

// The custom `:list` function reports type `"string"` (it collapses to the
// built-in string part), so the formatter's part type is `"string"` — identical
// in practice to `never` here, but TS tracks the literal on the class.
function mf(locale: string, source: string): MessageFormat<"string"> {
  return new MessageFormat(locale, source, MF2_OPTIONS);
}

/** Canonical form of `tag` (`de_at` → `de-AT`), or `undefined` when it is not a BCP 47 tag. */
function canonicalTag(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag.replaceAll("_", "-"))[0];
  } catch {
    return undefined;
  }
}

/** The language subtag of a tag (`de-AT` → `de`); `en` for an invalid tag. */
export function languageOfTag(tag: string): string {
  const canonical = canonicalTag(tag);
  return canonical === undefined ? "en" : new Intl.Locale(canonical).language;
}

function formatStatic(locale: string, source: string): string {
  return mf(locale, source).format();
}

interface MarkupFrame {
  name: string;
  options: Record<string, unknown> | undefined;
  children: ReactNode[];
  key: number;
}

function renderMarkup(
  name: string,
  options: Record<string, unknown> | undefined,
  children: ReactNode[],
  key: number,
): ReactNode {
  if (name === "link") {
    const href = typeof options?.["href"] === "string" ? options["href"] : undefined;
    if (href === undefined) {
      return createElement(Fragment, { key }, ...children);
    }
    return createElement(
      "a",
      {
        key,
        href,
        target: "_blank",
        rel: "noopener noreferrer",
        style: {
          color: "var(--sv-color-link)",
          textDecoration: "none",
        },
      },
      ...children,
    );
  }
  return createElement(Fragment, { key }, ...children);
}

// Fold a flat MF2 part stream into a React tree: open/close `markup` parts (e.g.
// `{#link}…{/link}`) nest via a frame stack, text/number/date parts become string
// children. Unclosed frames left on the stack at the end are flushed in order.
function partsToReactNode(parts: MessagePart<never>[]): ReactNode {
  const root: ReactNode[] = [];
  const stack: MarkupFrame[] = [];
  let keyCounter = 0;
  const push = (node: ReactNode): void => {
    const top = stack.at(-1);
    if (top === undefined) {
      root.push(node);
    } else {
      top.children.push(node);
    }
  };
  for (const part of parts) {
    if (part.type === "markup") {
      if (part.kind === "open") {
        stack.push({
          name: part.name,
          options: part.options,
          children: [],
          key: keyCounter,
        });
        keyCounter += 1;
      } else if (part.kind === "close") {
        const frame = stack.pop();
        if (frame === undefined || frame.name !== part.name) {
          continue;
        }
        push(renderMarkup(frame.name, frame.options, frame.children, frame.key));
      } else {
        push(renderMarkup(part.name, part.options, [], keyCounter));
        keyCounter += 1;
      }
      continue;
    }
    if (part.type === "text") {
      push(part.value);
      continue;
    }
    if (part.type === "bidiIsolation") {
      push(part.value);
      continue;
    }
    if ("value" in part) {
      const v = part.value;
      if (typeof v === "string") {
        push(v);
        continue;
      }
      if (typeof v === "number" || typeof v === "bigint") {
        push(String(v));
        continue;
      }
    }
    // Number / date-time parts (MessageNumberPart / MessageDateTimePart) carry no
    // top-level `value` — they expose the formatted output via `parts:
    // Intl.{Number,DateTime}FormatPart[]`. Join the inner `value` strings.
    if ("parts" in part && Array.isArray(part.parts)) {
      const segs = part.parts as { value?: unknown }[];
      const joined = segs.map((s) => (typeof s.value === "string" ? s.value : "")).join("");
      if (joined.length > 0) {
        push(joined);
      }
    }
  }
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      break;
    }
    push(renderMarkup(frame.name, frame.options, frame.children, frame.key));
  }
  return root;
}

function formatRich(locale: string, source: string): ReactNode {
  return partsToReactNode(mf(locale, source).formatToParts());
}

function renderRich(compiled: MessageFormat<"string">, values: Record<string, unknown>): ReactNode {
  return partsToReactNode(compiled.formatToParts(values));
}

/**
 * Compile MF2 sources to the runtime {@link StudioVaaiUiMessages} API (cached formatters per bundle).
 * `localeTag` sets number and list formatting only; it does not pick the text. An invalid tag
 * formats as `en`.
 */
export function compileStudioVaaiUiMessages(
  localeTag: StudioVaaiUiLocale,
  source: StudioVaaiUiMessagesSource,
): StudioVaaiUiMessages {
  const locale = canonicalTag(localeTag) ?? "en";
  const si = source.sessionIntro;

  const pc = source.photoUpload;
  const pcam = source.photoCapture;
  const mfSelfTimerCta = mf(locale, pcam.selfTimerCta);
  const mfCountdownSr = mf(locale, pcam.countdownSr);
  const hc = source.heightCalibration;
  const po = source.productOverview;
  const mfTryOnCta = mf(locale, po.tryOnCta);
  const mfSelectionRequired = mf(locale, po.selectionRequired);
  const mfColorHeading = mf(locale, po.colorHeading);
  const mfGarmentTooSmallNote = mf(locale, po.garmentTooSmallNote);
  const mfGarmentTooLargeNote = mf(locale, po.garmentTooLargeNote);
  const mfGarmentTooSmallNoAlt = mf(locale, po.garmentTooSmallNoAlternativeNote);
  const mfGarmentTooLargeNoAlt = mf(locale, po.garmentTooLargeNoAlternativeNote);
  const mfRecommendedSizeNote = mf(locale, po.recommendedSizeNote);
  const tv = source.tryOnView;
  const mfAddToCart = mf(locale, tv.addToCart);
  const mfVariantSubtitle = mf(locale, tv.variantSubtitle);
  const mfFitScoreTitle = mf(locale, tv.fitScoreTitle);
  const mfTryOnFailedForVariant = mf(locale, tv.tryOnFailedForVariant);
  const mfSizeSoldOutNote = mf(locale, tv.sizeSoldOutNote);
  const mfIntendedFit = mf(locale, tv.intendedFit);
  const mfRecommendedChip = mf(locale, tv.recommendedChip);
  const mfColorAxisLabel = mf(locale, tv.colorAxisLabel);
  const mfVariantAxisLabel = mf(locale, tv.variantAxisLabel);
  const mfSizeAxisLabel = mf(locale, tv.sizeAxisLabel);
  const mfTryOnVariantCta = mf(locale, tv.tryOnVariantCta);
  const mfSelectVariantCta = mf(locale, po.selectVariantCta);
  const mfColorLine = mf(locale, tv.colorLine);
  const mfSizeLine = mf(locale, tv.sizeLine);
  const mfRecommendedOther = mf(locale, tv.recommendedOther);
  const mfGateInspectTooSmallNote = mf(locale, tv.gateInspectTooSmallNote);
  const mfGateInspectTooLargeNote = mf(locale, tv.gateInspectTooLargeNote);
  const mfBasedOnFitProfile = mf(locale, tv.basedOnFitProfile);
  const mfFitMatchInfoCalibrated = mf(locale, tv.fitMatchInfoCalibrated);
  const mfMetricGirthDelta = mf(locale, tv.metricGirthDelta);
  const mfMetricLengthDelta = mf(locale, tv.metricLengthDelta);

  return {
    locale,
    sessionIntro: {
      sheetTitle: formatRich(locale, si.sheetTitle),
      sheetSubtitle: formatRich(locale, si.sheetSubtitle),
      steps: {
        uploadPhoto: formatRich(locale, si.steps.uploadPhoto),
        enterHeight: formatRich(locale, si.steps.enterHeight),
        trySizes: formatRich(locale, si.steps.trySizes),
      },
      photoFactsTitle: formatRich(locale, si.photoFactsTitle),
      photoFacts: {
        onlyForTryOn: formatRich(locale, si.photoFacts.onlyForTryOn),
        nobodyElseSees: formatRich(locale, si.photoFacts.nobodyElseSees),
        deletedAfter: formatRich(locale, si.photoFacts.deletedAfter),
      },
      withdrawalDisclosureLabel: formatRich(locale, si.withdrawalDisclosureLabel),
      withdrawalDisclosureBody: formatRich(locale, si.withdrawalDisclosureBody),
      primaryCtaPhoto: formatRich(locale, si.primaryCtaPhoto),
      secondaryCtaCamera: formatRich(locale, si.secondaryCtaCamera),
      busyUploadSr: formatStatic(locale, si.busyUploadSr),
      defaultProductName: formatStatic(locale, si.defaultProductName),
      defaultSizeLabel: formatStatic(locale, si.defaultSizeLabel),
      consentLegal: formatRich(locale, si.consentLegal),
      legalFooter: formatRich(locale, si.legalFooter),
      createSessionError: formatRich(locale, si.createSessionError),
      uploadError: formatRich(locale, si.uploadError),
      consentRequired: formatRich(locale, si.consentRequired),
    },
    photoUpload: {
      title: formatRich(locale, pc.title),
      primaryRetry: formatRich(locale, pc.primaryRetry),
      fallbackError: formatRich(locale, pc.fallbackError),
      guideLink: formatRich(locale, pc.guideLink),
      guideSheetTitle: formatRich(locale, pc.guideSheetTitle),
      guideClose: formatRich(locale, pc.guideClose),
      busyRetryUploadSr: formatStatic(locale, pc.busyRetryUploadSr),
    },
    // Deliberately still compiled from the deprecated source group: the labels are baked into
    // the artwork now, but the compiled field stays until the next major so a host overriding
    // them keeps type-checking. Reading it here is the whole point of keeping it.
    /* oxlint-disable typescript-eslint/no-deprecated */
    guideGraphic: {
      fullBody: formatStatic(locale, source.guideGraphic.fullBody),
      naturalPose: formatStatic(locale, source.guideGraphic.naturalPose),
      everydayClothing: formatStatic(locale, source.guideGraphic.everydayClothing),
    },
    /* oxlint-enable typescript-eslint/no-deprecated */
    photoCapture: {
      title: formatRich(locale, pcam.title),
      subtitle: formatRich(locale, pcam.subtitle),
      infoBody: formatRich(locale, pcam.infoBody),
      permissionPromptBody: formatRich(locale, pcam.permissionPromptBody),
      allowCameraCta: formatRich(locale, pcam.allowCameraCta),
      uploadFromLibraryCta: formatRich(locale, pcam.uploadFromLibraryCta),
      selfTimerCta: (seconds): ReactNode => renderRich(mfSelfTimerCta, { seconds }),
      cancelTimerCta: formatRich(locale, pcam.cancelTimerCta),
      permissionDeniedTitle: formatRich(locale, pcam.permissionDeniedTitle),
      permissionDeniedBody: formatRich(locale, pcam.permissionDeniedBody),
      unavailableBody: formatRich(locale, pcam.unavailableBody),
      fallbackError: formatRich(locale, pcam.fallbackError),
      retry: formatRich(locale, pcam.retry),
      busyAutoCaptureSr: formatStatic(locale, pcam.busyAutoCaptureSr),
      busyUpload: formatStatic(locale, pcam.busyUpload),
      switchCameraSr: formatStatic(locale, pcam.switchCameraSr),
      countdownSr: (seconds): string => mfCountdownSr.format({ seconds }),
      retakeTitle: formatRich(locale, pcam.retakeTitle),
      retakeBody: formatRich(locale, pcam.retakeBody),
      retakeContinue: formatRich(locale, pcam.retakeContinue),
      retakeCancel: formatRich(locale, pcam.retakeCancel),
    },
    heightCalibration: {
      title: formatRich(locale, hc.title),
      subtitle: formatRich(locale, hc.subtitle),
      heightPickerLabel: formatRich(locale, hc.heightPickerLabel),
      confirm: formatRich(locale, hc.confirm),
      useOtherImage: formatRich(locale, hc.useOtherImage),
      busyCalibrateSr: formatStatic(locale, hc.busyCalibrateSr),
      fallbackError: formatRich(locale, hc.fallbackError),
      heightInputSr: formatStatic(locale, hc.heightInputSr),
      increaseHeightSr: formatStatic(locale, hc.increaseHeightSr),
      decreaseHeightSr: formatStatic(locale, hc.decreaseHeightSr),
    },
    productOverview: {
      busyTryOnSr: formatStatic(locale, po.busyTryOnSr),
      tryOnCta: (sizeLabel, colorLabel): ReactNode =>
        renderRich(mfTryOnCta, {
          sizeLabel,
          colorLabel: colorLabel ?? "",
          hasColor: colorLabel !== undefined && colorLabel !== "" ? "yes" : "no",
        }),
      selectVariantCta: (hasColor): ReactNode =>
        renderRich(mfSelectVariantCta, { hasColor: hasColor ? "yes" : "no" }),
      sheetSubtitle: formatRich(locale, po.sheetSubtitle),
      selectionRequired: (missing): ReactNode => renderRich(mfSelectionRequired, { missing }),
      attributeName: {
        size: formatStatic(locale, po.attributeName.size),
        color: formatStatic(locale, po.attributeName.color),
      },
      useAnotherImage: formatRich(locale, po.useAnotherImage),
      colorHeading: (colorLabel): ReactNode => renderRich(mfColorHeading, { colorLabel }),
      sizeSectionLabel: formatRich(locale, po.sizeSectionLabel),
      getRecommendation: formatRich(locale, po.getRecommendation),
      recommendedSizeNote: (sizeLabel): ReactNode =>
        renderRich(mfRecommendedSizeNote, { sizeLabel }),
      garmentTooSmallNote: (requestedSize, recommendedSize): ReactNode =>
        renderRich(mfGarmentTooSmallNote, { requestedSize, recommendedSize }),
      garmentTooLargeNote: (requestedSize, recommendedSize): ReactNode =>
        renderRich(mfGarmentTooLargeNote, { requestedSize, recommendedSize }),
      garmentTooSmallNoAlternativeNote: (requestedSize): ReactNode =>
        renderRich(mfGarmentTooSmallNoAlt, { requestedSize }),
      garmentTooLargeNoAlternativeNote: (requestedSize): ReactNode =>
        renderRich(mfGarmentTooLargeNoAlt, { requestedSize }),
      sizeGateTooSmallBadge: formatRich(locale, po.sizeGateTooSmallBadge),
      sizeGateTooLargeBadge: formatRich(locale, po.sizeGateTooLargeBadge),
      tryOnError: formatRich(locale, po.tryOnError),
      recommendationError: formatRich(locale, po.recommendationError),
    },
    tryOnView: {
      addToCart: (size, price): ReactNode =>
        renderRich(mfAddToCart, {
          size,
          price: price ?? "",
          hasPrice: price !== undefined && price !== "" ? "yes" : "no",
        }),
      goToProductOverview: formatRich(locale, tv.goToProductOverview),
      variantSubtitle: (sizeLabel, colorLabel): ReactNode =>
        renderRich(mfVariantSubtitle, {
          sizeLabel,
          colorLabel: colorLabel ?? "",
          hasColor: colorLabel !== undefined && colorLabel !== "" ? "yes" : "no",
        }),
      fitScoreTitle: (sizeLabel): ReactNode => renderRich(mfFitScoreTitle, { sizeLabel }),
      fitScoreToggleSr: formatStatic(locale, tv.fitScoreToggleSr),
      fitScoreUnavailable: formatRich(locale, tv.fitScoreUnavailable),
      fitScoreRetrySr: formatStatic(locale, tv.fitScoreRetrySr),
      tryOnFailedForVariant: (sizeLabel): ReactNode =>
        renderRich(mfTryOnFailedForVariant, { sizeLabel }),
      retryTryOnCta: formatRich(locale, tv.retryTryOnCta),
      sizeSoldOutNote: (sizeLabel): ReactNode => renderRich(mfSizeSoldOutNote, { sizeLabel }),
      sizeSoldOutSr: formatStatic(locale, tv.sizeSoldOutSr),
      triedVariantsLabel: formatStatic(locale, tv.triedVariantsLabel),
      styleToggleSr: formatStatic(locale, tv.styleToggleSr),
      intendedFit: (description): ReactNode => renderRich(mfIntendedFit, { description }),
      variantPickerTitle: formatRich(locale, tv.variantPickerTitle),
      variantPickerToggleSr: formatStatic(locale, tv.variantPickerToggleSr),
      sizeAxisLabel: (sizeLabel): ReactNode =>
        renderRich(mfSizeAxisLabel, {
          sizeLabel: sizeLabel ?? "",
          hasSize: sizeLabel !== undefined && sizeLabel !== "" ? "yes" : "no",
        }),
      recommendedChip: (sizeLabel): ReactNode => renderRich(mfRecommendedChip, { sizeLabel }),
      colorAxisLabel: (colorLabel): ReactNode => renderRich(mfColorAxisLabel, { colorLabel }),
      variantAxisLabel: (axisLabel, valueLabel): ReactNode =>
        renderRich(mfVariantAxisLabel, { axisLabel, valueLabel }),
      variantUnavailableSr: formatStatic(locale, tv.variantUnavailableSr),
      tryOnVariantCta: (sizeLabel, colorLabel): ReactNode =>
        renderRich(mfTryOnVariantCta, {
          sizeLabel,
          colorLabel: colorLabel ?? "",
          hasColor: colorLabel !== undefined && colorLabel !== "" ? "yes" : "no",
        }),
      aiGeneratedLabel: formatRich(locale, tv.aiGeneratedLabel),
      downloadImage: tv.downloadImage,
      colorLine: (colorLabel): ReactNode => renderRich(mfColorLine, { colorLabel }),
      sizeLine: (sizeLabel): ReactNode => renderRich(mfSizeLine, { sizeLabel }),
      recommendedHere: formatRich(locale, tv.recommendedHere),
      recommendedOther: (sizeLabel): ReactNode => renderRich(mfRecommendedOther, { sizeLabel }),
      gateInspectTooSmallNote: (sizeLabel, recommendedSize): ReactNode =>
        renderRich(mfGateInspectTooSmallNote, { sizeLabel, recommendedSize }),
      gateInspectTooLargeNote: (sizeLabel, recommendedSize): ReactNode =>
        renderRich(mfGateInspectTooLargeNote, { sizeLabel, recommendedSize }),
      fitVerdicts: {
        tooSmall: formatStatic(locale, tv.fitVerdicts.tooSmall),
        runsTight: formatStatic(locale, tv.fitVerdicts.runsTight),
        ideal: formatStatic(locale, tv.fitVerdicts.ideal),
        runsLoose: formatStatic(locale, tv.fitVerdicts.runsLoose),
        tooLoose: formatStatic(locale, tv.fitVerdicts.tooLoose),
      },
      lengthVerdicts: {
        tooSmall: formatStatic(locale, tv.lengthVerdicts.tooSmall),
        runsTight: formatStatic(locale, tv.lengthVerdicts.runsTight),
        ideal: formatStatic(locale, tv.lengthVerdicts.ideal),
        runsLoose: formatStatic(locale, tv.lengthVerdicts.runsLoose),
        tooLoose: formatStatic(locale, tv.lengthVerdicts.tooLoose),
      },
      lengthStyledLong: formatStatic(locale, tv.lengthStyledLong),
      lengthStyledShort: formatStatic(locale, tv.lengthStyledShort),
      fitPanelTitle: formatRich(locale, tv.fitPanelTitle),
      fitMatchLabel: formatRich(locale, tv.fitMatchLabel),
      sizePickerTitle: formatRich(locale, tv.sizePickerTitle),
      sizePickerRecommendedSr: formatStatic(locale, tv.sizePickerRecommendedSr),
      sizeGateTooSmallSr: formatStatic(locale, tv.sizeGateTooSmallSr),
      sizeGateTooLargeSr: formatStatic(locale, tv.sizeGateTooLargeSr),
      basedOnFitProfile: (fitProfile): ReactNode => renderRich(mfBasedOnFitProfile, { fitProfile }),
      fitMatchInfoCalibrated: (height, size): ReactNode =>
        renderRich(mfFitMatchInfoCalibrated, { height, size }),
      fitMatchInfoDerived: formatStatic(locale, tv.fitMatchInfoDerived),
      fitProfiles: {
        compression: formatStatic(locale, tv.fitProfiles.compression),
        close: formatStatic(locale, tv.fitProfiles.close),
        slim: formatStatic(locale, tv.fitProfiles.slim),
        regular: formatStatic(locale, tv.fitProfiles.regular),
        relaxed: formatStatic(locale, tv.fitProfiles.relaxed),
        oversized: formatStatic(locale, tv.fitProfiles.oversized),
      },
      intendedLook: {
        fitted: formatStatic(locale, tv.intendedLook.fitted),
        regular: formatStatic(locale, tv.intendedLook.regular),
        relaxed: formatStatic(locale, tv.intendedLook.relaxed),
        oversized: formatStatic(locale, tv.intendedLook.oversized),
        sleevesLong: formatStatic(locale, tv.intendedLook.sleevesLong),
        sleevesShort: formatStatic(locale, tv.intendedLook.sleevesShort),
        longline: formatStatic(locale, tv.intendedLook.longline),
        cropped: formatStatic(locale, tv.intendedLook.cropped),
      },
      fitAxis: {
        loose: formatStatic(locale, tv.fitAxis.loose),
        regular: formatStatic(locale, tv.fitAxis.regular),
        tight: formatStatic(locale, tv.fitAxis.tight),
      },
      lengthAxis: {
        short: formatStatic(locale, tv.lengthAxis.short),
        regular: formatStatic(locale, tv.lengthAxis.regular),
        long: formatStatic(locale, tv.lengthAxis.long),
      },
      sameAcrossSizes: formatStatic(locale, tv.sameAcrossSizes),
      sameAcrossSizesShort: formatStatic(locale, tv.sameAcrossSizesShort),
      metricInfo: {
        chest: formatStatic(locale, tv.metricInfo.chest),
        waist: formatStatic(locale, tv.metricInfo.waist),
        totalLength: formatStatic(locale, tv.metricInfo.totalLength),
        sleeveLength: formatStatic(locale, tv.metricInfo.sleeveLength),
        other: formatStatic(locale, tv.metricInfo.other),
      },
      metricGirthDelta: (cm): ReactNode => renderRich(mfMetricGirthDelta, { cm }),
      metricLengthDelta: (cm): ReactNode => renderRich(mfMetricLengthDelta, { cm }),
      fitMatchInfo: formatStatic(locale, tv.fitMatchInfo),
      infoSr: formatStatic(locale, tv.infoSr),
      busyMessages: tv.busyMessages.map((m) => formatStatic(locale, m)),
    },
    bodyFailure: {
      noHumanDetected: formatRich(locale, source.bodyFailure.noHumanDetected),
      humanOccluded: formatRich(locale, source.bodyFailure.humanOccluded),
      humanNotStanding: formatRich(locale, source.bodyFailure.humanNotStanding),
      humanTooSmall: formatRich(locale, source.bodyFailure.humanTooSmall),
      inappropriateClothing: formatRich(locale, source.bodyFailure.inappropriateClothing),
    },
    surface: {
      backSr: formatStatic(locale, source.surface.backSr),
      closeSr: formatStatic(locale, source.surface.closeSr),
      poweredBy: formatStatic(locale, source.surface.poweredBy),
      poweredBySr: formatStatic(locale, source.surface.poweredBySr),
    },
  };
}

/**
 * Resolve the correct {@link StudioVaaiUiMessages.bodyFailure} message for a server-side
 * `BodyValidationCode`. Unknown codes (a server newer than this client) fall back to
 * `noHumanDetected` — generic enough that the user gets a sensible "try a different photo"
 * prompt without leaking the unhandled code.
 */
export function bodyFailureMessage(
  messages: StudioVaaiUiMessages,
  code: BodyValidationCode,
): ReactNode {
  switch (code) {
    case "no_human_detected": {
      return messages.bodyFailure.noHumanDetected;
    }
    case "human_occluded": {
      return messages.bodyFailure.humanOccluded;
    }
    case "human_not_standing": {
      return messages.bodyFailure.humanNotStanding;
    }
    case "human_too_small": {
      return messages.bodyFailure.humanTooSmall;
    }
    case "inappropriate_clothing": {
      return messages.bodyFailure.inappropriateClothing;
    }
    default: {
      return messages.bodyFailure.noHumanDetected;
    }
  }
}

export const studioVaaiUiMessagesSourceDe: StudioVaaiUiMessagesSource = {
  sessionIntro: {
    sheetTitle: "Bereit zur Anprobe?",
    sheetSubtitle: "Foto hochladen & verschiedene Größen anprobieren",
    steps: {
      uploadPhoto: "Foto hochladen",
      enterHeight: "Körpergröße angeben",
      trySizes: "Verschiedene Größen anprobieren",
    },
    photoFactsTitle: "Was mit deinem Foto passiert",
    photoFacts: {
      onlyForTryOn: "Wir nutzen dein Foto ausschließlich für die Anprobe.",
      nobodyElseSees: "Außer dir sieht es niemand.",
      deletedAfter: "Direkt danach löschen wir es wieder.",
    },
    withdrawalDisclosureLabel: "Hinweise zu Widerruf & Datenschutz",
    withdrawalDisclosureBody:
      "Diese Einwilligung ist freiwillig. Du kannst sie jederzeit im Widget oder per E-Mail an info@studio-vaai.com widerrufen. Durch den Widerruf wird die Rechtmäßigkeit der bis dahin erfolgten Verarbeitung nicht berührt. Weitere Informationen findest du in unserer {#link href=|https://studio-vaai.com/try-on/privacy|}Datenschutzerklärung{/link}.",
    consentLegal:
      "Ich willige in die Verarbeitung meines Fotos (Gesundheitsdaten) und meiner Körpermaße für die Anprobe ein.",
    legalFooter:
      "Wenn du fortfährst, stimmst du den {#link href=|https://studio-vaai.com/try-on/terms|}AGB{/link} der studio vaai GmbH zu.",
    primaryCtaPhoto: "Foto hochladen",
    secondaryCtaCamera: "Mit Selbstauslöser aufnehmen",
    busyUploadSr: "Wird hochgeladen",
    defaultProductName: "Produkt",
    defaultSizeLabel: "S",
    createSessionError: "Etwas ist schiefgelaufen. Bitte versuch es noch einmal.",
    uploadError: "Dein Foto ließ sich nicht hochladen. Bitte versuch es noch einmal.",
    consentRequired: "Bitte stimme der Verarbeitung zu, um fortzufahren.",
  },
  photoUpload: {
    title: "Bitte nimm ein anderes Foto",
    primaryRetry: "Anderes Foto verwenden",
    fallbackError: "Mit diesem Foto klappt es leider nicht. Bitte probier ein anderes.",
    guideLink: "So gelingt dein Foto",
    guideSheetTitle: "So gelingt dein Foto",
    guideClose: "Schließen",
    busyRetryUploadSr: "Wird hochgeladen",
  },
  // oxlint-disable-next-line typescript/no-deprecated -- Populate legacy messages for existing host overrides.
  guideGraphic: {
    fullBody: "Ganzer Körper:\nvon Kopf bis Fuß",
    naturalPose: "Natürliche\nPose",
    everydayClothing: "Alltagskleidung\n(nicht zu weit)",
  },
  photoCapture: {
    title: "Mit Selbstauslöser aufnehmen",
    subtitle: "Starte den Selbstauslöser und stell dich etwa 1,5 m vor deinen Laptop.",
    infoBody:
      "Stell dich etwa 1,5 m vor die Kamera, sodass du von Kopf bis Fuß zu sehen bist. Die Kamera löst automatisch aus.",
    permissionPromptBody:
      "Für die Aufnahme brauchen wir Zugriff auf deine Kamera. Bitte erlaube ihn in der Anfrage deines Browsers oben.",
    allowCameraCta: "Kamera erlauben",
    uploadFromLibraryCta: "Foto aus der Mediathek wählen",
    selfTimerCta: "Selbstauslöser starten ({$seconds}s)",
    cancelTimerCta: "Selbstauslöser abbrechen",
    permissionDeniedTitle: "Kein Zugriff auf die Kamera",
    permissionDeniedBody: "Bitte erlaube den Kamerazugriff in den Einstellungen deines Browsers.",
    unavailableBody: "Wir finden an diesem Gerät keine Kamera.",
    fallbackError: "Die Kamera ist gerade nicht verfügbar. Bitte versuch es noch einmal.",
    retry: "Erneut versuchen",
    busyAutoCaptureSr: "Aufnahme läuft",
    busyUpload: "Foto wird hochgeladen",
    switchCameraSr: "Kamera wechseln",
    countdownSr: "Aufnahme in {$seconds} Sekunden",
    retakeTitle: "Neues Foto aufnehmen?",
    retakeBody: "Wenn du ein neues Foto aufnimmst, wird dein aktuelles gelöscht.",
    retakeContinue: "Weiter",
    retakeCancel: "Abbrechen",
  },
  heightCalibration: {
    title: "Körpergröße angeben",
    subtitle: "Damit wir die richtige Größe für dich finden",
    heightPickerLabel: "Wie groß bist du?",
    confirm: "Weiter zur Anprobe",
    useOtherImage: "Anderes Foto verwenden",
    busyCalibrateSr: "Körpergröße wird gespeichert",
    fallbackError: "Etwas ist schiefgelaufen. Bitte versuch es noch einmal.",
    heightInputSr: "Körpergröße in cm",
    increaseHeightSr: "Körpergröße erhöhen",
    decreaseHeightSr: "Körpergröße verringern",
  },
  productOverview: {
    busyTryOnSr: "Anprobe wird vorbereitet",
    tryOnCta: `.input {$hasColor :string}
.match $hasColor
yes {{Größe {$sizeLabel} in {$colorLabel} anprobieren}}
* {{Größe {$sizeLabel} anprobieren}}`,
    selectVariantCta: `.input {$hasColor :string}
.match $hasColor
yes {{Größe und Farbe auswählen}}
* {{Größe auswählen}}`,
    selectionRequired: "Bitte wähle {$missing :list} aus.",
    attributeName: {
      size: "eine Größe",
      color: "eine Farbe",
    },
    useAnotherImage: "Anderes Foto verwenden",
    colorHeading: "Farbe: {$colorLabel}",
    sizeSectionLabel: "Größe zum Anprobieren",
    sheetSubtitle: "Wähle Größe und Farbe für deine Anprobe",
    getRecommendation: "Größe empfehlen lassen",
    recommendedSizeNote: "Deine empfohlene Größe: {$sizeLabel}",
    garmentTooSmallNote: "Größe {$requestedSize} ist dir zu klein.",
    garmentTooLargeNote: "Größe {$requestedSize} ist dir zu groß.",
    garmentTooSmallNoAlternativeNote:
      "Größe {$requestedSize} ist für deine Maße zu klein. Größer gibt es dieses Modell nicht, deshalb können wir diese Anprobe leider nicht erstellen.",
    garmentTooLargeNoAlternativeNote:
      "Größe {$requestedSize} ist für deine Maße zu groß. Kleiner gibt es dieses Modell nicht, deshalb können wir diese Anprobe leider nicht erstellen.",
    sizeGateTooSmallBadge: "zu klein",
    sizeGateTooLargeBadge: "zu groß",
    tryOnError: "Die Anprobe hat leider nicht geklappt. Bitte versuch es noch einmal.",
    recommendationError:
      "Die Größenempfehlung ließ sich nicht laden. Bitte versuch es noch einmal.",
  },
  tryOnView: {
    addToCart: `.input {$hasPrice :string}
.match $hasPrice
yes {{{$size} in den Warenkorb ({$price})}}
* {{{$size} in den Warenkorb}}`,
    goToProductOverview: "Andere Größe oder Farbe anprobieren",
    variantSubtitle: `.input {$hasColor :string}
.match $hasColor
yes {{Größe {$sizeLabel} · Farbe {$colorLabel}}}
* {{Größe {$sizeLabel}}}`,
    fitScoreTitle: "Fit-Score für {$sizeLabel}",
    fitScoreToggleSr: "Fit-Score-Details ein- oder ausblenden",
    fitScoreUnavailable: "Fit-Score nicht verfügbar",
    fitScoreRetrySr: "Fit-Score neu laden",
    tryOnFailedForVariant: "Anprobe in {$sizeLabel} hat nicht geklappt",
    retryTryOnCta: "Noch einmal versuchen",
    sizeSoldOutNote: "Größe {$sizeLabel} ist aktuell ausverkauft.",
    sizeSoldOutSr: "ausverkauft",
    triedVariantsLabel: "Deine Anproben",
    styleToggleSr: "Stil wechseln",
    intendedFit: "So ist es gedacht: {$description}",
    variantPickerTitle: "Andere Größe oder Farbe anprobieren",
    variantPickerToggleSr: "Größen- und Farbauswahl ein- oder ausblenden",
    sizeAxisLabel: `.input {$hasSize :string}
.match $hasSize
yes {{Größe: {$sizeLabel}}}
* {{Größe:}}`,
    recommendedChip: "Empfohlen: {$sizeLabel}",
    colorAxisLabel: "Farbe: {$colorLabel}",
    variantAxisLabel: "{$axisLabel}: {$valueLabel}",
    variantUnavailableSr: "in dieser Kombination nicht erhältlich",
    tryOnVariantCta: `.input {$hasColor :string}
.match $hasColor
yes {{{$colorLabel} in {$sizeLabel} anprobieren}}
* {{Größe {$sizeLabel} anprobieren}}`,
    aiGeneratedLabel: "KI-generiert",
    downloadImage: "Bild herunterladen",
    colorLine: "Farbe {$colorLabel}",
    sizeLine: "Größe {$sizeLabel}",
    recommendedHere: "Deine empfohlene Größe",
    recommendedOther: "Deine empfohlene Größe ist {$sizeLabel}",
    gateInspectTooSmallNote: "Größe {$sizeLabel} ist dir zu klein.",
    gateInspectTooLargeNote: "Größe {$sizeLabel} ist dir zu groß.",
    fitVerdicts: {
      tooSmall: "zu eng, passt nicht",
      runsTight: "etwas eng",
      ideal: "sitzt perfekt",
      runsLoose: "etwas locker",
      tooLoose: "zu weit",
    },
    lengthVerdicts: {
      tooSmall: "deutlich zu kurz",
      runsTight: "fällt kurz aus",
      ideal: "genau richtig",
      runsLoose: "fällt lang aus",
      tooLoose: "deutlich zu lang",
    },
    lengthStyledLong: "bewusst lang geschnitten",
    lengthStyledShort: "bewusst kurz geschnitten",
    fitPanelTitle: "Deine Passform",
    fitMatchLabel: "Passgenauigkeit",
    sizePickerTitle: "Wähle deine Größe",
    sizePickerRecommendedSr: "empfohlen",
    sizeGateTooSmallSr: "wahrscheinlich zu klein",
    sizeGateTooLargeSr: "wahrscheinlich zu groß",
    basedOnFitProfile: "So ist es gedacht: {$fitProfile}",
    fitMatchInfoCalibrated:
      "Wir vergleichen die Maßtabelle der Marke mit deinen Körpermaßen aus dem Foto. Maßstab ist, wie das Kleidungsstück bei der Marke selbst sitzt: Ihr Model ist {$height} cm groß und trägt Größe {$size}. Je näher diese Größe an deinem Körper an diesen Look herankommt, desto höher der Wert. Zu eng kostet deutlich mehr Punkte als zu locker. Abweichende Längen senken den Wert leicht, ändern die Empfehlung aber nicht.",
    fitMatchInfoDerived:
      "Diese Maßtabelle stammt nicht von der Marke. Wir haben das Schnittmuster in allen Größen vermessen und mit deinen Körpermaßen aus dem Foto verglichen. Die Zahlen sind exakt, wie locker es sitzen soll, schätzen wir aber selbst. Nimm die Empfehlung deshalb als guten Ausgangspunkt.",
    fitProfiles: {
      compression: "Kompression",
      close: "Körpernah",
      slim: "Schmal",
      regular: "Normal",
      relaxed: "Locker",
      oversized: "Oversized",
    },
    intendedLook: {
      fitted: "Figurbetont geschnitten",
      regular: "Normal geschnitten",
      relaxed: "Locker geschnitten",
      oversized: "Oversized",
      sleevesLong: "Extralange Ärmel",
      sleevesShort: "Kürzere Ärmel",
      longline: "Länger geschnitten",
      cropped: "Cropped",
    },
    fitAxis: {
      loose: "Locker",
      regular: "Normal",
      tight: "Eng",
    },
    lengthAxis: {
      short: "Kurz",
      regular: "Passend",
      long: "Lang",
    },
    sameAcrossSizes:
      "Dieses Maß ist in allen Größen fast gleich, eine andere Größe ändert hier wenig.",
    sameAcrossSizesShort: "bei allen Größen ähnlich",
    metricInfo: {
      chest:
        "Brustweite: der Umfang des Kleidungsstücks auf Brusthöhe, verglichen mit deinem Brustumfang.",
      waist:
        "Taillenweite: der Umfang des Kleidungsstücks auf Taillenhöhe, verglichen mit deinem Taillenumfang.",
      totalLength:
        "Gesamtlänge: wo der Saum bei dir endet, gemessen an der Länge, die der Schnitt vorsieht.",
      sleeveLength:
        "Ärmellänge: wo der Ärmel bei dir endet, gemessen an der vorgesehenen Ärmellänge.",
      other: "Dieses Maß des Kleidungsstücks im Vergleich zu deinem Körper.",
    },
    metricGirthDelta: "In dieser Größe: {$cm} cm Spielraum zu deinem Körpermaß (+ = mehr Luft).",
    metricLengthDelta:
      "In dieser Größe: {$cm} cm Abweichung von der vorgesehenen Länge (+ = länger).",
    fitMatchInfo:
      "Wir vergleichen die Maßtabelle der Marke mit deinen Körpermaßen aus dem Foto. Die wichtigste Weite (z. B. Brust) bestimmt den Wert: Wie nah liegt die Mehrweite an dem, was der Schnitt vorsieht? Abweichungen kosten Punkte, zu eng deutlich mehr als zu locker. Abweichende Längen senken den Wert leicht, ändern die Größenempfehlung aber nicht.",
    infoSr: "Mehr Infos",
    busyMessages: [
      "Wir holen schnell das Maßband",
      "Naht für Naht entsteht dein Look",
      "Deine Anprobe ohne Umkleidekabine",
      "Deine Passform, deine Größe, dein Look",
      "Aus Pixeln wird Passform",
      "Dein Look ist gleich bereit",
    ],
  },
  bodyFailure: {
    noHumanDetected:
      "Auf diesem Foto finden wir keine Person. Bitte nimm ein Foto, auf dem du gut zu sehen bist.",
    humanOccluded: "Bitte nimm ein Foto, auf dem du von Kopf bis Fuß zu sehen bist.",
    humanNotStanding:
      "Auf diesem Foto stehst du nicht ganz aufrecht. Bitte nimm eins, auf dem du gerade stehst.",
    humanTooSmall:
      "Auf diesem Foto bist du zu weit weg. Bitte nimm eins, auf dem du näher an der Kamera stehst.",
    inappropriateClothing:
      "Dieses Foto können wir leider nicht verwenden. Bitte nimm eins, auf dem du Alltags- oder Sportkleidung trägst.",
  },
  surface: {
    backSr: "Zurück",
    closeSr: "Schließen",
    poweredBy: "bereitgestellt von",
    poweredBySr: "bereitgestellt von studio vaai",
  },
};

export const studioVaaiUiMessagesSourceEn: StudioVaaiUiMessagesSource = {
  sessionIntro: {
    sheetTitle: "Ready to try it on?",
    sheetSubtitle: "Upload a photo & try different sizes",
    steps: {
      uploadPhoto: "Upload a photo",
      enterHeight: "Enter your height",
      trySizes: "Try different sizes",
    },
    photoFactsTitle: "What happens to your photo",
    photoFacts: {
      onlyForTryOn: "Your photo is only used for the try-on.",
      nobodyElseSees: "Nobody else gets to see your photo, only you.",
      deletedAfter: "Your photo is deleted right after the try-on.",
    },
    withdrawalDisclosureLabel: "Withdrawal & Privacy Information",
    withdrawalDisclosureBody:
      "This consent is voluntary. You can withdraw it at any time in the widget or by emailing info@studio-vaai.com. Withdrawing your consent does not affect the lawfulness of any processing carried out before the withdrawal. For more information, please see our {#link href=|https://studio-vaai.com/try-on/privacy|}Privacy Policy{/link}.",
    consentLegal:
      "I consent to the processing of my photo (health data) and my body measurements for the virtual try-on.",
    legalFooter:
      "By continuing you agree to the {#link href=|https://studio-vaai.com/try-on/terms|}Terms and Conditions{/link} of studio vaai GmbH.",
    primaryCtaPhoto: "Upload a photo",
    secondaryCtaCamera: "Capture with self-timer",
    busyUploadSr: "Uploading",
    defaultProductName: "Product",
    defaultSizeLabel: "S",
    createSessionError: "Something went wrong. Please try again.",
    uploadError: "Your photo could not be uploaded. Please try again.",
    consentRequired: "Please accept the consent to continue.",
  },
  photoUpload: {
    title: "Different photo needed",
    primaryRetry: "Use a different photo",
    fallbackError: "This photo could not be processed. Please try a different image.",
    guideLink: "Guide to a great photo",
    guideSheetTitle: "Guide to a great photo",
    guideClose: "Close",
    busyRetryUploadSr: "Uploading",
  },
  // oxlint-disable-next-line typescript/no-deprecated -- Populate legacy messages for existing host overrides.
  guideGraphic: {
    fullBody: "Full body:\nHead to toe",
    naturalPose: "Natural pose",
    everydayClothing: "Regular clothing\n(not oversized)",
  },
  photoCapture: {
    title: "Capture with self-timer",
    subtitle: "Start the self-timer and stand about 1.5 m from your laptop",
    infoBody:
      "Stand about 1.5 m from your camera so your whole body is visible from head to toe. The camera will trigger automatically.",
    permissionPromptBody:
      "We need your permission to use the camera. Please accept your browser's prompt above this window to continue.",
    allowCameraCta: "Allow camera access",
    uploadFromLibraryCta: "Upload a photo from your library",
    selfTimerCta: "Start self-timer ({$seconds}s)",
    cancelTimerCta: "Cancel timer",
    permissionDeniedTitle: "Camera access blocked",
    permissionDeniedBody: "Please allow camera access in your browser settings to continue.",
    unavailableBody: "We couldn't find a camera on this device.",
    fallbackError: "The camera is unavailable right now. Please try again.",
    retry: "Try again",
    busyAutoCaptureSr: "Capturing",
    busyUpload: "Uploading your photo",
    switchCameraSr: "Switch camera",
    countdownSr: "Capturing in {$seconds} seconds",
    retakeTitle: "Record another photo?",
    retakeBody:
      "Do you really want to continue and record another photo? Your current photo will be deleted.",
    retakeContinue: "Continue",
    retakeCancel: "Cancel",
  },
  heightCalibration: {
    title: "Enter your height",
    subtitle: "So we can find the perfect size for you",
    heightPickerLabel: "How tall are you?",
    confirm: "Continue to try-on",
    useOtherImage: "Use a different photo",
    busyCalibrateSr: "Saving height",
    fallbackError: "Something went wrong. Please try again.",
    heightInputSr: "Height in cm",
    increaseHeightSr: "Increase height",
    decreaseHeightSr: "Decrease height",
  },
  productOverview: {
    busyTryOnSr: "Requesting try-on",
    tryOnCta: `.input {$hasColor :string}
.match $hasColor
yes {{Try size {$sizeLabel} in {$colorLabel}}}
* {{Try size {$sizeLabel}}}`,
    selectVariantCta: `.input {$hasColor :string}
.match $hasColor
yes {{Select size and color}}
* {{Select size}}`,
    selectionRequired: "Please select {$missing :list}.",
    attributeName: {
      size: "a size",
      color: "a color",
    },
    useAnotherImage: "Use a different photo",
    colorHeading: "Color: {$colorLabel}",
    sizeSectionLabel: "Size to try on",
    sheetSubtitle: "Pick the size and color to try on",
    getRecommendation: "Get recommendation",
    recommendedSizeNote: "Your recommended size: {$sizeLabel}",
    garmentTooSmallNote: "Size {$requestedSize} is too small for you.",
    garmentTooLargeNote: "Size {$requestedSize} is too large for you.",
    garmentTooSmallNoAlternativeNote:
      "Size {$requestedSize} is too small for your measurements, and this style doesn't come any larger. We can't create a try-on for it.",
    garmentTooLargeNoAlternativeNote:
      "Size {$requestedSize} is too large for your measurements, and this style doesn't come any smaller. We can't create a try-on for it.",
    sizeGateTooSmallBadge: "too small",
    sizeGateTooLargeBadge: "too big",
    tryOnError: "The try-on could not be created. Please try again.",
    recommendationError: "The size recommendation could not be loaded. Please try again.",
  },
  tryOnView: {
    addToCart: `.input {$hasPrice :string}
.match $hasPrice
yes {{Add {$size} to bag ({$price})}}
* {{Add {$size} to bag}}`,
    goToProductOverview: "Try another size or color",
    variantSubtitle: `.input {$hasColor :string}
.match $hasColor
yes {{Size {$sizeLabel} · {$colorLabel}}}
* {{Size {$sizeLabel}}}`,
    fitScoreTitle: "Fit Score for {$sizeLabel}",
    fitScoreToggleSr: "Show or hide fit score details",
    fitScoreUnavailable: "Fit score unavailable",
    fitScoreRetrySr: "Reload fit score",
    tryOnFailedForVariant: "Try-on in {$sizeLabel} failed",
    retryTryOnCta: "Try again",
    sizeSoldOutNote: "Size {$sizeLabel} is currently sold out.",
    sizeSoldOutSr: "sold out",
    triedVariantsLabel: "Your try-ons",
    styleToggleSr: "Switch style",
    intendedFit: "Intended fit: {$description}",
    variantPickerTitle: "Try another size or color",
    variantPickerToggleSr: "Show or hide the size and color picker",
    sizeAxisLabel: `.input {$hasSize :string}
.match $hasSize
yes {{Size: {$sizeLabel}}}
* {{Size:}}`,
    recommendedChip: "Recommended {$sizeLabel}",
    colorAxisLabel: "Color: {$colorLabel}",
    variantAxisLabel: "{$axisLabel}: {$valueLabel}",
    variantUnavailableSr: "not available in this combination",
    tryOnVariantCta: `.input {$hasColor :string}
.match $hasColor
yes {{Try on {$sizeLabel} in {$colorLabel}}}
* {{Try on size {$sizeLabel}}}`,
    aiGeneratedLabel: "AI-generated",
    downloadImage: "Download image",
    colorLine: "Color {$colorLabel}",
    sizeLine: "Size {$sizeLabel}",
    recommendedHere: "Your recommended size",
    recommendedOther: "Your recommended size is {$sizeLabel}",
    gateInspectTooSmallNote: "Size {$sizeLabel} is too small for you.",
    gateInspectTooLargeNote: "Size {$sizeLabel} is too big for you.",
    fitVerdicts: {
      tooSmall: "too tight, won't fit",
      runsTight: "slightly snug",
      ideal: "fits perfectly",
      runsLoose: "slightly loose",
      tooLoose: "too loose",
    },
    lengthVerdicts: {
      tooSmall: "much too short",
      runsTight: "runs short",
      ideal: "as intended",
      runsLoose: "runs long",
      tooLoose: "much too long",
    },
    lengthStyledLong: "long by design",
    lengthStyledShort: "short by design",
    fitPanelTitle: "Overall Fit",
    fitMatchLabel: "Fit Match",
    sizePickerTitle: "Choose your size",
    sizePickerRecommendedSr: "recommended",
    sizeGateTooSmallSr: "likely too small",
    sizeGateTooLargeSr: "likely too large",
    basedOnFitProfile: "Intended fit: {$fitProfile}",
    fitMatchInfoCalibrated:
      "We compare the brand's size chart with your body measurements from the photo. The benchmark is how the brand itself wears this piece: their model is {$height} cm tall and wears size {$size}. The closer this size comes to that look on your body, the higher the score. Running tight costs far more than running loose. Off lengths lower the score slightly but never change the size recommendation.",
    fitMatchInfoDerived:
      "This chart wasn't published by the brand. We measured the garment's own pattern across its sizes and compared those measurements with your body measurements from the photo. The numbers are exact, but the intended fit (how loose the brand means it to wear) is our estimate, so treat the recommendation as a strong starting point.",
    fitProfiles: {
      compression: "Compression",
      close: "Close",
      slim: "Slim",
      regular: "Regular",
      relaxed: "Relaxed",
      oversized: "Oversized",
    },
    intendedLook: {
      fitted: "Fitted cut",
      regular: "Regular cut",
      relaxed: "Relaxed cut",
      oversized: "Oversized",
      sleevesLong: "Extra-long sleeves",
      sleevesShort: "Shorter sleeves",
      longline: "Longline cut",
      cropped: "Cropped",
    },
    fitAxis: {
      loose: "Loose",
      regular: "Regular",
      tight: "Tight",
    },
    lengthAxis: {
      short: "Short",
      regular: "Regular",
      long: "Long",
    },
    sameAcrossSizes:
      "This measurement barely differs between sizes. Picking another size won't change it much.",
    sameAcrossSizesShort: "similar across all sizes",
    metricInfo: {
      chest:
        "Chest width: how much room the garment has around the chest compared to your chest measurement.",
      waist: "Waist width: the garment's girth at the waist compared to your waist measurement.",
      totalLength:
        "Total length: where the hem ends on you, measured against the length the cut intends.",
      sleeveLength:
        "Sleeve length: where the cuff ends on you, measured against the intended sleeve length.",
      other: "This measurement of the garment compared to your body.",
    },
    metricGirthDelta:
      "In this size: {$cm} cm of room versus your body measurement (+ = more ease).",
    metricLengthDelta: "In this size: {$cm} cm versus the intended length (+ = longer).",
    fitMatchInfo:
      "We compare the brand's size chart with your body measurements from the photo. The key girth (e.g. chest) drives the score: how close is the garment's ease to what the cut intends? Deviations cost points, and running tight costs far more than running loose. Off lengths lower the score slightly but never change the size recommendation.",
    infoSr: "More info",
    busyMessages: [
      "Fetching the tape measure",
      "Your look takes shape, stitch by stitch",
      "Your fitting without a changing room",
      "Your fit, your size, your look",
      "From pixels to the perfect fit",
      "Your look is ready in no time",
    ],
  },
  bodyFailure: {
    noHumanDetected:
      "It looks like there's no person in this photo. Please use a photo where you're clearly visible.",
    humanOccluded: "Please upload a photo that shows you from head to toe.",
    humanNotStanding:
      "It looks like you aren't standing upright in this photo. Please use a photo where you're standing straight.",
    humanTooSmall:
      "You're a bit too far away in this photo. Please use a photo where you're closer to the camera.",
    inappropriateClothing:
      "This photo can't be used. Please use a photo where you're wearing everyday clothes or sportswear.",
  },
  surface: {
    backSr: "Back",
    closeSr: "Close",
    poweredBy: "powered by",
    poweredBySr: "powered by studio vaai",
  },
};

export const studioVaaiUiMessagesDe: StudioVaaiUiMessages = compileStudioVaaiUiMessages(
  "de",
  studioVaaiUiMessagesSourceDe,
);

export const studioVaaiUiMessagesEn: StudioVaaiUiMessages = compileStudioVaaiUiMessages(
  "en",
  studioVaaiUiMessagesSourceEn,
);

/** The catalogs the SDK ships, by language subtag. */
const SHIPPED_SOURCES: Readonly<Record<string, StudioVaaiUiMessagesSource>> = {
  de: studioVaaiUiMessagesSourceDe,
  en: studioVaaiUiMessagesSourceEn,
};

/**
 * Where a host's `locale` leads: the shipped catalog for its language (English when there is
 * none) and the tag every `Intl` formatter runs with.
 *
 * The formatting tag is the host's own (canonicalized), except for a language the SDK does not
 * ship when the host brings no messages of its own: the text is then English, and formatting it
 * as English keeps lists from reading "size, color et length".
 */
export function resolveStudioVaaiUiLocale(
  locale: StudioVaaiUiLocale,
  hasHostMessages: boolean,
): { formatLocale: string; source: StudioVaaiUiMessagesSource } {
  const tag = canonicalTag(locale);
  if (tag === undefined) {
    return { formatLocale: "en", source: studioVaaiUiMessagesSourceEn };
  }
  const shipped = SHIPPED_SOURCES[new Intl.Locale(tag).language];
  if (shipped !== undefined) {
    return { formatLocale: tag, source: shipped };
  }
  return {
    formatLocale: hasHostMessages ? tag : "en",
    source: studioVaaiUiMessagesSourceEn,
  };
}

/**
 * The compiled built-in catalog for any BCP 47 tag: German for `de-*`, English for everything
 * else, formatted for the tag (see {@link resolveStudioVaaiUiLocale}).
 */
export function studioVaaiUiMessagesForLocale(locale: StudioVaaiUiLocale): StudioVaaiUiMessages {
  const { formatLocale, source } = resolveStudioVaaiUiLocale(locale, false);
  return compileStudioVaaiUiMessages(formatLocale, source);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeDeep<T extends object>(base: T, override: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const o = override[key];
    if (o === undefined) {
      continue;
    }
    const b = (base as Record<string, unknown>)[key as string];
    out[key as string] =
      isPlainObject(b) && isPlainObject(o) ? mergeDeep(b as object, o as Partial<object>) : o;
  }
  return out as T;
}

/** Deep-merge MF2 source overrides onto a base bundle, then callers compile with {@link compileStudioVaaiUiMessages}. */
export function mergeStudioVaaiUiMessagesSource(
  base: StudioVaaiUiMessagesSource,
  override: PartialStudioVaaiUiMessagesSource | undefined,
): StudioVaaiUiMessagesSource {
  if (override === undefined) {
    return base;
  }
  return mergeDeep(base, override as Partial<StudioVaaiUiMessagesSource>);
}
