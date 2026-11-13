"use client";

import type {
  FrameLock,
  TryOnFlowProduct,
  TryOnHistoryFailureReason,
  VariantAttributes,
} from "@studio-vaai/js-machine";
import type { DefaultRootViewModel } from "@studio-vaai/react-headless";

import {
  effectiveRecommendedSize,
  tryOnColorwayOptionForAttribute,
  tryOnSizeLabelForAttribute,
} from "@studio-vaai/js-machine";
import { useMemo, useRef, useState, type ReactNode } from "react";

import type { VariantPickerOption } from "../ui/variant-picker.js";

import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { Text } from "../typography/text.js";
import { ActionsSection } from "../ui/actions-section.js";
import { Button, flowPrimaryCtaClassName, flowSecondaryCtaClassName } from "../ui/button.js";
import { cn } from "../ui/cn.js";
import { ErrorMessage } from "../ui/error-message.js";
import { FROSTED_CARD_CLASS } from "../ui/frosted-card.js";
import { flowMediaColumnClassName, ResponsiveSplit } from "../ui/responsive-split.js";
import { SheetShell } from "../ui/sheet.js";
import { VStack } from "../ui/v-stack.js";
import { VariantPicker } from "../ui/variant-picker.js";
import { useFitUiFlag } from "../utils/use-fit-ui-flag.js";
import {
  NaturalAspectPreviewFrame,
  useNaturalAspectPreviewFrame,
} from "./natural-aspect-preview-frame.js";
import { buildSizeGates, resolveGateAlternative } from "./size-gates.js";
import { recommendedLengthHint, splitSizeAxis } from "./variant-axes-picker.js";

interface ProductOverviewScreenProps {
  /** From {@link DefaultRootContext.product} (global try-on product data). */
  product: TryOnFlowProduct;
  selection: VariantAttributes;
  vm: DefaultRootViewModel;
  /**
   * Opt into the fit-intelligence UI — here that is the "Recommended X" pill and the
   * ring-marked chip on the size axis. When unset, the `?fitUi=1` browser query param decides
   * (default off): the machine still seeds the recommended size as the default selection, it
   * just isn't called out. See {@link useFitUiFlag}.
   */
  fitIntelligence?: boolean;
  /**
   * Most-recent fit-gate outcome for the active product (a live server rejection, or the
   * machine's pre-pivot of a gated selection). Drives the statement note under the size
   * grid. Cleared by the state machine on manual size change. `undefined` = no note rendered.
   */
  lastTryOnFailure?: {
    reason: TryOnHistoryFailureReason;
    requestedSize: string;
    recommendedSize: string;
    /** True when the machine already auto-pivoted to `recommendedSize` — render the statement note, not the question. */
    autoPivoted?: boolean;
  };
  onSelectVariant: (selection: VariantAttributes) => void;
  onRecommendationRequest: () => void;
  onStartTryOn: () => void;
  /**
   * Called when the try-on CTA is clicked before a full variant is selected —
   * the button stays visually enabled (always-enabled pattern) and this surfaces
   * the "select size / color" error instead of starting a try-on.
   */
  onSelectionRequired: () => void;
  onClose: () => void;
  onBackToHeight: () => void;
  /** Secondary line under the primary CTA (e.g. return to photo capture). */
  onUseAnotherImage: () => void;
  /** Body image URL: last try-on result for this product, or the original uploaded photo. Empty string shows a neutral hero placeholder. */
  heroImageSrc: string;
  /**
   * Sub-rect of `heroImageSrc` to display. Hosts pass this only when the hero
   * is the original camera capture (carrying the bbox the user composed
   * within at shutter time); try-on results from the server arrive cropped
   * already, so the hero falls back to natural aspect when absent.
   */
  heroFrameLock?: FrameLock;
  /**
   * When true, async work locks the sheet (e.g. retrying a photo upload after a rejection):
   * controls disabled, primary spinner, header chrome disabled.
   */
  busy?: boolean;
  /** Error node rendered above the primary CTA (e.g. photo-upload transport error during retry). */
  errorMessage?: ReactNode;
}

/**
 * The size-selection step between height calibration and the first try-on. Shoppers arriving
 * with a preselected size never see it — the machine's `autoStartOnPreselectedVariant`
 * one-shot goes straight to the try-on — so this screen exists for the shopper who opened
 * the flow without picking a size on the product page. It reuses the redesigned try-on
 * screen's picker (the same axis chips, recommendation pill and color swatches) inside a
 * static card, so the pick-a-size moment and the try-another-size moment read identically.
 */
/**
 * Where to send a shopper whose size is refused: the live recommendation when there is one, else
 * the size the SERVER named when it rejected the try-on.
 *
 * The fallback is what keeps the plain flow useful. Without fit intelligence there is no
 * recommendation to read, so a rejection that came back with a perfectly good alternative
 * ("too small — try M") collapsed into the dead-end copy ("and this style doesn't come any
 * larger"), which is both wrong and unactionable.
 *
 * `undefined` means there is genuinely nowhere to point: no candidate, or the only candidate is
 * the size already selected.
 */
export function ProductOverviewScreen({
  product,
  selection,
  vm,
  fitIntelligence,
  lastTryOnFailure,
  onSelectVariant,
  onRecommendationRequest: _onRecommendationRequest,
  onStartTryOn,
  onSelectionRequired,
  onClose,
  onBackToHeight,
  onUseAnotherImage,
  heroImageSrc,
  heroFrameLock,
  busy: busyProp,
}: ProductOverviewScreenProps) {
  const { messages, responsive } = useStudioVaaiUi();
  const po = messages.productOverview;
  const tv = messages.tryOnView;
  const isModal = responsive.layout === "modal";
  const busy = busyProp ?? false;
  const fitUi = useFitUiFlag(fitIntelligence);
  const colorMeta = tryOnColorwayOptionForAttribute(product, selection["colorway"]);
  // The proactive size recommendation — the gate-aware effective pick (the best-ranked size the
  // try-on hard gate lets through), matching what the machine auto-seeds. Empty when the product
  // has no size chart or it hasn't arrived yet — the UI then falls back to a plain size picker.
  const recommendedSlug =
    vm.recommendationData !== null && vm.recommendationData !== undefined
      ? effectiveRecommendedSize(vm.recommendationData)
      : "";
  // Sizes this screen refuses: the server's HARD gate, plus any size whose own fit verdict
  // already says it does not fit. Keying on `gate` alone left a hole the shopper walks into
  // first: the gate's lower bound carries a 40 mm grace, so on a real body size 30 came back
  // `fit: "too_small"` with NO gate and cleared the bound by 2 mm while still being 4.2 cm
  // narrower than the waist — unmarked in the row, with a live CTA beside it. Mirrors the
  // identical derivation in `try-on-view-screen`; the two screens are one step apart and must
  // refuse the same sizes.
  const gateBySize = useMemo(
    () =>
      buildSizeGates(
        product.attributeMetadata.sizes.map((size) => size.slug),
        vm.recommendationData?.recommendations,
        lastTryOnFailure,
      ),
    [product.attributeMetadata.sizes, vm.recommendationData, lastTryOnFailure],
  );

  const sizeLadder = product.attributeMetadata.sizes.map((size) => size.slug);
  // The fit-gate note under the picker — always a STATEMENT (the ask-first question is
  // retired): past-tense when the machine already pivoted the render ("we tried X on you"),
  // present-tense when a rejection landed without a pivot ("X should fit" — the selection has
  // already jumped there, the CTA is the next step).
  // A rejection ALWAYS says something. When the gate names a different size the note points
  // there; when it cannot (a single-size style, or the smallest/largest already picked, which
  // the server reports as `recommendedSize === requestedSize` or empty) the no-alternative copy
  // explains the dead end instead. Suppressing that case is what let the shopper re-tap a CTA
  // that could only fail again, with nothing on screen to say why.
  let gateFailureNote: ReactNode = null;
  // A pointer to another size is guidance (green, like the recommendation copy it echoes); a
  // dead end is a failure and is toned as one, so the two never read alike.
  let gateFailureIsDeadEnd = false;
  if (lastTryOnFailure !== undefined && lastTryOnFailure.requestedSize.length > 0) {
    const requested =
      tryOnSizeLabelForAttribute(product, lastTryOnFailure.requestedSize) ??
      lastTryOnFailure.requestedSize;
    const tooLarge = lastTryOnFailure.reason === "garment_too_large";
    const alternativeSlug = resolveGateAlternative(
      sizeLadder,
      gateBySize,
      lastTryOnFailure.requestedSize,
      tooLarge ? "too_large" : "too_small",
      lastTryOnFailure.recommendedSize,
    );
    const alternative =
      alternativeSlug === undefined
        ? undefined
        : (tryOnSizeLabelForAttribute(product, alternativeSlug) ?? alternativeSlug);
    if (alternative === undefined) {
      gateFailureIsDeadEnd = true;
      gateFailureNote = tooLarge
        ? po.garmentTooLargeNoAlternativeNote(requested)
        : po.garmentTooSmallNoAlternativeNote(requested);
    } else {
      gateFailureNote = tooLarge
        ? po.garmentTooLargeNote(requested, alternative)
        : po.garmentTooSmallNote(requested, alternative);
    }
  }
  const hasColorAxis = product.attributeMetadata.colorways.length > 0;
  // No style row here, deliberately: a multi-style garment's style is chosen on the try-on
  // view (its toggle sits beside the tried-variant pills), and the selection already carries a
  // style — the host's default, or the one the shopper last flipped to — so this step only
  // picks the size and colour.
  // Ready: name the variant, in the try-on screen's exact wording ("Faded Blue in 32 anprobieren")
  // — this CTA and the try-on's are the same promise one step apart, so they say the same thing.
  // Not ready: state what is missing instead, on a muted bar (below), as the reference draws it.
  const selectedSizeLabel = tryOnSizeLabelForAttribute(product, selection["size"]) ?? "";
  const tryOnCtaLabel = vm.canStartTryOn
    ? tv.tryOnVariantCta(selectedSizeLabel, colorMeta?.label)
    : po.selectVariantCta(hasColorAxis);
  const previewFrame = useNaturalAspectPreviewFrame(heroImageSrc, heroFrameLock, {
    placeholderAspectRatio: 3 / 4,
    // Same value the try-on hero uses: let the frame shrink all the way rather than ever
    // overflowing the body, which would push the subject's feet out of view.
    minShrinkScale: 0,
    // Sheet: clamp the frame to the CTA's width while the photo keeps its full-width scale —
    // the sides CROP (24px each, inside the 30px-per-side budget) so the hero aligns with the
    // controls without shrinking. Mirrors the try-on hero exactly.
    ...(isModal ? {} : { frameClassName: "sv:mx-auto sv:w-full sv:max-w-[calc(100%-48px)]" }),
  });

  // Height reserved out of the hero for the floating picker card on the sheet — the same
  // spacer mechanism as the try-on screen, and deliberately the same SIZE rule: only the
  // card's title row is reserved, exactly as the try-on reserves its picker while collapsed.
  // The chips and swatches then float over the photo's foot instead of shortening it, so the
  // two steps compose the photo identically. Reserving the whole card (what this did before)
  // squeezed the subject into the top half here and nowhere else, which is what made this
  // step look like a different screen. This card simply never collapses — that is the only
  // difference from the try-on, and it does not change how the photo is laid out.
  const stackRef = useRef<HTMLDivElement | null>(null);
  const pickerBodyRef = useRef<HTMLDivElement | null>(null);

  // The recommendation fetch + selection seeding are owned by the state machine (the
  // `recommendation` region auto-fetches when the host marked the size as a default and seeds
  // `selection.size` on arrival) — this component only renders the outcome.

  // Failure mode: the shopper tapped an out-of-stock chip. The pick is refused and the axis
  // row says why, replacing the recommendation pill until they pick again.
  const [soldOutPick, setSoldOutPick] = useState<string | null>(null);
  const soldOutBySize = useMemo(
    () =>
      new Set(product.attributeMetadata.sizes.filter((s) => s.soldOut === true).map((s) => s.slug)),
    [product],
  );
  // The verdict for the size the shopper has actually picked. This is the whole point of the
  // screen: it is where they choose, so it is where a refusal has to be said — not after a
  // request comes back rejected.
  const selectedSizeGate = gateBySize.get(selection["size"] ?? "");
  // Say it the moment the size is picked, ahead of any request. `gateFailureNote` above only
  // exists once a rejection has come BACK — by then the shopper has watched a render that was
  // never going to happen. Same copy either way, so the two paths read identically; this one
  // simply arrives before the round-trip instead of after it.
  if (selectedSizeGate !== undefined) {
    const requested = tryOnSizeLabelForAttribute(product, selection["size"] ?? "") ?? "";
    const alternative = resolveGateAlternative(
      sizeLadder,
      gateBySize,
      selection["size"] ?? "",
      selectedSizeGate,
      recommendedSlug.length > 0 ? recommendedSlug : lastTryOnFailure?.recommendedSize,
    );
    const alternativeLabel =
      alternative === undefined
        ? ""
        : (tryOnSizeLabelForAttribute(product, alternative) ?? alternative);
    const tooLarge = selectedSizeGate === "too_large";
    if (alternative === undefined) {
      // Nothing to point at — every size is refused, or this is the end of the run.
      gateFailureIsDeadEnd = true;
      gateFailureNote = tooLarge
        ? po.garmentTooLargeNoAlternativeNote(requested)
        : po.garmentTooSmallNoAlternativeNote(requested);
    } else {
      gateFailureIsDeadEnd = false;
      gateFailureNote = tooLarge
        ? po.garmentTooLargeNote(requested, alternativeLabel)
        : po.garmentTooSmallNote(requested, alternativeLabel);
    }
  }

  const sizeOptions: readonly VariantPickerOption[] = useMemo(
    () =>
      product.attributeMetadata.sizes.map((s) => {
        const label = tryOnSizeLabelForAttribute(product, s.slug) ?? s.label;
        const gate = gateBySize.get(s.slug);
        const soldOut = s.soldOut === true;
        let srLabel = label;
        if (soldOut) {
          srLabel = `${label} (${tv.sizeSoldOutSr})`;
        } else if (fitUi && s.slug === recommendedSlug) {
          srLabel = `${label} (${tv.sizePickerRecommendedSr})`;
        } else if (gate !== undefined) {
          srLabel = `${label} (${gate === "too_large" ? tv.sizeGateTooLargeSr : tv.sizeGateTooSmallSr})`;
        }
        return {
          value: s.slug,
          label,
          srLabel,
          ...(gate === undefined || soldOut ? {} : { gated: true }),
          ...(soldOut ? { soldOut: true } : {}),
        };
      }),
    [
      product,
      gateBySize,
      recommendedSlug,
      fitUi,
      tv.sizePickerRecommendedSr,
      tv.sizeGateTooLargeSr,
      tv.sizeGateTooSmallSr,
      tv.sizeSoldOutSr,
    ],
  );

  // Note precedence: a refused sold-out tap is the freshest thing to say, then the fit verdict
  // for the picked size. Both ride the axis badge — the muted ⓘ pill the reference draws — so
  // this screen and the try-on view state a refusal in one visual language, not two.
  let axisNote: ReactNode = null;
  if (soldOutPick !== null) {
    axisNote = tv.sizeSoldOutNote(tryOnSizeLabelForAttribute(product, soldOutPick) ?? soldOutPick);
  } else if (selectedSizeGate !== undefined) {
    axisNote = gateFailureNote;
  }

  // A product sold along several axes (waist × length) splits this one size row into a row per
  // axis; a size-only product gets it back untouched.
  const lengthHint = recommendedLengthHint(product, vm.recommendationData, recommendedSlug);
  const pickerAxes = useMemo(
    () =>
      splitSizeAxis(
        product,
        {
          key: "size",
          label: tv.sizeAxisLabel(selectedSizeLabel === "" ? undefined : selectedSizeLabel),
          options: sizeOptions,
          selected: selection["size"] ?? "",
          // Fit-intelligence only: the pill + ring call the recommendation out; without the
          // flag the seeded size simply arrives preselected.
          ...(fitUi ? { recommended: recommendedSlug } : {}),
          ...(!fitUi || recommendedSlug.length === 0
            ? {}
            : {
                recommendationLabel: tv.recommendedChip(
                  tryOnSizeLabelForAttribute(product, recommendedSlug) ?? recommendedSlug,
                ),
              }),
          // Note precedence: a refused sold-out tap is the freshest thing to say, then the fit
          // verdict for the picked size. Both ride the axis badge — the muted ⓘ pill the
          // reference draws — so this screen and the try-on view state a refusal identically
          // instead of in two different visual languages.
          ...(axisNote === null ? {} : { note: axisNote }),
          onSelect: (value: string) => {
            if (soldOutBySize.has(value)) {
              setSoldOutPick(value);
              return;
            }
            setSoldOutPick(null);
            // SELECT_VARIANT marks the size as the shopper's own choice in the
            // machine, so the recommendation never overrides it.
            onSelectVariant({ ...selection, size: value });
          },
        },
        tv,
        lengthHint,
      ),
    [
      lengthHint,
      axisNote,
      tv,
      selectedSizeLabel,
      sizeOptions,
      selection,
      recommendedSlug,
      fitUi,
      product,
      soldOutBySize,
      onSelectVariant,
    ],
  );

  // The same static-card treatment as the try-on screen's picker disclosure, minus the
  // collapse affordance — picking a size is this screen's whole job, so it never folds away.
  // Surface follows the backdrop, exactly like the try-on picker: translucent over the photo
  // on the sheet, solid muted grey on the white modal body.
  const pickerCard =
    product.attributeMetadata.sizes.length === 0 ? null : (
      <div data-studio-vaai="product-variant-section" className={FROSTED_CARD_CLASS}>
        <div className="sv:px-3.5 sv:pt-2.5 sv:pb-2.5 sv:text-[13px] sv:font-medium sv:leading-tight sv:text-[var(--sv-color-foreground)]">
          {po.sizeSectionLabel}
        </div>
        {/* Everything below the title — the part the try-on's picker hides when collapsed, and
            so the part this screen keeps OUT of the hero's reservation (see `pickerBodyRef`). */}
        <div ref={pickerBodyRef} className="sv:px-3.5 sv:pb-3.5">
          <VariantPicker
            disabled={busy}
            axes={pickerAxes}
            colorways={product.attributeMetadata.colorways}
            selectedColorway={selection["colorway"] ?? ""}
            onSelectColorway={(slug) => {
              onSelectVariant({ ...selection, colorway: slug });
            }}
            {...(colorMeta === undefined
              ? {}
              : { colorwayLabel: po.colorHeading(colorMeta.label) })}
          />
          {/* Suppressed when the axis badge above is already carrying this note — the proactive
              case renders it there, in the reference's muted pill, and printing it twice reads
              as two different problems. A note that arrives from a real server rejection has no
              badge to ride, so it still gets this standalone line. */}
          {gateFailureNote === null || selectedSizeGate !== undefined ? null : (
            <Text
              variant="bodySecondary"
              // The note appears in response to the shopper's own tap and replaces nothing they
              // can see, so it has to be announced rather than silently painted.
              render={<p role="status" data-studio-vaai="try-on-gate-note" />}
              className={cn(
                "sv:mt-2.5 sv:mb-0 sv:text-[12px] sv:font-normal sv:leading-snug",
                gateFailureIsDeadEnd
                  ? "sv:text-[var(--sv-color-danger)]"
                  : "sv:text-[var(--sv-color-recommendation-on-surface)]",
              )}
            >
              {gateFailureNote}
            </Text>
          )}
        </div>
      </div>
    );

  // Built once, placed by layout: the modal stacks these full-width at the foot of the column
  // beside the photo, the sheet puts them in the shell footer.
  const primaryCta = (
    <div data-studio-vaai="try-on-pipeline-actions">
      <Button
        type="button"
        className={cn(
          isModal ? flowPrimaryCtaClassName : undefined,
          // Muted while the variant is incomplete: the button stays clickable (that is how the
          // "what's missing" message gets explained), so colour is the only thing telling a
          // shopper it is not the action yet.
          !vm.canStartTryOn &&
            "sv:bg-[var(--sv-color-muted)] sv:text-[var(--sv-color-muted-foreground)] sv:hover:bg-[var(--sv-color-muted)]",
        )}
        // A gated size cannot render, so the CTA is closed rather than left live to fail. It
        // was keyed only on "is a variant fully chosen", which is true of a refused size too.
        disabled={!vm.canStartTryOn || selectedSizeGate !== undefined}
        busy={busy}
        busyLabel={po.busyTryOnSr}
        onClick={onStartTryOn}
        onClickDisabled={onSelectionRequired}
      >
        {tryOnCtaLabel}
      </Button>
    </div>
  );
  const secondaryCta = (
    <Button
      type="button"
      variant="ghost"
      className={isModal ? flowSecondaryCtaClassName : undefined}
      disabled={busy}
      onClick={onUseAnotherImage}
    >
      {po.useAnotherImage}
    </Button>
  );
  // No variant: a failure boxes itself, the "pick a size first" nudge stays a line.
  const errorSlot = <ErrorMessage />;
  const actions = isModal ? (
    <VStack gap="sm" className="sv:min-w-0">
      {errorSlot}
      {primaryCta}
      {secondaryCta}
    </VStack>
  ) : (
    <VStack gap="sm">
      {errorSlot}
      <ActionsSection primary={primaryCta} secondary={secondaryCta} />
    </VStack>
  );

  const hero = (
    <NaturalAspectPreviewFrame
      {...previewFrame}
      previewSrc={heroImageSrc}
      // Sheet: `cover` pairs with the frame's width clamp — the photo crops at the sides
      // instead of letterboxing. Its height derives from this photo's own aspect, so cover
      // only ever crops horizontally.
      className={cn("sv:h-full sv:w-full", isModal ? "sv:object-contain" : "sv:object-cover")}
      data-studio-vaai="product-overview-hero"
      zoomable
      {...(heroFrameLock === undefined ? {} : { frameLock: heroFrameLock })}
    />
  );

  if (isModal) {
    return (
      <SheetShell
        title={product.displayName}
        subtitle={po.sheetSubtitle}
        busy={busy}
        fillHeight
        classNames={{ body: "sv:flex sv:flex-col" }}
        onBack={onBackToHeight}
        onClose={onClose}
      >
        <ResponsiveSplit
          startClassName={flowMediaColumnClassName}
          start={hero}
          end={
            <div
              ref={previewFrame.contentBelowRef}
              className="sv:flex sv:h-full sv:min-h-0 sv:min-w-0 sv:flex-col sv:overflow-y-auto"
            >
              {/* Matches the try-on step's modal column exactly, so the picker does not jump
                  between the two screens.

                  WITH the fit score there are two stacked sections plus the CTAs, enough to fill
                  the column: `mt-auto` collects the slack at the top in one piece, and the
                  picker sits against the buttons it feeds. Splitting that slack in two — one gap
                  above the card, one below — reads as two mistakes rather than one margin.

                  WITHOUT it the card is the column's only content, and pinning it to the foot
                  strands it under a tall void; `my-auto` centres it in the space above the
                  CTAs instead. */}
              <div
                className={cn(
                  "sv:flex sv:min-w-0 sv:flex-col sv:pb-4",
                  fitUi ? "sv:mt-auto" : "sv:my-auto",
                )}
              >
                {pickerCard}
              </div>
              <div className="sv:w-full">{actions}</div>
            </div>
          }
          endClassName="sv:min-h-0"
        />
      </SheetShell>
    );
  }

  // Sheet: the try-on screen's layout, one step early — the photo runs full-bleed and
  // aspect-locked, and the picker card floats over its foot exactly like the try-on's
  // "try another size or color" card, so this step and the result step read as one surface.
  return (
    <SheetShell
      title={product.displayName}
      subtitle={po.sheetSubtitle}
      busy={busy}
      fillHeight
      // Same full-screen treatment as the try-on step — this screen IS that layout, one step
      // early: viewport-covering panel, no grabber, header in flow above the photo.
      fillViewport
      scrollable={false}
      classNames={{
        body: "sv:px-0",
        // Same rhythm as the try-on step: the shell's default `pt-4` reads as a gap in the
        // stack; `pt-3` matches the card-to-CTA spacing the reference draws.
        footer: "sv:pt-3",
        root: "sv:relative",
        // Floating, not hidden: the pill must sit at the same spot as on every other
        // step — only what's BEHIND the chrome changes on this screen.
      }}
      onBack={onBackToHeight}
      onClose={onClose}
      footer={actions}
    >
      <div
        data-studio-vaai="product-overview"
        // `justify-center` floats the aspect-locked photo between the floating header and the
        // Top-aligned: with the header IN FLOW above and the photo running behind the card,
        // the photo starts directly under the title block and any slack falls below it, hidden
        // behind the picker. Centring instead stranded that slack as a white band between the
        // header and the photo — the most visible place it could land.
        className="sv:relative sv:flex sv:min-h-0 sv:w-full sv:flex-1 sv:flex-col sv:justify-start"
      >
        {hero}
        {/* No reservation: the photo runs BEHIND the card, as the reference draws it — there the
            subject's feet sit behind the picker rather than above it. Reserving the card's height
            is what left the photo ending mid-card, so the glass frosted over the render at the top
            and over bare surface below, with a tonal seam straight through the chip row. The
            element stays (the frame measures its "content below") at zero height. */}
        <div
          ref={(el) => {
            previewFrame.contentBelowRef(el);
          }}
          aria-hidden
          className="sv:h-0 sv:shrink-0"
        />
        <div
          ref={stackRef}
          // Full CTA width, like every control in the stack: the hero itself is clamped to the
          // same 24px gutters now, so the old measured-width cap only double-subtracted the
          // gutter and left the card narrower than the CTA under it.
          className="sv:absolute sv:inset-x-0 sv:bottom-0 sv:z-30 sv:max-h-full sv:overflow-y-auto sv:px-6 sv:pb-2"
        >
          {pickerCard}
        </div>
      </div>
    </SheetShell>
  );
}
