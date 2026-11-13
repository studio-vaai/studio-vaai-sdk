"use client";

import type { FitAnchor, TryOnProvenance } from "@studio-vaai/js-client";
import type { DefaultRootViewModel } from "@studio-vaai/react-headless";
import type { ReactNode } from "react";

import {
  effectiveRecommendedSize,
  STYLE_ATTRIBUTE_KEY,
  type TryOnFlowProduct,
  type TryOnProductStyleOption,
  type VariantAttributes,
  tryOnColorwayOptionForAttribute,
  tryOnSizeLabelForAttribute,
} from "@studio-vaai/js-machine";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { Text } from "../typography/text.js";
import { Button, flowPrimaryCtaClassName, flowSecondaryCtaClassName } from "../ui/button.js";
import { cn } from "../ui/cn.js";
import { Disclosure } from "../ui/disclosure.js";
import { ErrorMessage } from "../ui/error-message.js";
import { FitScorePanel, FitScoreUnavailable } from "../ui/fit-score-panel.js";
import { FROSTED_CARD_CLASS } from "../ui/frosted-card.js";
import { IconAlertCircle, IconDownload } from "../ui/icons.js";
import { ImageView } from "../ui/image-view.js";
import { flowMediaColumnClassName, ResponsiveSplit } from "../ui/responsive-split.js";
import { SheetShell } from "../ui/sheet.js";
import { StyleToggle } from "../ui/style-toggle.js";
import { VStack } from "../ui/v-stack.js";
import { VariantPicker, type VariantPickerOption } from "../ui/variant-picker.js";
import { useFitUiFlag } from "../utils/use-fit-ui-flag.js";
import { buildSizeGates, resolveGateAlternative } from "./size-gates.js";
import { usePreviewBaselineAspect } from "./use-preview-baseline-aspect.js";
import { recommendedLengthHint, splitSizeAxis } from "./variant-axes-picker.js";

const TRY_ON_HERO_PLACEHOLDER_ASPECT = 3 / 4;

/** Stable empty arrays so callout props don't get a fresh `[]` per render (react-perf). */
const EMPTY_ANCHORS: readonly FitAnchor[] = [];
const EMPTY_CHECKS: readonly FitPanelCheck[] = [];
const EMPTY_STYLES: readonly TryOnProductStyleOption[] = [];

// `rounded-[var(--sv-radius-control)]` on the FRAME, matching the picker card and the CTAs:
// the shopper's photo is the largest surface on the screen, and square corners on it made it
// read as a different material from everything around it.
const tryOnHeroFrameClassName =
  "sv:relative sv:flex sv:min-h-0 sv:items-center sv:justify-center sv:overflow-hidden sv:rounded-[var(--sv-radius-control)]";

/**
 * The try-on CTAs are full-width rectangles in both layouts — the modal's default pill
 * would fight the size/color card it sits directly under. `cn` runs `tailwind-merge`, so
 * these win over the `Button` variant defaults.
 */
// Shared with the other stacked-CTA steps — see `flowPrimaryCtaClassName` for why `min-w-0`
// and `whitespace-normal` are load-bearing rather than cosmetic.
const tryOnPrimaryCtaClassName = flowPrimaryCtaClassName;
const tryOnSecondaryCtaClassName = flowSecondaryCtaClassName;

/** Stable no-op default for the `TryOnImageOverlay` override slot. */
function NullImageOverlay(): null {
  return null;
}

/**
 * One carousel slide in {@link TryOnViewScreen}. `attributes` are the variant attributes
 * that produced `src` (e.g. captured from a `TryOnHistoryEntry`), and they drive the
 * size/color line in the product card under the carousel — so the bottom labels stay
 * in sync with whichever slide the user is on, independent of the live PDP `selection`.
 */
export interface TryOnViewCarouselSlide {
  src: string;
  attributes: Readonly<Record<string, string>>;
  /**
   * Optional small label shown in the bottom-right corner of this slide. Used
   * to tag try-ons generated under an older body calibration with the height
   * that produced them, formatted for the locale (e.g. `"171 cm"`). Omit to render no label on the slide.
   */
  bottomRightLabel?: string;
  /**
   * Callout anchors for THIS slide's image (captured from its `TryOnHistoryEntry`):
   * normalized 0–1 positions of the fit-panel dimensions in the rendered try-on.
   * While the slide is active, the screen draws a dot per anchored panel row and a
   * leader line to the card.
   */
  fitAnchors?: readonly FitAnchor[];
  /** The server's id for this slide's render (captured from its `TryOnHistoryEntry`). */
  tryOnId?: string;
  /** Where this slide's render came from, when the server reported it. */
  provenance?: TryOnProvenance;
}

export interface TryOnViewScreenProps {
  /** From {@link DefaultRootContext.product} (global try-on product data). */
  product: TryOnFlowProduct;
  selection: VariantAttributes;
  vm: DefaultRootViewModel;
  /**
   * One or more carousel slides. Each slide carries the variant attributes that produced it,
   * so the product card under the carousel reflects the size/color of whichever slide is
   * currently visible (independent of the live PDP `selection`). Empty shows a placeholder.
   */
  carouselSlides: readonly TryOnViewCarouselSlide[];
  /**
   * Initial slide on first mount (e.g. the active history cursor when this screen opens).
   * The screen DOES NOT auto-jump when this prop changes later — once the user is on
   * the screen, swipes and dot taps are the only things that move the carousel. So when
   * a new try-on completes and the parent advances its cursor, the user stays on whichever
   * image they were looking at; they can swipe to the new entry themselves.
   */
  initialSlideIndex?: number;
  /**
   * @deprecated Unused since the redesigned layout became the only one — the screen gives the
   * whole surface to the try-on and renders no product summary card. Kept so existing hosts
   * passing it keep compiling; remove on the next major.
   */
  productThumbnailSrc?: string;
  onBack: () => void;
  onClose: () => void;
  /** Receives the carousel-visible variant attributes for the active slide. */
  onAddToCart: (attributes: VariantAttributes) => void;
  /**
   * @deprecated Unused since the redesigned layout became the only one — the back control
   * (`onBack`) is the single way to return to variant selection. Kept optional so existing
   * hosts keep compiling; remove on the next major.
   */
  onGoToProductOverview?: () => void;
  /**
   * Mirrors {@link TryOnViewCarouselSlide.attributes} for whichever slide is
   * currently visible — used by {@link StudioVaaiDefaultFlow} to resolve
   * `onTryOnClose` when the sheet dismisses from this screen.
   */
  onShownAttributesChange?: (attributes: VariantAttributes) => void;
  /**
   * Fired when the shopper commits a variant that has NO generated try-on yet — the host
   * should render one (e.g. re-run the try-on pipeline). Combinations that already have a
   * carousel slide just switch to it locally and don't call this. Receives the full variant
   * attributes (picked size + picked color).
   *
   * Supersedes {@link onSelectSize}: the redesigned picker changes color as well as size, so
   * a size-only callback can't express what the shopper asked for. When omitted this falls
   * back to `onSelectSize`, which existing hosts already wire.
   */
  onSelectVariant?: (attributes: VariantAttributes) => void;
  /**
   * Legacy size-only variant callback, superseded by {@link onSelectVariant}. Still honored as
   * the fallback so hosts wired before the redesign keep working unchanged; prefer
   * `onSelectVariant` in new code.
   */
  onSelectSize?: (attributes: VariantAttributes) => void;
  /**
   * Re-request the size recommendation after it failed. Wire it to whatever the host uses to
   * refetch; omitted, the "fit score unavailable" bar renders without a retry control.
   */
  onRetryRecommendation?: () => void;
  /**
   * Fully formatted, localized price for the shown variant (e.g. `"€89"`), rendered in the
   * add-to-bag link. Omit to fall back to the size-only phrasing — the SDK deliberately does
   * no currency formatting of its own, since the host already renders a price on the PDP and
   * the two must not disagree.
   */
  priceLabel?: string;
  /**
   * Lowercase `#RRGGBB` hex piped through from the active try-on's Scene. Sets
   * the `--sv-color-slide-overlay` CSS variable on the carousel container so
   * the chevrons, pagination dots, and historical-height labels paint in the
   * brand-configured color. Omit to keep the default (`--sv-color-primary`).
   */
  slideOverlayColor?: string;
  /**
   * Gates the fit-INTELLIGENCE additions only: the fit-score ribbon (the percentage), its
   * expanded intended-fit detail, and the on-image fit callouts. The redesigned layout itself —
   * full-bleed hero, inline size/color picker, tried-variant bubbles — renders for everyone.
   * When omitted it defaults OFF, except a browser can opt in with the `?fitUi=1` query param.
   * Pass an explicit boolean to force it on/off (e.g. Storybook, or a host rollout).
   */
  fitIntelligence?: boolean;
  /**
   * From {@link DefaultRootContext.lastTryOnFailure}: when the machine auto-pivoted a gated
   * auto-selected size to the server's recommendation, the statement note renders over the
   * pivoted result ("X would be too small — showing you Y").
   */
  lastTryOnFailure?: {
    reason: string;
    requestedSize: string;
    recommendedSize: string;
    autoPivoted?: boolean;
  };
}

/**
 * One pill per tried size + colour, in the product's size order. `index` is the slide the pill opens:
 * the newest render of that pick in `activeStyle` when the garment has styles and that
 * companion exists, else the pick's newest render. `selected` marks the pill whose pick is on
 * screen, whichever of its styles that is.
 */
function triedVariantPills(
  product: TryOnFlowProduct,
  slides: readonly TryOnViewCarouselSlide[],
  hasStyles: boolean,
  activeStyle: string | undefined,
  activeIndex: number,
): { size: string; colorSlug: string; index: number; selected: boolean }[] {
  const pills: { size: string; colorSlug: string; index: number; selected: boolean }[] = [];
  for (const [index, slide] of slides.entries()) {
    const size = slide.attributes["size"] ?? "";
    const colorSlug = slide.attributes["colorway"] ?? "";
    const inActiveStyle = !hasStyles || slide.attributes[STYLE_ATTRIBUTE_KEY] === activeStyle;
    const existing = pills.find((pill) => pill.size === size && pill.colorSlug === colorSlug);
    if (existing === undefined) {
      pills.push({ size, colorSlug, index, selected: index === activeIndex });
      continue;
    }
    // Newest wins; a render in the on-screen style wins over a newer one in the other style.
    const current = slides[existing.index];
    const currentInActiveStyle =
      !hasStyles || current?.attributes[STYLE_ATTRIBUTE_KEY] === activeStyle;
    if (inActiveStyle || !currentInActiveStyle) {
      existing.index = index;
    }
    existing.selected ||= index === activeIndex;
  }
  const sizeOrder = new Map(
    product.attributeMetadata.sizes.map((size, index) => [size.slug, index]),
  );
  // Stable sorting keeps colours of the same size in tried order. Historical sizes absent
  // from the current size run remain accessible after the known sizes, in tried order.
  return pills.toSorted(
    (a, b) => (sizeOrder.get(a.size) ?? sizeOrder.size) - (sizeOrder.get(b.size) ?? sizeOrder.size),
  );
}

/**
 * The renders this shopper already has, as a row of pills above the fit score — the strip the
 * reference draws under the photo, starting on the CTA's left edge.
 *
 * Every entry is a try-on that has ALREADY been produced, so selecting one is instant and costs
 * no pipeline work. Without it the only way back to an earlier render was to re-pick its size and
 * hope the carousel matched, which spends a request to show something the shopper already had.
 *
 * Each pill carries the colorway's swatch beside its size label, because size alone cannot tell
 * two renders apart once the shopper has tried the same size in two colors. One pill per size
 * AND colour: on a multi-style garment the machine renders every style of a pick together, so
 * the companions are one tried garment, not two — a second identical pill said nothing the style
 * toggle at the right end of this row does not already say. Tapping a pill lands on that pick in
 * the style currently on screen when that companion exists, else on its newest render.
 *
 * Whether the strip shows at all is the caller's call (see `pillRow`); this only draws it.
 */
function TriedVariantPills({
  product,
  styles,
  activeStyle,
  slides,
  activeIndex,
  onSelect,
  label,
  className,
}: {
  product: TryOnFlowProduct;
  /** The product's styles when it has two or more; the pill then spans the whole set. */
  styles: readonly TryOnProductStyleOption[];
  /** Style slug on screen on a multi-style garment; picks which companion a pill opens. */
  activeStyle?: string | undefined;
  slides: readonly TryOnViewCarouselSlide[];
  activeIndex: number;
  onSelect: (index: number) => void;
  label: string;
  className?: string;
}): ReactNode {
  const pills = triedVariantPills(product, slides, styles.length >= 2, activeStyle, activeIndex);
  return (
    <div
      aria-label={label}
      // Scrolls rather than wraps: a second row would push the photo up on exactly the shoppers
      // who have tried the most sizes. `-mx-1 px-1` keeps the focus ring of the end pills from
      // being clipped by the scroll container while the first pill still starts on the row's
      // left edge. Start-aligned, whatever the count: the strip shares its left edge with the
      // CTA under it, and the style toggle (when the garment has one) holds the right end.
      className={cn(
        "sv:-mx-1 sv:flex sv:min-w-0 sv:shrink-0 sv:gap-2 sv:overflow-x-auto sv:px-1 sv:[scrollbar-width:none] sv:[&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {pills.map(({ size, colorSlug, index, selected }) => {
        const color = tryOnColorwayOptionForAttribute(product, colorSlug);
        const sizeLabel = tryOnSizeLabelForAttribute(product, size) ?? size;
        const name = [sizeLabel, color?.label].filter((part) => part !== undefined).join(", ");
        return (
          <button
            key={`${size}-${colorSlug}`}
            type="button"
            aria-pressed={selected}
            aria-label={name}
            onClick={() => {
              onSelect(index);
            }}
            className={cn(
              // The blur/saturation pair is the frosted surface from `FROSTED_CARD_CLASS`, the
              // same glass the size/colour drawer is drawn on. These pills float over the render
              // exactly as that panel does, and carrying only its FILL made them read as flat
              // grey chips beside it — the fill and the blur are what decide how much of the
              // photo comes through, so one without the other is not the same surface. Kept as
              // the shared base so the selected pill matches too; its opaque fill simply leaves
              // nothing for the blur to show.
              "sv:inline-flex sv:shrink-0 sv:cursor-pointer sv:items-center sv:gap-1.5 sv:rounded-full sv:border sv:py-1 sv:pl-1 sv:pr-3 sv:font-sans sv:text-[13px] sv:leading-none sv:outline-none sv:backdrop-blur-sm sv:backdrop-saturate-150 sv:transition-colors sv:focus-visible:ring-2 sv:focus-visible:ring-[var(--sv-color-foreground)]",
              selected
                ? "sv:border-[var(--sv-color-foreground)] sv:bg-[var(--sv-color-bg)] sv:font-medium sv:text-[var(--sv-color-foreground)]"
                : "sv:border-transparent sv:bg-[var(--sv-color-overlay-card)] sv:text-[var(--sv-color-foreground-secondary)]",
            )}
          >
            {/* The colorway's own swatch: the fabric image when it has one (denim, stripes —
                a flat hex reads as a black dot for those), else the hex fill. Mirrors the
                variant picker's swatch treatment so the two rows visibly agree. */}
            {color?.imageUrl !== undefined && color.imageUrl.length > 0 ? (
              <img
                aria-hidden
                alt=""
                src={color.imageUrl}
                className="sv:size-5 sv:shrink-0 sv:rounded-full sv:object-cover sv:ring-1 sv:ring-inset sv:ring-black/10"
              />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "sv:size-5 sv:shrink-0 sv:rounded-full",
                  color?.swatchRing === true ? "sv:ring-1 sv:ring-inset sv:ring-black/10" : "",
                )}
                style={{ backgroundColor: color?.hex ?? "var(--sv-color-muted)" }}
              />
            )}
            {sizeLabel}
          </button>
        );
      })}
    </div>
  );
}

export function TryOnViewScreen({
  product,
  selection,
  vm,
  carouselSlides,
  initialSlideIndex,
  onBack,
  onClose,
  onAddToCart,
  onShownAttributesChange,
  slideOverlayColor,
  fitIntelligence,
  lastTryOnFailure,
  onSelectVariant,
  onSelectSize,
  onRetryRecommendation,
  priceLabel,
}: TryOnViewScreenProps) {
  const { messages, responsive } = useStudioVaaiUi();
  const tv = messages.tryOnView;
  const isModal = responsive.layout === "modal";
  // A host's chrome over the finished render (top-left). Absent by default, and then nothing at
  // all is mounted for it.
  const ImageOverlay = useStudioVaaiUiComponent("TryOnImageOverlay", NullImageOverlay);
  // Gates only the fit-score ribbon + on-image callouts (the "fit percentage" layer). The prop
  // wins when set (Storybook / host rollout), else the `?fitUi=1` browser query param enables it.
  const fitUi = useFitUiFlag(fitIntelligence);
  // Which render is on the hero. There is no gallery to navigate: the size/color picker is the
  // only thing that moves this cursor (via `commitDraft`), plus the flow's own `initialSlideIndex`
  // while a regenerate is in flight.
  const [slide, setSlide] = useState(initialSlideIndex ?? 0);
  const activeIndex =
    carouselSlides.length === 0 ? 0 : Math.min(slide, Math.max(0, carouselSlides.length - 1));
  const activeSlide = carouselSlides[activeIndex];
  // While a render is in flight the screen is ABOUT the variant being made, not the one still
  // on the hero — so the header, the fit-score title and the cart CTA all name the size the
  // shopper just picked. The flow normally parks a source-photo slide carrying `selection` for
  // exactly this, but it has none when there is no photo URL to show, and the header then kept
  // announcing the PREVIOUS size for the whole render.
  const activeAttributes =
    vm.tryOnPipeline === "requesting" ? selection : (activeSlide?.attributes ?? selection);
  const activeColor = activeAttributes["colorway"];
  const shownSize = activeAttributes["size"] ?? selection["size"] ?? "";
  const activeSrc = activeSlide?.src ?? "";
  // A multi-style garment (a blazer buttoned up / down) renders every style of a picked size
  // and colour together, so the style is a third key on every render lookup below — two slides
  // that differ only in style must never resolve to one another. Single-style products carry
  // no style key at all and the lookups ignore it.
  const styles = product.attributeMetadata.styles ?? EMPTY_STYLES;
  const hasStyles = styles.length >= 2;
  const activeStyle = hasStyles
    ? (activeAttributes[STYLE_ATTRIBUTE_KEY] ?? selection[STYLE_ATTRIBUTE_KEY])
    : undefined;

  // Follow the flow's cursor. StudioVaaiDefaultFlow moves it to the busy source-photo the
  // instant a regenerate starts, and to the freshly-completed render when it lands — so a committed
  // variant shows on the hero as soon as there is something to show.
  useEffect(() => {
    setSlide(initialSlideIndex ?? 0);
  }, [initialSlideIndex]);

  const shownAttributes = useMemo(
    () => ({ ...activeAttributes, size: shownSize }),
    [activeAttributes, shownSize],
  );
  // Callout overlay inputs: the visible render's anchors pair with the fit checks by
  // dimension; the layer measures live DOM rects, so it needs the screen root + hero frame.
  const calloutRootRef = useRef<HTMLDivElement | null>(null);
  const calloutFrameRef = useRef<HTMLDivElement | null>(null);
  const activeFitAnchors = activeSlide?.fitAnchors;
  const colorMeta = tryOnColorwayOptionForAttribute(product, activeAttributes["colorway"]);
  const sizeLabel = tryOnSizeLabelForAttribute(product, shownSize);
  const showColorLine = colorMeta !== undefined;

  // Gate-aware effective pick — the same slug the machine auto-seeds; the raw rank-1 chart pick
  // may be a size the try-on hard gate rejects. A live gate failure's own suggestion outranks
  // both (it is the freshest verdict for THIS body on THIS product).
  const failureSuggestedSlug =
    lastTryOnFailure !== undefined &&
    lastTryOnFailure.recommendedSize.length > 0 &&
    lastTryOnFailure.recommendedSize !== lastTryOnFailure.requestedSize
      ? lastTryOnFailure.recommendedSize
      : undefined;
  const recommendedSlug =
    failureSuggestedSlug ??
    (vm.recommendationData !== null && vm.recommendationData !== undefined
      ? effectiveRecommendedSize(vm.recommendationData)
      : "");
  // The ranked entry for the size of the VISIBLE slide (the API ranks all sizes, so any slide size
  // resolves): drives the fit-score ribbon and the per-measurement callouts.
  const activeRecommendation = vm.recommendationData?.recommendations.find(
    (r) => r.size === shownSize,
  );
  const activeFitChecks = activeRecommendation?.fitChecks;
  const busy = vm.tryOnPipeline === "requesting";
  const busyMessage = useRotatingTryOnBusyMessage(tv.busyMessages, busy);

  // ── Staged variant selection ────────────────────────────────────────────────
  // The picker stages a size/color pick; the primary CTA commits it. Deliberate: the hero
  // image and the fit callouts anchored onto it describe ONE rendered variant, so re-scoring
  // the moment a chip is tapped would leave the dots on the body describing a garment that
  // isn't on screen. `null` means "no pick yet — follow the visible slide".
  const [draft, setDraft] = useState<{ size: string; color: string } | null>(null);
  // The last size the shopper deliberately picked in the picker. Distinct from `draft`, which a
  // failure resets to follow the visible render — so `draft` cannot tell "the shopper moved on"
  // apart from "the hero happens to show a different size than the one that failed".
  const [lastPickedSize, setLastPickedSize] = useState<string | null>(null);
  const draftSize = draft?.size ?? shownSize;
  const draftColor = draft?.color ?? activeColor ?? "";
  // A newly-visible slide IS the answer to whatever was staged, so the draft goes back to
  // following the image rather than lingering as a stale pick.
  useEffect(() => {
    setDraft(null);
  }, [activeAttributes]);

  // A NEW failure is new information: re-arm the banner even if the shopper had moved on from
  // the previous one.
  useEffect(() => {
    setLastPickedSize(null);
  }, [lastTryOnFailure?.requestedSize, vm.tryOnPipeline]);

  // The size the in-flight request is carrying, latched while it is still in flight.
  //
  // `error` is reached from `requesting`'s `onError`, which records nothing — so on the ordinary
  // render-failure path there is no `lastTryOnFailure` to read, and the banner has to get the
  // size from somewhere. It cannot be anything derived from the picker or the hero: both track
  // where the shopper is NOW, which is exactly what makes a failure notice rename itself when
  // they tap another chip. `selection` is what the request was issued with, so capturing it at
  // `requesting` gives the one value that stays true for the attempt being reported.
  const [attemptedSize, setAttemptedSize] = useState<string | null>(null);
  useEffect(() => {
    if (vm.tryOnPipeline === "requesting") {
      setAttemptedSize(selection["size"] ?? null);
    }
  }, [vm.tryOnPipeline, selection]);

  // Desktop has room for the picker beside the hero, so it opens expanded; the bottom sheet
  // keeps it closed and lets the primary CTA be what opens it (as in the reference).
  const [pickerOpen, setPickerOpen] = useState(isModal);
  const [scoreOpen, setScoreOpen] = useState(false);

  // How much of the sheet body the hero gives up to the control stack. Measured from the stack
  // ONLY while both sections are collapsed, and frozen while either is open — so expanding a
  // section slides it up OVER the photo (as in the reference, where the legs read through the
  // translucent panel) instead of resizing the hero. A live measurement would re-lay-out the
  // photo on every toggle and drag the anchored callout markers around with it.
  const stackRef = useRef<HTMLDivElement | null>(null);
  // The collapsed fit-score bar is deliberately NOT part of the reservation: with it counted,
  // the fit-intelligence sheet composed a visibly smaller photo than the plain one, when the
  // reference keeps the two identical. The bar floats over the hero's empty letterbox margin
  // instead (the source try-ons carry enough below-the-feet slack for one bar row), so the
  // subject still stands clear of it — just not by an extra bar-height of dead surface.
  const scoreRowRef = useRef<HTMLDivElement | null>(null);
  const [reservedBand, setReservedBand] = useState(0);
  // The band must equal the RESTING height of the stack, whatever makes that height: the
  // viewport, the copy, the font, how the CTA wraps at this width — and the pill row, which a
  // single-style garment withholds below two slides and therefore ADDS on the second try-on.
  //
  // So it is observed rather than sampled at named moments. Mount + `resize` alone left the
  // reservation stale for every one of those causes; the stack then overflowed it and sat on
  // the photo, over the download button and the "AI-generated" caption. Naming the triggers
  // one by one does not converge either — a slide arrives while the picker is still OPEN (the
  // shopper commits from it), and the guard below correctly refuses to read a height then, so
  // a slide-count trigger fires exactly when it cannot be used.
  //
  // Two rules keep the observer from reintroducing the creep that made this a one-shot read:
  // it never accepts a height while a section is open, and it waits out the fold transition
  // before believing one. Both are about the same thing — only a SETTLED height is the resting
  // height.
  const sectionsOpenRef = useRef(false);
  sectionsOpenRef.current = scoreOpen || pickerOpen;
  const measureRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (el === null) {
      return;
    }
    const measure = (): void => {
      // Never read while a panel is open or animating — that is what fed the hero a stream of
      // intermediate heights and made the photo creep.
      if (sectionsOpenRef.current) {
        return;
      }
      let h = el.offsetHeight;
      const scoreRow = scoreRowRef.current;
      if (scoreRow !== null) {
        // Subtract the score bar AND the seam that disappears with it. The seam is measured
        // rather than assumed: it only exists when a section actually follows the score, and
        // on the sheet the picker is `display: none` while collapsed (a zero-size rect), so a
        // hard-coded gap would over-subtract and let the bar creep onto the photo.
        const next = scoreRow.nextElementSibling;
        const seam =
          next === null
            ? 0
            : Math.max(
                0,
                next.getBoundingClientRect().top - scoreRow.getBoundingClientRect().bottom,
              );
        h -= scoreRow.offsetHeight + seam;
      }
      if (h > 0) {
        setReservedBand((prev) => (prev === h ? prev : h));
      }
    };
    // Longer than the 250ms fold so a collapse settles before anything is read: the panel is
    // still shrinking when `pickerOpen` flips false, and those intermediate heights are what
    // used to make the photo creep. Trailing-edge only, so a burst of observer callbacks costs
    // one read.
    const SETTLE_MS = 320;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const measureWhenSettled = (): void => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(measure, SETTLE_MS);
    };

    measureRef.current = measure;
    measure();
    // Observes the stack itself, so every cause of a height change is covered by construction
    // — including the ones no dependency list can name.
    const observer = new ResizeObserver(measureWhenSettled);
    observer.observe(el);
    globalThis.addEventListener("resize", measureWhenSettled);
    return () => {
      clearTimeout(settleTimer);
      observer.disconnect();
      globalThis.removeEventListener("resize", measureWhenSettled);
    };
    // No dependencies: the observer supersedes them. Re-subscribing on every slide would only
    // tear down and rebuild the same observation of the same element.
  }, []);

  // The observer's debounce is there to outlast the fold, and a slide arriving is not a fold —
  // it is a row appearing at once. Waiting 320ms for it is visible: the stack is anchored to the
  // photo's lower edge, so the new pill row lands ON the photo and then jumps off it a third of
  // a second later. Read it here instead, before paint, so the band is already correct in the
  // frame the row appears. The observer still covers everything this cannot name.
  useLayoutEffect(() => {
    measureRef.current?.();
  }, [carouselSlides.length]);

  const requestVariant = onSelectVariant ?? onSelectSize;

  // Which sizes the screen refuses: the server's HARD gate, plus any size whose own fit verdict
  // already says it does not fit.
  //
  // The two disagree more often than you would expect, and keying only on `gate` is why a size
  // the panel called "too small" still had a live try-on button. On a real body: size 28 came
  // back gated, but size 30 came back `fit: "too_small"` with NO gate — the gate's lower bound
  // is `waist_min - 40 mm` (808 mm) and size 30's garment waist is 810 mm, so it cleared the
  // hard bound by 2 mm while still being 4.2 cm narrower than the shopper's waist. Telling
  // someone a size is too small and then offering to render it is not a distinction worth
  // preserving in the UI, so a failing verdict blocks exactly like a gate does.
  const gateBySize = useMemo(
    () =>
      buildSizeGates(
        product.attributeMetadata.sizes.map((size) => size.slug),
        vm.recommendationData?.recommendations,
        // The server's own refusal is the ONE gate source that survives a missing/failed
        // recommendation — and that is precisely when the shopper has nothing else to go on.
        // Dropping it here meant a size this screen had already refused stayed unmarked and
        // selectable, while the size step one tap away drew it struck through off the same
        // rejection. `size-gates.ts` requires the two screens to refuse the same sizes.
        lastTryOnFailure,
      ),
    [product.attributeMetadata.sizes, vm.recommendationData, lastTryOnFailure],
  );
  const draftGate = gateBySize.get(draftSize);

  const draftAttributes = useMemo(() => {
    const next: Record<string, string> = { ...activeAttributes, size: draftSize };
    if (draftColor.length > 0) {
      next["colorway"] = draftColor;
    }
    return next;
  }, [activeAttributes, draftSize, draftColor]);

  /**
   * Index of the NEWEST render already generated for this exact combination, or `-1`. `style`
   * only counts on a multi-style product — elsewhere the slides carry no style key.
   */
  const slideIndexFor = useCallback(
    (size: string, color: string, style: string | undefined): number =>
      carouselSlides.findLastIndex(
        (s) =>
          s.attributes["size"] === size &&
          (s.attributes["colorway"] ?? "") === color &&
          (!hasStyles || s.attributes[STYLE_ATTRIBUTE_KEY] === style),
      ),
    [carouselSlides, hasStyles],
  );

  // Picking a variant that ALREADY has a render puts it on the hero immediately. There is
  // nothing to generate, so making the shopper press the CTA to reveal a picture that exists
  // is a step that buys nothing. This does not undermine the reason the draft is staged at
  // all: that guards against callouts describing a garment which is not on screen, and here
  // the hero, the fit ribbon and the callouts all move together onto one real render.
  // Combinations with no render still stage and wait for the CTA to spend pipeline work.
  // Never while a render is in flight — the flow owns the cursor then (`initialSlideIndex`),
  // and moving it from here would fight the result about to land.
  const stageVariant = useCallback(
    (size: string, color: string) => {
      setLastPickedSize(size);
      const existing = busy ? -1 : slideIndexFor(size, color, activeStyle);
      if (existing === -1) {
        setDraft({ size, color });
      } else {
        // Clear the draft HERE rather than leaving it to the reset effect below. That effect is
        // keyed on `activeAttributes`, which does not change identity when the picked
        // combination is the one ALREADY on screen — so a previously-staged size stayed latched
        // and the picker could not return to the visible slide's own size. Staging a gated size
        // and then tapping back to the size you were looking at left the chip selected on the
        // gated one with the CTA disabled, i.e. no way out short of closing the sheet.
        setDraft(null);
        setSlide(existing);
      }
    },
    [busy, slideIndexFor, activeStyle],
  );

  const commitDraft = useCallback(() => {
    // Newest existing render for this exact combination wins — switching to it is instant and
    // costs no pipeline work. Only genuinely-unrendered combinations go to the host.
    const existing = slideIndexFor(draftSize, draftColor, activeStyle);
    if (existing !== -1) {
      setSlide(existing);
    } else {
      requestVariant?.(draftAttributes);
    }
    if (!isModal) {
      // On the sheet the picker covers the try-on it just changed — close it so the result
      // (or the busy hero) is what the shopper sees.
      setPickerOpen(false);
    }
  }, [slideIndexFor, draftSize, draftColor, activeStyle, draftAttributes, requestVariant, isModal]);

  // A style flip is immediate and never staged: the machine renders every style of a size and
  // colour together, so the companion is normally already on hand and switching to it is as
  // free as a pill tap. Keyed on the VISIBLE render (not the draft) — the toggle sits on the
  // photo and describes what is on it. When the companion has not landed yet the host is asked
  // for it; the machine replays from its cache the moment it exists. Never while a render is in
  // flight — the flow owns the cursor then.
  const selectStyle = useCallback(
    (slug: string) => {
      if (busy || slug === activeStyle) {
        return;
      }
      const existing = slideIndexFor(shownSize, activeColor ?? "", slug);
      if (existing === -1) {
        requestVariant?.({ ...activeAttributes, size: shownSize, [STYLE_ATTRIBUTE_KEY]: slug });
      } else {
        setDraft(null);
        setSlide(existing);
      }
    },
    [busy, activeStyle, slideIndexFor, shownSize, activeColor, activeAttributes, requestVariant],
  );

  const sizeOptions: readonly VariantPickerOption[] = useMemo(
    () =>
      product.attributeMetadata.sizes.map((s) => {
        const label = tryOnSizeLabelForAttribute(product, s.slug) ?? s.label;
        const gate = gateBySize.get(s.slug);
        const soldOut = s.soldOut === true;
        // The chip conveys each of these visually (muted / struck through), and AT announces
        // neither — so whichever applies is spelled into the accessible name. Stock outranks
        // fit: an unbuyable size's fit verdict is moot.
        let srLabel = label;
        if (soldOut) {
          srLabel = `${label} (${tv.sizeSoldOutSr})`;
        } else if (fitUi && s.slug === recommendedSlug) {
          // The recommendation callout is fit-intelligence UI — without the flag the chip
          // reads as a plain size, matching the unmarked visual.
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

  // Failure mode: the shopper tapped an out-of-stock chip. The pick is refused (the draft stays
  // put) and the axis row says why, replacing the recommendation pill until they pick again.
  const [soldOutPick, setSoldOutPick] = useState<string | null>(null);
  const soldOutBySize = useMemo(
    () =>
      new Set(product.attributeMetadata.sizes.filter((s) => s.soldOut === true).map((s) => s.slug)),
    [product],
  );

  const colorOptions = product.attributeMetadata.colorways;
  const draftColorMeta = colorOptions.find((c) => c.slug === draftColor);
  const draftSizeLabel = tryOnSizeLabelForAttribute(product, draftSize) ?? draftSize;

  // Failure mode: the try-on render itself failed. The machine's own record of which size was
  // requested is authoritative — the shopper may have re-picked since — and the size latched
  // when the request went out covers the ordinary path, where `error` carries no such record.
  //
  // Deliberately NOT `draftSize`. That follows the visible render and the shopper's staged pick,
  // so using it made the notice describe whatever they were looking at: it named a size they had
  // not tried, renamed itself when they tapped a different chip, and sent the retry button after
  // the wrong variant.
  //
  // `selection` is the last resort rather than the draft because this screen STAGES picks — the
  // chips set a draft and only the CTA commits — so the committed selection still holds the size
  // the failed request was issued with, even after the shopper taps around. It also covers a
  // mount that lands directly in `error` and so never saw `requesting` to latch.
  const tryOnRenderFailed = vm.tryOnPipeline === "error";
  const failedSizeSlug =
    lastTryOnFailure !== undefined && lastTryOnFailure.requestedSize.length > 0
      ? lastTryOnFailure.requestedSize
      : (attemptedSize ?? selection["size"] ?? draftSize);
  const failedVariantLabel = tryOnSizeLabelForAttribute(product, failedSizeSlug) ?? failedSizeSlug;
  // The banner and its retry button describe ONE past attempt. They belong on screen until the
  // shopper deliberately picks a DIFFERENT size — at which point "Try-on in S failed" sitting
  // over a picker showing M reads as a verdict on M, and the CTA below falls through to the
  // ordinary commit path for the newly picked size instead.
  //
  // Keyed on the shopper's own pick, not on `draft`/`draftSize`. A failure resets the draft to
  // follow the visible render, and that render is frequently NOT the size that just failed —
  // the normal post-failure state, which must still be reported. Comparing sizes would silence
  // the banner exactly when it matters most.
  const shopperMovedOn = lastPickedSize !== null && lastPickedSize !== failedSizeSlug;
  const showRenderFailure = tryOnRenderFailed && !shopperMovedOn;

  /**
   * Retry the variant that FAILED, not the one currently on the hero. A failure resets the draft
   * back to whatever render is still on screen, so routing retry through the normal commit path
   * would quietly re-select that existing slide and never call the host — the button would look
   * like it did nothing. This also skips the "already rendered?" shortcut on purpose: the render
   * failed, so there is nothing cached to fall back to.
   */
  const retryFailedVariant = useCallback(() => {
    const attributes: Record<string, string> = { ...activeAttributes, size: failedSizeSlug };
    if (draftColor.length > 0) {
      attributes["colorway"] = draftColor;
    }
    requestVariant?.(attributes);
  }, [activeAttributes, failedSizeSlug, draftColor, requestVariant]);

  // The "you picked a size the gate rejects" explainer — rides the axis header's note slot
  // (replacing the recommendation pill, as the reference draws it) rather than sitting under
  // the picker as a paragraph. The pick is legitimate, it just can't be simulated.
  let gateNote: ReactNode = null;
  // The size named here must be one this screen would actually accept. `recommendedSlug` is not
  // that by itself: it skips only the hard `gate`, while `gateBySize` also refuses a failing fit
  // verdict and cascades — so it could name the very chip drawn struck through beside it.
  const gateNoteAlternative =
    draftGate === undefined
      ? undefined
      : resolveGateAlternative(
          product.attributeMetadata.sizes.map((size) => size.slug),
          gateBySize,
          draftSize,
          draftGate,
          recommendedSlug,
        );
  if (draftGate !== undefined && gateNoteAlternative !== undefined) {
    const recommended =
      tryOnSizeLabelForAttribute(product, gateNoteAlternative) ?? gateNoteAlternative;
    gateNote =
      draftGate === "too_large"
        ? tv.gateInspectTooLargeNote(draftSizeLabel, recommended)
        : tv.gateInspectTooSmallNote(draftSizeLabel, recommended);
  }

  // One axis today — the product model carries a single `size` list. `VariantPicker` takes an
  // array so a product graded on two axes (a jeans waist × length run) renders as two rows
  // without a change here. Note precedence: a refused sold-out tap is the freshest thing to
  // say, then a gate verdict about the staged pick, then the steady-state recommendation pill.
  // React 19's `ReactNode` union includes `Promise<AwaitedReactNode>`, so a callback returning
  // a node trips the promise rule; this one returns a localized string node, never a promise.
  // oxlint-disable-next-line typescript-eslint/promise-function-async
  const axisNote = useMemo(() => {
    if (soldOutPick !== null) {
      return tv.sizeSoldOutNote(tryOnSizeLabelForAttribute(product, soldOutPick) ?? soldOutPick);
    }
    return gateNote ?? undefined; // eslint-disable-line unicorn/no-useless-undefined -- `note?: ReactNode` is exact-optional; null would render
  }, [tv, product, soldOutPick, gateNote]);
  // A product sold along several axes (waist × length) splits this one size row into a row per
  // axis; a size-only product gets it back untouched.
  const lengthHint = recommendedLengthHint(product, vm.recommendationData, recommendedSlug);
  const pickerAxes = useMemo(
    () =>
      splitSizeAxis(
        product,
        {
          key: "size",
          // Names the pick, like the colour row does. Reads off `draftSize` so it tracks the
          // chip the shopper just tapped, including while a render for it is still in flight.
          label: tv.sizeAxisLabel(tryOnSizeLabelForAttribute(product, draftSize) ?? draftSize),
          options: sizeOptions,
          selected: draftSize,
          // The "Recommended X" pill and the ring-marked chip are fit-intelligence UI — without
          // the flag the row shows plain sizes (the machine still seeds the recommended size as
          // the default selection, it just isn't called out).
          ...(fitUi ? { recommended: recommendedSlug } : {}),
          ...(!fitUi || recommendedSlug.length === 0
            ? {}
            : {
                recommendationLabel: tv.recommendedChip(
                  tryOnSizeLabelForAttribute(product, recommendedSlug) ?? recommendedSlug,
                ),
              }),
          ...(axisNote === undefined ? {} : { note: axisNote }),
          onSelect: (value: string) => {
            if (soldOutBySize.has(value)) {
              // Refuse the pick — there is nothing to sell — but say so instead of ignoring the tap.
              setSoldOutPick(value);
              return;
            }
            setSoldOutPick(null);
            stageVariant(value, draftColor);
          },
        },
        tv,
        lengthHint,
      ),
    [
      lengthHint,
      tv,
      sizeOptions,
      draftSize,
      draftColor,
      recommendedSlug,
      fitUi,
      product,
      axisNote,
      soldOutBySize,
      stageVariant,
    ],
  );

  // Image callouts: one card per anchored fit dimension, floating over the hero. The reference
  // uses them in BOTH layouts — the desktop modal shows the same bubbles on the photo rather
  // than leader lines into a side panel, so there is a single callout treatment to reason about.
  //
  // They are the fit score's own detail, so they follow it: the ribbon collapsed shows the photo
  // clean, expanding it annotates the body. That is the rule the reference draws (bubbles appear
  // only on the frames whose score card is open) and it keeps the two fit affordances from
  // competing — a scored garment either explains itself or gets out of the way.
  const hasCallouts =
    fitUi &&
    !busy &&
    activeFitAnchors !== undefined &&
    activeFitAnchors.length > 0 &&
    activeFitChecks !== undefined &&
    activeFitChecks.length > 0;
  const calloutAnchors = activeFitAnchors ?? EMPTY_ANCHORS;
  const calloutChecks = activeFitChecks ?? EMPTY_CHECKS;
  const orderedChecks = useMemo(
    () => orderChecksByAnchor(calloutChecks, calloutAnchors),
    [calloutChecks, calloutAnchors],
  );

  const [slideAspect, setSlideAspect] = useState(TRY_ON_HERO_PLACEHOLDER_ASPECT);

  const { frameRef, contentBelowRef, frameFitClass, frameStyle } = usePreviewBaselineAspect(
    slideAspect,
    {
      scrollAware: true,
      fallbackToBaseline: false,
      // The hero takes as much of the sheet body as it can WITHOUT cropping: the frame stays
      // locked to the photo's own aspect and shrinks to whatever height is left once the
      // overlay stack is subtracted (that stack is wired to `contentBelowRef` below).
      // minShrinkScale 0 lets it shrink all the way rather than ever overflowing — a taller
      // frame than the body would push the subject's feet out of view, which is exactly what
      // this screen must never do.
      minShrinkScale: 0,
    },
  );

  const heroFrameStyle: CSSProperties = {
    ...frameStyle,
    // The photo keeps its FULL-WIDTH scale (height stays `100cqw / aspect`) while the frame
    // clamps to the CTA's width — so the sides CROP to align with the controls instead of the
    // whole image shrinking. With 24px gutters that crops 24px per side, inside the
    // 30px-per-side budget the composition allows; the subject is centred, so only backdrop
    // is lost. Same treatment as the size step's hero.
    ...(slideOverlayColor === undefined
      ? {}
      : ({ "--sv-color-slide-overlay": slideOverlayColor } as CSSProperties)),
  };

  useEffect(() => {
    onShownAttributesChange?.(shownAttributes);
  }, [shownAttributes, onShownAttributesChange]);

  // Saving the render is the one thing a shopper cannot do from the page behind the sheet, so
  // it lives in the photo's corner opposite the AI-generated label, as the reference draws it.
  // Only for a finished render: there is nothing worth saving about the source photo mid-flight.
  const downloadButton =
    activeSrc.length > 0 && !busy ? (
      <TryOnDownloadButton
        src={activeSrc}
        label={tv.downloadImage}
        size={shownSize}
        garment={product.displayName}
      />
    ) : null;

  const hero = (
    <div
      ref={(el) => {
        frameRef(el);
        calloutFrameRef.current = el;
      }}
      // `frameFitClass` keeps the frame locked to the photo's aspect ratio (`w-auto` + a
      // measured height). Do NOT force a width here: `w-full` breaks the aspect lock, and the
      // image then crops the subject's head or feet to fill the box.
      className={cn(
        tryOnHeroFrameClassName,
        frameFitClass,
        // AFTER `frameFitClass`: both set a max-width and `cn` resolves conflicts last-wins,
        // so ordered the other way the fit class's `max-w-full` silently undid the clamp.
        // Clamp the sheet's frame to the CTA width; the full-scale photo inside then crops
        // equally on both sides (see `heroFrameStyle`). The modal's frame is column-sized.
        isModal ? undefined : "sv:mx-auto sv:w-full sv:max-w-[calc(100%-48px)]",
      )}
      style={heroFrameStyle}
    >
      {activeSrc.length > 0 ? (
        <>
          <ImageView
            src={activeSrc}
            zoomable={!busy}
            // No placeholder grey — the frame stays aspect-locked (it has to, or the callout
            // anchors drift), so it can be narrower than the sheet, and matching the SURFACE
            // is what keeps those side bands invisible against the white shell.
            withBackground={false}
            // `object-contain`: the frame is already aspect-locked to this image, so this is
            // normally pixel-identical to a cover fit — but on the frames where the measured
            // aspect is momentarily stale (first paint, a render of a different shape) it
            // letterboxes instead of cropping, so a head or a pair of feet is never sliced off.
            // The sheet rounds the render as a card on the white surface — it now shares the
            // controls' gutter, so it reads as one of the stacked cards rather than a
            // full-bleed photo. The modal keeps it square inside its own two-column split.
            // Sheet: `cover`, so the frame's width clamp crops the sides rather than
            // letterboxing. The frame's height derives from this photo's own aspect, so cover
            // only ever crops horizontally — a head or a pair of feet is never sliced off.
            // The modal keeps `contain`: its frame is column-sized, not aspect-derived.
            className={cn(
              "sv:h-full sv:w-full",
              isModal
                ? "sv:rounded-none sv:object-contain"
                : "sv:rounded-[var(--sv-radius-control)] sv:object-cover",
            )}
            containerClassName={cn(
              "sv:h-full sv:w-full",
              isModal
                ? "sv:rounded-none sv:bg-[var(--sv-color-surface)]"
                : "sv:rounded-[var(--sv-radius-control)] sv:bg-transparent",
            )}
            // The parent frame owns the aspect. Without this override `ImageView` also stamps
            // the image's own natural ratio on its container, which fights the measured height.
            containerStyle={{ aspectRatio: "auto" }}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setSlideAspect(img.naturalWidth / img.naturalHeight);
              }
            }}
          />
          {busy ? (
            <>
              <div aria-hidden className="sv-tryon-hero-overlay sv:absolute sv:inset-0" />
              <div
                aria-hidden
                className="sv-tryon-shimmer sv:pointer-events-none sv:absolute sv:inset-0"
              />
              <TryOnBusyMessageStack message={busyMessage} />
            </>
          ) : null}
        </>
      ) : (
        // Before the first render lands the hero has nothing to show. Painting that box grey
        // turned the whole left half of the dialog a different colour than every other step —
        // the surface is what the shopper reads as "the dialog", and it must not change
        // between steps. An empty white box simply reads as the frame not being filled yet.
        <div className="sv:h-full sv:w-full sv:bg-[var(--sv-color-surface)]" aria-hidden />
      )}
      {activeSlide !== undefined &&
      activeSrc.length > 0 &&
      !busy &&
      ImageOverlay !== NullImageOverlay ? (
        // Floats over the photo's top-left corner (the save/caption row owns the bottom), so a
        // host overlay can never move or resize anything on the screen.
        <div
          data-studio-vaai="try-on-image-overlay"
          className="sv:pointer-events-none sv:absolute sv:top-2 sv:left-2 sv:z-20 sv:max-w-[calc(100%-16px)]"
        >
          <ImageOverlay
            attributes={activeSlide.attributes}
            {...(activeSlide.tryOnId === undefined ? {} : { tryOnId: activeSlide.tryOnId })}
            {...(activeSlide.provenance === undefined
              ? {}
              : { provenance: activeSlide.provenance })}
          />
        </div>
      ) : null}
      {/* Only over a REAL render. While a try-on is in flight the hero shows the shopper's OWN
          source photo, and captioning their photograph "AI-generated" is simply false. */}
      {activeSrc.length > 0 && !busy ? (
        // Anchored to the IMAGE, not to the surrounding column, and identical in both layouts:
        // save left, provenance right, on one baseline. Pinned inside the frame it cannot drift
        // onto the surface when the render is letterboxed, and the pair keeps the same inset at
        // every viewport and through every panel expansion.
        <div className="sv:pointer-events-none sv:absolute sv:inset-x-0 sv:bottom-0 sv:z-10 sv:flex sv:items-center sv:justify-between sv:gap-2 sv:px-3 sv:pb-2">
          <span className="sv:pointer-events-auto">{downloadButton}</span>
          {/* Height tag and provenance share ONE right-hand group. Both used to be pinned to the
              frame's bottom-right independently — `bottom-3 right-3` against the row's `pb-2` —
              so on a slide carrying a height they printed on top of each other. Grouped, the row
              lays them out and they cannot collide however long either gets. */}
          <span className="sv:flex sv:min-w-0 sv:items-center sv:gap-2">
            {activeSlide?.bottomRightLabel === undefined ? null : (
              <TryOnSlideHeightLabel label={activeSlide.bottomRightLabel} />
            )}
            <span
              data-studio-vaai="ai-generated-label"
              className="sv:text-[12px] sv:font-light sv:leading-none sv:text-[#757575]"
            >
              {tv.aiGeneratedLabel}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );

  // ── Fit score (the "fit percentage" layer — only with fit intelligence) ─────
  // Failure mode: the recommendation request errored, so there is no score to show. The bar
  // takes the ribbon's slot and offers a retry rather than leaving a hole.
  let fitScore: ReactNode = null;
  if (!fitUi) {
    fitScore = null;
  } else if (vm.recommendation === "error") {
    fitScore = (
      <FitScoreUnavailable
        label={tv.fitScoreUnavailable}
        retrySrLabel={tv.fitScoreRetrySr}
        busy={busy}
        {...(onRetryRecommendation === undefined ? {} : { onRetry: onRetryRecommendation })}
      />
    );
  } else if (activeRecommendation !== undefined) {
    const description = intendedFitDescription(tv, vm.recommendationData);
    fitScore = (
      <FitScorePanel
        label={tv.fitScoreTitle(sizeLabel ?? shownSize)}
        pct={Math.max(0, Math.min(100, Math.round(activeRecommendation.fitMatch)))}
        toggleSrLabel={tv.fitScoreToggleSr}
        open={scoreOpen}
        onOpenChange={setScoreOpen}
        {...(description === undefined ? {} : { detail: tv.intendedFit(description) })}
      />
    );
  }

  // Independent of `recommendationData`: when the recommendation fails the shopper keeps a
  // working size/color picker — they just lose the fit scoring on top of it.
  const pickerBody = (
    <div className="sv:px-3.5 sv:pb-3.5">
      <VariantPicker
        disabled={busy}
        axes={pickerAxes}
        colorways={colorOptions}
        selectedColorway={draftColor}
        onSelectColorway={(slug) => {
          stageVariant(draftSize, slug);
        }}
        {...(draftColorMeta === undefined
          ? {}
          : { colorwayLabel: tv.colorAxisLabel(draftColorMeta.label) })}
      />
    </div>
  );
  let picker: ReactNode = null;
  if (product.attributeMetadata.sizes.length > 0) {
    picker = isModal ? (
      // The modal ALWAYS shows the picker expanded, as a static card with no chevron — the
      // dialog has the room, and a collapsible there just hid the screen's main control
      // (identical with the fit UI on or off). Same surface as the sheet's `Disclosure`: the
      // overlay tone is a light grey, so it reads as a card against the white body too.
      <div data-studio-vaai="try-on-variant-section" className={FROSTED_CARD_CLASS}>
        <div className="sv:px-3.5 sv:pt-2.5 sv:pb-2.5 sv:text-[13px] sv:font-medium sv:leading-tight sv:text-[var(--sv-color-foreground)]">
          {tv.variantPickerTitle}
        </div>
        {pickerBody}
      </div>
    ) : (
      <Disclosure
        data-studio-vaai="try-on-variant-section"
        label={tv.variantPickerTitle}
        toggleSrLabel={tv.variantPickerToggleSr}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        // The collapsed card would duplicate the primary CTA sitting right under it (the CTA
        // is what opens the picker on the sheet — see `primaryCta`), so it hides until opened.
        // The reference draws the resting frame with just the ribbon above the CTA. Kept
        // mounted (not unmounted) so the open transition still plays from 0fr.
        className={cn(!pickerOpen && "sv:hidden")}
      >
        {pickerBody}
      </Disclosure>
    );
  }

  // Failure mode: the render for the committed variant failed. Say which variant failed (the
  // shopper may have moved on to a different pick since) and turn the CTA into a retry, all
  // without leaving the screen — the previous try-on is still on the hero behind this.
  // A plain red line with the alert glyph, left-aligned — the same shape `ErrorMessage`'s
  // inline variant draws, because this IS that kind of message: it qualifies the retry CTA
  // directly beneath it. It was previously an outlined banner pinned to the TOP of the stack,
  // above the score and the picker, which read as a headline for the whole screen rather than
  // as the caption of the button that acts on it. It renders in the actions block now.
  const tryOnFailed = showRenderFailure ? (
    <div
      role="alert"
      data-studio-vaai="try-on-render-failed"
      className="sv:flex sv:min-w-0 sv:items-start sv:gap-1.5 sv:text-[13px] sv:font-normal sv:leading-snug sv:text-[var(--sv-color-danger)]"
    >
      <IconAlertCircle aria-hidden className="sv:mt-0.5 sv:size-3.5 sv:shrink-0" />
      <span className="sv:min-w-0 sv:flex-1">{tv.tryOnFailedForVariant(failedVariantLabel)}</span>
    </div>
  ) : null;

  // Collapsed, the primary CTA is what opens the picker (the reference has no separate
  // affordance for it); open, it commits the staged variant. A failed render pre-empts both —
  // the one thing worth offering then is another attempt at the same variant.
  // A GATE rejection is not retryable — the same size is refused for the same reason every
  // time, so offering "try again" hands the shopper a live button whose only outcome is the
  // error they are already looking at. This branch pre-empts every other CTA, so it was also
  // the hole that kept the main button clickable on a gated size after the first refusal, no
  // matter what the picker's own gate-aware CTA did. Gated failures fall through to that CTA,
  // which greys out and pushes them to change size instead.
  const failedVariantGated = gateBySize.get(failedSizeSlug) !== undefined;
  let primaryCta: ReactNode;
  if (showRenderFailure && !failedVariantGated) {
    primaryCta = (
      <Button
        type="button"
        className={tryOnPrimaryCtaClassName}
        disabled={busy}
        aria-busy={busy}
        onClick={retryFailedVariant}
      >
        {tv.retryTryOnCta}
      </Button>
    );
  } else {
    primaryCta =
      pickerOpen || isModal ? (
        <Button
          type="button"
          className={tryOnPrimaryCtaClassName}
          // Never disabled just because the draft matches what is already on screen:
          // `commitDraft` resolves that combination to its existing slide, so the click is a
          // no-op by construction. A CTA that greys out on the resting modal reads as a broken
          // screen — the shopper cannot tell it apart from a disabled control they must fix.
          //
          // A gated size still blocks: that is a deliberate fit verdict, not a no-op. The
          // button is only half the defence though — it can only grey out once the
          // recommendation has landed, so the machine refuses a gated `START_TRY_ON`
          // outright (see `tryOnPipelineRegion`). That covers the fast tap and the
          // auto-start path, neither of which passes through this control.
          disabled={busy || draftGate !== undefined}
          aria-busy={busy}
          onClick={commitDraft}
        >
          {/* Keyed on the label so React remounts the span and the fade replays: the CTA
              swaps meaning as the picker opens, and a hard text change under a moving panel
              read as a glitch. `motion-reduce` opts out. */}
          <span
            key={`commit-${draftSizeLabel}-${draftColorMeta?.label ?? ""}`}
            className="sv:motion-safe:animate-[sv-cta-label_200ms_ease-out]"
          >
            {tv.tryOnVariantCta(draftSizeLabel, draftColorMeta?.label)}
          </span>
        </Button>
      ) : (
        <Button
          type="button"
          className={tryOnPrimaryCtaClassName}
          disabled={busy}
          onClick={() => {
            setPickerOpen(true);
          }}
        >
          {tv.variantPickerTitle}
        </Button>
      );
  }

  const secondaryCta = (
    <Button
      type="button"
      variant="ghost"
      className={tryOnSecondaryCtaClassName}
      disabled={busy}
      onClick={() => {
        onAddToCart(draftAttributes);
      }}
    >
      {tv.addToCart(draftSizeLabel, priceLabel)}
    </Button>
  );

  const actions = (
    <VStack gap="sm" className="sv:min-w-0">
      {/* Inline even for a failure, which is the one place the reference departs from the box:
          this screen is already a stack of frosted cards over a photo, and another boxed panel
          would fight them. The line qualifies the retry CTA directly beneath it. */}
      <ErrorMessage variant="inline" />
      {tryOnFailed}
      {primaryCta}
      {secondaryCta}
    </VStack>
  );

  // The mobile row under the photo: tried-variant pills from the left edge, and on a multi-style
  // garment the style toggle at the right end — one line, one height (the toggle is sized to
  // the pills, see `StyleToggleDefault`), over the same frosted surface.
  //
  // One render is just the photo on screen, so a single-style garment withholds the strip
  // below two slides — one pill states nothing the header does not already say. A styled
  // garment shows the row from the first render, because the toggle has to be somewhere and
  // the pill beside it says which of the two is on screen.
  //
  // The toggle names the style ON the photo, so while a render is in flight there is nothing
  // for it to describe (the hero is the busy screen) and it is not drawn at all — the pills of
  // finished renders stay on mobile. `selectStyle` still guards `busy` for the keyboard case.
  const showPillRow = (!isModal && carouselSlides.length >= 2) || (hasStyles && !busy);
  const pillRow = showPillRow ? (
    <div
      data-studio-vaai="try-on-tried-variants"
      className="sv:flex sv:min-w-0 sv:items-center sv:gap-2"
    >
      {!isModal ? (
        <TriedVariantPills
          className="sv:min-w-0 sv:flex-1"
          product={product}
          styles={hasStyles ? styles : EMPTY_STYLES}
          activeStyle={hasStyles ? activeStyle : undefined}
          slides={carouselSlides}
          activeIndex={activeIndex}
          onSelect={setSlide}
          label={tv.triedVariantsLabel}
        />
      ) : null}
      {hasStyles && !busy ? (
        <StyleToggle
          className="sv:ml-auto"
          styles={styles}
          selected={activeStyle}
          onSelect={selectStyle}
          label={tv.styleToggleSr}
        />
      ) : null}
    </div>
  ) : null;

  // Tried-size bubbles belong only on mobile; the modal keeps just the style toggle.
  // The sheet shows the row only while the picker is CLOSED — expanded, the picker's own
  // size chips say the same thing one control lower.
  //
  // Collapsed with the disclosure's own `0fr → 1fr` grid trick rather than unmounted, on the
  // same 250ms ease-out, so opening the picker reads as the pills folding INTO it instead of a
  // row vanishing a frame before the panel grows. Absent entirely when there is no row: an
  // empty wrapper would still cost a `gap-5` seam in the stack below.
  let pillRowSlot: ReactNode = null;
  if (pillRow !== null) {
    pillRowSlot = isModal ? (
      pillRow
    ) : (
      <div
        className={cn(
          "sv:grid sv:motion-reduce:transition-none",
          // The row is BOTTOM-anchored (the stack is pinned to the photo's lower edge), so
          // while the picker grows underneath it the pills are pushed upward. Fading them on
          // the same 250ms as the fold left them legible for most of that travel, and they
          // read as flying up the screen before vanishing.
          //
          // So the opacity is decoupled from the height: out in 110ms, gone before the
          // travel is perceptible, while the row keeps collapsing underneath. Coming back,
          // the fade waits 140ms for the space to exist and then takes 160ms, so the pills
          // arrive into their final position instead of sliding down into it. The height
          // half stays 250ms in both directions, matching the drawer opposite it — one
          // gesture, two elements, no size dependence.
          pickerOpen
            ? "sv:grid-rows-[0fr] sv:opacity-0 sv:[transition:grid-template-rows_250ms_cubic-bezier(0.22,1,0.36,1),opacity_110ms_ease-out]"
            : "sv:grid-rows-[1fr] sv:opacity-100 sv:[transition:grid-template-rows_250ms_cubic-bezier(0.22,1,0.36,1),opacity_160ms_ease-out_140ms]",
        )}
        // `inert` while collapsed: the pills are still in the DOM (they animate), so without
        // it a closed row keeps its tab stops and stays reachable to assistive tech.
        inert={pickerOpen}
      >
        <div className="sv:min-h-0 sv:overflow-hidden">{pillRow}</div>
      </div>
    );
  }

  // On the sheet the disclosure is the TOP of the stack, so anything pinned to the photo's
  // bottom edge ends up behind it. Making the label the stack's first row means it always sits
  // just above the fit-score card and rides up with it as a panel expands — which is what the
  // reference shows, and why pinning it to the hero could never be right here.
  const overlayStack = (
    <div className="sv:flex sv:min-w-0 sv:flex-col sv:gap-2">
      {/* The score, the picker, and the CTAs below them are the screen's three sections and
          share ONE 20px rhythm, as the reference spaces them: `gap-5` here and on the modal's
          column, and the sheet's `pb-2` + footer `pt-3` adding up to the same. Change one and
          change them together. The `gap-2` above stays for the label / failure rows, which read
          as captions of the score rather than sections of their own. */}
      <div className="sv:flex sv:min-w-0 sv:flex-col sv:gap-5">
        {pillRowSlot}
        {/* Wrapped so the reservation measurement can exclude exactly this row — see the
            `scoreRowRef` note. Rendered only when present (an empty div would still cost a
            gap seam), and itself a stretching flex column so the panel keeps the exact
            full-width layout it had as a direct child of the stack. */}
        {fitScore === null ? null : (
          <div ref={scoreRowRef} className="sv:flex sv:min-w-0 sv:flex-col">
            {fitScore}
          </div>
        )}
        {picker}
      </div>
    </div>
  );

  const callouts = hasCallouts ? (
    <TryOnFitCallouts
      tv={tv}
      rootRef={calloutRootRef}
      frameRef={calloutFrameRef}
      anchors={calloutAnchors}
      checks={orderedChecks}
      // Stays mounted while the score is collapsed so it keeps its geometry measured and can
      // cross-fade; unmounting would make it pop back in a frame late, re-measuring from scratch.
      visible={scoreOpen}
    />
  ) : null;

  return (
    <SheetShell
      title={product.displayName}
      subtitle={tv.variantSubtitle(sizeLabel ?? "", showColorLine ? colorMeta.label : undefined)}
      busy={busy}
      onBack={onBack}
      onClose={onClose}
      scrollable={false}
      fillHeight
      // Full-screen on the sheet, as the reference draws this step: the panel covers the whole
      // viewport (no backdrop sliver, no top radius, no grabber) and the header floats over the
      // photo on a soft surface scrim instead of sitting in a white band above it.
      {...(isModal ? {} : { fillViewport: true })}
      // The sheet's hero does run edge to edge, so the body gutters go; the modal keeps them
      // because its hero sits in a two-column split, not against the surface edge.
      {...(isModal
        ? {}
        : {
            classNames: {
              body: "sv:px-0",
              // The shell's default `pt-4` put ~24px between the picker card and the CTA
              // against 8px inside the overlay stack — an uneven rhythm. `pt-3` brings the
              // section break to 20px, close to the reference.
              footer: "sv:pt-3",
              // The header keeps the shell's DEFAULT treatment — in flow, same padding and
              // position as every other step, so the top bar is consistent across the flow.
              root: "sv:relative",
            },
          })}
      {...(isModal ? {} : { footer: actions })}
    >
      {isModal ? (
        <div
          ref={calloutRootRef}
          data-studio-vaai="try-on-view"
          className="sv:relative sv:flex sv:min-h-0 sv:w-full sv:flex-1 sv:flex-col"
        >
          <ResponsiveSplit
            startClassName={flowMediaColumnClassName}
            start={hero}
            end={
              // `min-w-0` is what actually keeps this column from overflowing: it lets the
              // column shrink below its children's min-content width, so a long CTA wraps
              // instead of forcing the panel wider. Deliberately NOT `overflow-x-hidden` —
              // clipping would hide a layout bug rather than fix it, and it is what cut the
              // fit-score retry control off.
              // `mt-auto` sits on the GROUP, not just the CTAs: score, then picker, then the
              // buttons, all stacked against the foot of the column — the same bottom-anchored
              // order the sheet draws. The CTAs keep the resting baseline every other modal
              // step gives them, and an expanding section grows UPWARD into the column's empty
              // space instead of pushing the buttons down.
              <div className="sv:flex sv:h-full sv:min-h-0 sv:min-w-0 sv:flex-col sv:overflow-y-auto">
                {/* With the fit score present, the three sections stack against the foot on one
                    20px rhythm and fill the column. Without it there is nothing to hold the top
                    half, so the picker centres in the space above the CTAs — which is where the
                    size step puts its card, and these two screens must not disagree. */}
                {fitUi ? (
                  <div className="sv:mt-auto sv:flex sv:min-w-0 sv:flex-col sv:gap-5">
                    {overlayStack}
                    {actions}
                  </div>
                ) : (
                  <>
                    <div className="sv:my-auto sv:flex sv:min-w-0 sv:flex-col sv:gap-5">
                      {overlayStack}
                    </div>
                    <div className="sv:min-w-0">{actions}</div>
                  </>
                )}
              </div>
            }
          />
          {callouts}
        </div>
      ) : (
        <div
          ref={calloutRootRef}
          data-studio-vaai="try-on-view"
          // `justify-center` floats the aspect-locked photo in the space above the reserved
          // band, so the full-screen frame reads as the reference composes it — photo centred
          // between the floating header and the controls, letterboxed on the shared surface.
          // Centred between the header and the control stack. Top-aligning pooled ALL of the
          // leftover height under the photo — a dead band above the pills; splitting it reads
          // as breathing room on both sides instead. (When the photo fills the space, centring
          // and top-aligning are identical, so short viewports lose nothing.)
          className="sv:relative sv:flex sv:min-h-0 sv:w-full sv:flex-1 sv:flex-col sv:justify-center"
        >
          {hero}
          {/* The reserved band — the "artificial padding". The source try-ons carry almost no
              empty margin below the feet, so the hero is shortened by exactly the height of the
              RESTING controls and the subject stands clear of them. It is an empty spacer rather
              than the stack itself, so opening a section cannot change the reservation: the
              panel then grows upward over the photo, which is what the reference shows. The band
              paints in the same backdrop color as the photo, so the seam is invisible. */}
          <div
            ref={contentBelowRef}
            aria-hidden
            // The band changes in one step when a settled measurement lands (a pill row appears,
            // the copy rewraps). Easing it turns what was a visible snap of the whole photo into
            // the same motion the controls are already making.
            className="sv:shrink-0 sv:transition-[height] sv:duration-200 sv:ease-out sv:motion-reduce:transition-none"
            style={{ height: `${String(reservedBand)}px` }}
          />
          {callouts}
          {/* `max-h-full` + scroll keeps both sections reachable when they are expanded together
              on a short viewport. */}
          <div
            ref={stackRef}
            className="sv:absolute sv:inset-x-0 sv:bottom-0 sv:z-30 sv:max-h-full sv:overflow-y-auto sv:px-6 sv:pb-2"
          >
            {overlayStack}
          </div>
        </div>
      )}
    </SheetShell>
  );
}

/**
 * Small caption anchored to the bottom-right of a try-on slide, tagging try-ons
 * generated under an older body calibration with the height that produced them.
 * No backplate; matches the carousel chevron color so it reads as a sibling of
 * the navigation affordances rather than an image overlay.
 */
/**
 * Tags a render made under an EARLIER height calibration with the height that produced it, so a
 * shopper comparing history can see why an old slide looks different from a fresh one.
 *
 * Laid out by the provenance row rather than positioned against the frame: when it pinned itself
 * to the bottom-right it landed on top of the "AI-generated" caption, which owns that corner.
 */
function TryOnSlideHeightLabel({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="sv:shrink-0 sv:text-xs sv:font-medium sv:leading-none sv:text-(--sv-color-slide-overlay)"
    >
      {label}
    </span>
  );
}

/**
 * A filename the shopper can recognise in their downloads folder: the garment, then the size.
 * Accents fold and every other run of non-alphanumerics becomes a single hyphen, so the result
 * is safe on every filesystem — "Rana Striped Longsleeve" + "m" -> rana-striped-longsleeve-m.jpg.
 */
export function downloadFilename(garment: string, size: string): string {
  const slug = garment
    // ß has no decomposition under NFD, so it would survive to the punctuation pass and become
    // a hyphen ("Größe" -> "gro-e"). Fold it before normalising.
    .replaceAll("ß", "ss")
    .replaceAll("ẞ", "ss")
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  const base = slug === "" ? "studio-vaai-try-on" : slug;
  return size === "" ? `${base}.jpg` : `${base}-${size.toLowerCase()}.jpg`;
}

/**
 * On iOS, prepare the image file before the tap so the native share sheet can open while
 * user activation is still available, without navigating the try-on tab to a blob URL.
 * Other browsers use a blob download because the presigned image URL is cross-origin.
 * If fetching or handing over the image fails, open the original image in a new tab.
 */
function TryOnDownloadButton({
  src,
  label,
  size,
  garment,
}: {
  src: string;
  label: string;
  size: string;
  garment: string;
}) {
  const [busy, setBusy] = useState(false);
  const useNativeShare = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      (/iPhone|iPad|iPod/u.test(navigator.userAgent) ||
        (/Macintosh/u.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function",
    [],
  );
  const filename = downloadFilename(garment, size);
  const [prepared, setPrepared] = useState<
    { src: string; filename: string; file: File | undefined } | undefined
  >();
  const preparedForCurrentImage = prepared?.src === src && prepared.filename === filename;

  useEffect(() => {
    if (!useNativeShare) {
      return;
    }
    const controller = new AbortController();
    const prepare = async (): Promise<void> => {
      let file: File | undefined;
      try {
        const response = await fetch(src, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`download failed: ${String(response.status)}`);
        }
        const blob = await response.blob();
        const candidate = new File([blob], filename, { type: blob.type });
        if (navigator.canShare({ files: [candidate] })) {
          file = candidate;
        }
      } catch {
        // Leave the normal download fallback available if file sharing cannot be prepared.
      } finally {
        if (!controller.signal.aborted) {
          setPrepared({ src, filename, file });
        }
      }
    };
    void prepare();
    return () => {
      controller.abort();
    };
  }, [src, filename, useNativeShare]);

  const save = async (): Promise<void> => {
    if (busy || (useNativeShare && !preparedForCurrentImage)) {
      return;
    }
    const shareFile = preparedForCurrentImage ? prepared.file : undefined;
    setBusy(true);
    try {
      if (shareFile !== undefined) {
        // No fetch or timer before this call: the tap's user activation must remain available.
        await navigator.share({ files: [shareFile] });
        return;
      }
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error(`download failed: ${String(response.status)}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Revoked on the next tick: revoking synchronously can beat the click in Safari.
      globalThis.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
    } catch (error) {
      // Dismissing the native sheet is not a request to start another download or open a tab.
      if (
        shareFile === undefined ||
        !(error instanceof DOMException || error instanceof Error) ||
        error.name !== "AbortError"
      ) {
        globalThis.open(src, "_blank", "noopener,noreferrer");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      // Keep the native download handoff outside the drawer's swipe tracking.
      data-base-ui-swipe-ignore=""
      aria-label={label}
      title={label}
      disabled={busy || (useNativeShare && !preparedForCurrentImage)}
      onClick={() => {
        void save();
      }}
      className="sv:inline-flex sv:size-8 sv:cursor-pointer sv:appearance-none sv:items-center sv:justify-center sv:rounded-full sv:border-0 sv:bg-transparent sv:p-0 sv:text-[#757575] sv:outline-none sv:transition-colors sv:hover:bg-black/5 sv:hover:text-[var(--sv-color-foreground)] sv:focus-visible:ring-2 sv:focus-visible:ring-[var(--sv-color-foreground)] sv:disabled:cursor-default sv:disabled:opacity-50"
    >
      <IconDownload className="sv:size-4" />
    </button>
  );
}

/** Cross-fade two stacked pills so the outgoing message slides up & fades out as the new one slides up & fades in. */
function TryOnBusyMessageStack({ message }: { message: string | undefined }) {
  const [stack, setStack] = useState<{ current: string | undefined; prev: string | undefined }>({
    current: message,
    prev: undefined,
  });

  useEffect(() => {
    setStack((s) => (s.current === message ? s : { current: message, prev: s.current }));
  }, [message]);

  useEffect(() => {
    if (stack.prev === undefined) {
      return;
    }
    const t = setTimeout(() => {
      setStack((s) => ({ ...s, prev: undefined }));
    }, 500);
    return () => {
      clearTimeout(t);
    };
  }, [stack.prev, stack.current]);

  if (stack.current === undefined && stack.prev === undefined) {
    return null;
  }

  const pillClass = "sv:text-md sv:text-[#111111] sv:text-center sv:text-balance";

  return (
    <div
      aria-hidden
      className="sv:pointer-events-none sv:absolute sv:inset-x-2 sv:top-1/2 sv:-translate-y-1/2 sv:flex sv:justify-center sv:p-4"
    >
      <div className="sv:relative sv:grid sv:grid-cols-1 sv:place-items-center">
        {stack.prev !== undefined ? (
          <span
            key={`prev-${stack.prev}`}
            className={cn("sv-tryon-message--out sv:col-start-1 sv:row-start-1", pillClass)}
          >
            {stack.prev}
          </span>
        ) : null}
        {stack.current !== undefined ? (
          <span
            key={`cur-${stack.current}`}
            className={cn("sv-tryon-message sv:col-start-1 sv:row-start-1", pillClass)}
          >
            {stack.current}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Picks a random busy message and reshuffles it on an interval while `active`,
 * returning `undefined` when idle (or there are no messages). The first message
 * lands after a short delay so the spinner shows before any copy appears, and
 * each pick avoids repeating the previous index so the text visibly changes.
 */
function useRotatingTryOnBusyMessage(messages: string[], active: boolean): string | undefined {
  const [index, setIndex] = useState<number | undefined>();

  useEffect(() => {
    if (!active || messages.length === 0) {
      setIndex(undefined);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (cancelled) {
        return;
      }
      setIndex((prev) => {
        if (messages.length === 1) {
          return 0;
        }
        const next = Math.floor(Math.random() * messages.length);
        if (prev !== undefined && next === prev) {
          return (next + 1) % messages.length;
        }
        return next;
      });
      timer = setTimeout(tick, 2000 + Math.random() * 1000);
    };
    timer = setTimeout(tick, 1000);
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [active, messages]);

  return index === undefined ? undefined : messages[index];
}

/** The measurement fields the callouts read off a `FitCheck` (structural subset of the API type). */
interface FitPanelCheck {
  pointId: string;
  label: string;
  dimension: string;
  easeMm: number;
  easeNorm: number;
  idealShiftNorm: number;
  intentSigmaNorm: number;
  fit: string;
}

/** Localized strings the try-on screen needs — the `tryOnView` message block. */
type TryOnViewMessages = ReturnType<typeof useStudioVaaiUi>["messages"]["tryOnView"];

/**
 * The auto-generated intended-look phrase: one cut word from the dominant girth's band
 * position plus notable length traits, derived from `idealShiftNorm` — the intent's distance
 * from a regular-fit baseline in tolerance units, which is size-independent and reflects the
 * brand's calibrated targets when a fit model is on the chart. The girth thresholds sit midway
 * between the recommender's bucket positions (slim −1.25, regular 0, relaxed ~1.17, oversized
 * ~2.0); length traits only surface when the intent visibly leaves the default band
 * (|shift| ≥ 1, e.g. a sleeve deliberately styled past the wrist).
 */
function intendedLookChips(
  tv: TryOnViewMessages,
  checks: readonly FitPanelCheck[],
): string | undefined {
  const look = tv.intendedLook;
  const parts: string[] = [];
  const girth = checks.find((c) => !isLengthDimension(c.dimension));
  if (girth !== undefined) {
    const shift = girth.idealShiftNorm;
    if (shift <= -0.6) {
      parts.push(look.fitted);
    } else if (shift < 0.6) {
      parts.push(look.regular);
    } else if (shift < 1.6) {
      parts.push(look.relaxed);
    } else {
      parts.push(look.oversized);
    }
  }
  const sleeve = checks.find((c) => c.dimension === "sleeve_length");
  if (sleeve !== undefined && Math.abs(sleeve.idealShiftNorm) >= 1) {
    parts.push(sleeve.idealShiftNorm > 0 ? look.sleevesLong : look.sleevesShort);
  }
  const total = checks.find((c) => c.dimension === "total_length");
  if (total !== undefined && Math.abs(total.idealShiftNorm) >= 1) {
    parts.push(total.idealShiftNorm > 0 ? look.longline : look.cropped);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * The sentence the expanded fit-score card states after "Intended fit:" — the garment's
 * intended look, auto-derived from the chart's intent band positions. `undefined` when the chart
 * does not support it, in which case the card has nothing to expand into and renders as the
 * collapsed ribbon only.
 *
 * `idealShiftNorm` is identical across sizes, so any ranked entry's checks describe the intent.
 */
function intendedFitDescription(
  tv: TryOnViewMessages,
  data:
    | {
        recommendations: readonly { fitChecks: readonly FitPanelCheck[] }[];
      }
    | null
    | undefined,
): string | undefined {
  return intendedLookChips(tv, data?.recommendations[0]?.fitChecks ?? []);
}

/**
 * The leader-line anchor a dimension's callout uses. For paired anchors (both sleeves) pass the
 * callout's side so it attaches to the dot on THAT side — a short line that stays off the body
 * rather than crossing it. Without a side (row ordering, subject-bounds) it falls back to the most
 * lateral dot; either sleeve's height is the same, so ordering is unaffected.
 */
function calloutAnchorFor(
  anchors: readonly FitAnchor[],
  dimension: string,
  preferSide?: "left" | "right",
): FitAnchor | undefined {
  const candidates = anchors.filter((a) => a.dimension === dimension);
  if (candidates.length <= 1) {
    return candidates[0];
  }
  if (preferSide === "left") {
    return candidates.reduce((best, a) => (a.x < best.x ? a : best));
  }
  if (preferSide === "right") {
    return candidates.reduce((best, a) => (a.x > best.x ? a : best));
  }
  return candidates.reduce((best, a) => (Math.abs(a.x - 0.5) > Math.abs(best.x - 0.5) ? a : best));
}

/**
 * Order the callouts to match their dots top-to-bottom in the image. Two leader lines from
 * vertically-ordered dots to vertically-ordered cards can never cross, so this single sort
 * eliminates line crossings for any pose. Checks without an anchor keep their chart order,
 * after the anchored ones.
 */
function orderChecksByAnchor(
  checks: readonly FitPanelCheck[],
  anchors: readonly FitAnchor[] | undefined,
): readonly FitPanelCheck[] {
  if (anchors === undefined || anchors.length === 0) {
    return checks;
  }
  return checks
    .map((check, index) => ({
      check,
      index,
      y: calloutAnchorFor(anchors, check.dimension)?.y,
    }))
    .toSorted((a, b) => {
      if (a.y === undefined && b.y === undefined) {
        return a.index - b.index;
      }
      if (a.y === undefined) {
        return 1;
      }
      if (b.y === undefined) {
        return -1;
      }
      return a.y - b.y || a.index - b.index;
    })
    .map((entry) => entry.check);
}

// ── Floating callout cards ──────────────────────────────────────────────────────
const FLOAT_CARD_W = 124;
// De-collision estimate; the card sizes to its content. Kept in step with the padding and the
// two text rows below — too small and neighbouring cards are allowed to overlap.
const FLOAT_CARD_H = 54;
const FLOAT_EDGE_GAP = 8; // inset from the frame's left/right edge
const FLOAT_CARD_GAP = 10; // min vertical gap between stacked cards in a column
const FLOAT_VEDGE_GAP = 12; // inset from the frame's top/bottom edge (cards hug the extremes)

interface FloatingCard {
  dimension: string;
  label: string;
  verdict: string;
  color: string;
  /** Which frame edge the card is pinned to (CSS left/right — always fully on-screen). */
  side: "left" | "right";
  /** Card top, root coords. */
  cardY: number;
  /** Dot center, root coords. */
  dotX: number;
  dotY: number;
  /** Leader-line attach point on the card's inner edge (root coords). */
  lineX: number;
}

interface FloatingGeometry {
  width: number;
  height: number;
  cards: FloatingCard[];
}

/**
 * The image callouts: each anchored fit dimension becomes a small card floating over the hero —
 * the measurement name plus a verdict-colored dot and its one-word verdict — pinned to the
 * frame's left or right edge (whichever side of the subject the dot sits on) and joined to the
 * dot by a dashed leader line. Cards in a column are spread across the full frame height rather
 * than clustered beside their dots, so they sit clear of the subject in the middle and the
 * leader lines grow to reach in.
 *
 * Geometry is measured from live DOM rects relative to the screen root, and re-measured on
 * resize, scroll (capture — the panel column scrolls internally), and any input change. The hero
 * frame is aspect-fitted to the image and the carousel renders `fillFrame`, so normalized anchor
 * coordinates map linearly onto the frame box.
 */
function TryOnFitCallouts({
  tv,
  rootRef,
  frameRef,
  anchors,
  checks,
  visible,
}: {
  tv: TryOnViewMessages;
  rootRef: React.RefObject<HTMLDivElement | null>;
  frameRef: React.RefObject<HTMLDivElement | null>;
  anchors: readonly FitAnchor[];
  checks: readonly FitPanelCheck[];
  /** Cross-fades the whole layer. Kept mounted when false so geometry stays measured. */
  visible: boolean;
}) {
  const [geometry, setGeometry] = useState<FloatingGeometry | null>(null);
  // Callouts sit quiet (semi-transparent) so they don't fight the garment; hovering (desktop) or
  // tapping (mobile) a card brings its dot + leader line forward. Hover is transient; a tap pins it
  // until tapped again. `activeDim` is the pinned one, else the hovered one.
  const [hoveredDim, setHoveredDim] = useState<string | null>(null);
  const [pinnedDim, setPinnedDim] = useState<string | null>(null);
  const activeDim = pinnedDim ?? hoveredDim;

  const measure = useCallback(() => {
    const root = rootRef.current;
    const frame = frameRef.current;
    if (root === null || frame === null) {
      setGeometry(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const frameLeft = frameRect.left - rootRect.left;
    const frameTop = frameRect.top - rootRect.top;
    const frameBottom = frameTop + frameRect.height;

    // Estimate the subject's horizontal span from the anchor dots (they sit on the body): a card
    // goes to the frame edge on whichever side of the SUBJECT'S center its dot lies. Using the
    // subject center rather than the image center keeps a card on the correct (emptier) side when
    // the person stands off-center. Fall back to mid-frame when there are no usable anchors.
    const anchorXs: number[] = [];
    for (const check of checks) {
      const a = calloutAnchorFor(anchors, check.dimension);
      if (a !== undefined) {
        anchorXs.push(a.x);
      }
    }
    const subjectMinX = anchorXs.length > 0 ? Math.min(...anchorXs) : 0.5;
    const subjectMaxX = anchorXs.length > 0 ? Math.max(...anchorXs) : 0.5;
    const subjectCenterX = (subjectMinX + subjectMaxX) / 2;
    // The body reaches beyond the dots (shoulders/torso past the arm anchors), so pad the subject
    // span before measuring the empty gutter on each side. The gutters only STEER (a paired-dot
    // card prefers the airier side) — they never gate: on a narrow frame no side "fits", and
    // treating that as a reason not to place or balance is exactly what used to pile every card
    // onto one edge on top of the subject.
    const SUBJECT_HALO = 0.07;
    const leftGutterPx = (subjectMinX - SUBJECT_HALO) * frameRect.width - FLOAT_EDGE_GAP;
    const rightGutterPx = (1 - subjectMaxX - SUBJECT_HALO) * frameRect.width - FLOAT_EDGE_GAP;

    // Build the raw cards (dot position + side + desired vertical center). Horizontal placement
    // (`lineX`) is computed after the columns are balanced — each card parks NEXT TO its own dot.
    type Raw = FloatingCard & { desiredY: number; anchorX: number; anchorY: number };
    const raw: Raw[] = [];
    // Keep every card inside the image (frame) edges — with a clamp to the visible viewport band
    // as a safety net if the frame ever exceeds the small-screen viewport.
    const viewportW = globalThis.innerWidth || rootRect.width;
    const visLeft = Math.max(0, -rootRect.left) + FLOAT_EDGE_GAP;
    const visRight = Math.min(rootRect.width, viewportW - rootRect.left) - FLOAT_EDGE_GAP;
    const frameRight = frameLeft + frameRect.width;
    const leftEdge = Math.max(frameLeft + FLOAT_EDGE_GAP, visLeft);
    const rightEdge = Math.min(frameRight - FLOAT_EDGE_GAP, visRight);
    for (const check of checks) {
      const candidates = anchors.filter((a) => a.dimension === check.dimension);
      if (candidates.length === 0) {
        continue;
      }
      const isLength = isLengthDimension(check.dimension);
      const verdict =
        styledLengthVerdict(tv, check, isLength) ??
        fitVerdictPhrase(isLength ? tv.lengthVerdicts : tv.fitVerdicts, check.fit);
      let side: "left" | "right";
      let anchor: FitAnchor | undefined;
      if (candidates.length > 1) {
        // Two dots (both sleeves): put the card on the airier side and attach it to THAT side's
        // dot, so the leader line stays short and never crosses the body.
        side = leftGutterPx >= rightGutterPx ? "left" : "right";
        anchor = calloutAnchorFor(anchors, check.dimension, side);
      } else {
        // Single dot (chest/waist/length/inseam): the card sits on the dot's own side of the
        // subject — near-central dots effectively coin-flip here, and the balancing pass below
        // is what guarantees they spread across both columns.
        [anchor] = candidates;
        side = (anchor?.x ?? 0.5) < subjectCenterX ? "left" : "right";
      }
      if (anchor === undefined) {
        continue;
      }
      raw.push({
        dimension: check.dimension,
        label: check.label,
        verdict,
        color: fitCheckStyle(check.fit).dot,
        side,
        anchorX: anchor.x,
        anchorY: anchor.y,
        desiredY: frameTop + anchor.y * frameRect.height - FLOAT_CARD_H / 2,
        cardY: 0,
        dotX: frameLeft + anchor.x * frameRect.width,
        dotY: frameTop + anchor.y * frameRect.height,
        lineX: 0, // computed after balancing — each card parks beside its own dot
      });
    }

    // Balance the two columns UNCONDITIONALLY so cards can never pile onto one edge — a tall
    // single-side stack covers a vertical strip of the image (and the subject under it), which
    // is the one layout that never looks right, on any garment. While one side holds two+ more
    // cards than the other, move its card whose dot is nearest the subject center (the shortest
    // leader crossing) to the lighter side. Works for any anchor distribution: tops cluster
    // their dots around the chest, trousers around the hips/inseam — near-central dots are
    // exactly the ones this pass redistributes.
    const sideCount = (s: "left" | "right"): number => raw.filter((c) => c.side === s).length;
    let balanceGuard = raw.length;
    while (balanceGuard > 0) {
      balanceGuard -= 1;
      const heavy: "left" | "right" = sideCount("left") >= sideCount("right") ? "left" : "right";
      const light: "left" | "right" = heavy === "left" ? "right" : "left";
      if (sideCount(heavy) - sideCount(light) < 2) {
        break;
      }
      const [movable] = raw
        .filter((c) => c.side === heavy)
        .toSorted(
          (a, b) => Math.abs(a.anchorX - subjectCenterX) - Math.abs(b.anchorX - subjectCenterX),
        );
      if (movable === undefined) {
        break;
      }
      movable.side = light;
    }

    // Horizontal parking: pin every card to its column's FRAME EDGE — as far out of the
    // subject's way as the frame allows — and let the dashed leader bridge the distance to the
    // dot. Hugging the dots was tried and read as cards sitting ON the person; the edges keep
    // the render visible, and the reference pins its cards the same way.
    for (const c of raw) {
      c.lineX = c.side === "left" ? leftEdge + FLOAT_CARD_W : rightEdge - FLOAT_CARD_W;
    }

    // Park each card BESIDE its own anchor, so its leader line runs horizontally into the body —
    // the reference reads that way, and a horizontal rule is far easier to follow than a diagonal.
    // Cards are only pushed apart when they would actually overlap: walking a column in anchor
    // order and nudging each one below the previous keeps the vertical ordering (so lines still
    // cannot cross) while leaving well-separated anchors exactly where they belong.
    const cards: FloatingCard[] = [];
    const topY = frameTop + FLOAT_VEDGE_GAP;
    const bottomY = frameBottom - FLOAT_VEDGE_GAP - FLOAT_CARD_H;
    for (const side of ["left", "right"] as const) {
      const col = raw.filter((c) => c.side === side).toSorted((a, b) => a.anchorY - b.anchorY);
      let prevY = Number.NEGATIVE_INFINITY;
      for (const c of col) {
        const atAnchor = Math.min(Math.max(c.desiredY, topY), bottomY);
        c.cardY = Math.min(Math.max(atAnchor, prevY + FLOAT_CARD_H + FLOAT_CARD_GAP), bottomY);
        prevY = c.cardY;
        cards.push(c);
      }
    }
    setGeometry({ width: rootRect.width, height: rootRect.height, cards });
  }, [rootRef, frameRef, anchors, checks, tv]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const root = rootRef.current;
    const frame = frameRef.current;
    // Measure again here, not just in the layout effect above. `rootRef` belongs to this
    // component's PARENT, and React attaches a parent's refs only after its children's layout
    // effects have run — so the layout-effect pass always sees `rootRef.current === null` on
    // mount and parks the geometry at null. A browser papered over it (ResizeObserver invokes
    // its callback on `observe`), leaving the callouts a frame late; this makes it correct.
    measure();
    globalThis.addEventListener("resize", measure);
    globalThis.addEventListener("scroll", measure, true);
    const observer = new ResizeObserver(measure);
    if (root !== null) {
      observer.observe(root);
    }
    // The FRAME is what the dots are positioned against, and it can resize while the root does
    // not — the hero is aspect-locked and re-fits itself inside a root that keeps filling the
    // sheet body. Observing only the root left every dot and leader line at its previous
    // geometry, stranding the cards off the photo.
    if (frame !== null) {
      observer.observe(frame);
    }
    return () => {
      globalThis.removeEventListener("resize", measure);
      globalThis.removeEventListener("scroll", measure, true);
      observer.disconnect();
    };
  }, [measure, rootRef, frameRef]);

  if (geometry === null || geometry.cards.length === 0) {
    return null;
  }
  return (
    <div
      aria-hidden
      data-studio-vaai="try-on-fit-callouts"
      data-sv-visible={visible ? "" : undefined}
      // `inert` while hidden so the cards can't be hovered, tapped, or focused through a
      // zero-opacity layer — opacity alone leaves them clickable over the photo.
      inert={!visible}
      className={cn(
        "sv:pointer-events-none sv:absolute sv:inset-0 sv:z-20 sv:transition-opacity sv:duration-300 sv:ease-out",
        visible ? "sv:opacity-100" : "sv:opacity-0",
      )}
    >
      <svg
        className="sv:absolute sv:inset-0"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      >
        {geometry.cards.map((c) => {
          // Start the leader line where the ray from the card's center toward the dot exits the
          // card border — so the line looks like it emanates from the card and points at the dot
          // (a top card's line drops from its bottom edge, a bottom card's rises from its top, a
          // side dot leaves the inner edge). This is also the shortest connector, so it crosses the
          // least image. `t` is how far along that ray the border sits (dot is always outside, so
          // t ≤ 1); scaling the center→dot vector by t lands exactly on the edge.
          const centerX =
            c.side === "left" ? c.lineX - FLOAT_CARD_W / 2 : c.lineX + FLOAT_CARD_W / 2;
          const centerY = c.cardY + FLOAT_CARD_H / 2;
          const dx = c.dotX - centerX;
          const dy = c.dotY - centerY;
          const edgeRatio = Math.max(
            Math.abs(dx) / (FLOAT_CARD_W / 2),
            Math.abs(dy) / (FLOAT_CARD_H / 2),
            1,
          );
          const startX = centerX + dx / edgeRatio;
          const startY = centerY + dy / edgeRatio;
          const active = activeDim === c.dimension;
          return (
            <g
              key={c.dimension}
              // Quiet by default; the hovered/pinned callout fades to full opacity.
              style={{ opacity: active ? 1 : 0.6, transition: "opacity 260ms ease" }}
            >
              {/* White under-stroke (same dash phase) keeps the line legible over dark garments. */}
              <line
                x1={startX}
                y1={startY}
                x2={c.dotX}
                y2={c.dotY}
                stroke="rgba(255, 255, 255, 0.55)"
                strokeWidth={active ? 3.5 : 2.5}
                strokeDasharray="6 5"
                strokeLinecap="round"
                style={{ transition: "stroke-width 220ms ease" }}
              />
              <line
                x1={startX}
                y1={startY}
                x2={c.dotX}
                y2={c.dotY}
                stroke={active ? "rgba(17, 17, 17, 0.6)" : "rgba(17, 17, 17, 0.38)"}
                strokeWidth={1.25}
                // Longer dashes with a wider gap, matching the reference's sparse rule.
                strokeDasharray="6 5"
                strokeLinecap="round"
                style={{ transition: "stroke 220ms ease" }}
              />
              {/* No marker at the body end: the reference lets the dashes simply run out on the
                  garment. A dot there reads as a control the shopper could act on, and it sits
                  on the one part of the image they came to look at. */}
            </g>
          );
        })}
      </svg>
      {geometry.cards.map((c) => {
        const active = activeDim === c.dimension;
        return (
          // Decorative (the overlay is aria-hidden; the same verdicts are reachable through the
          // fit score), so it's a non-tabbable button — pointer only. Hover pronounces its
          // dot/line; tap pins/unpins.
          <button
            key={c.dimension}
            type="button"
            tabIndex={-1}
            data-studio-vaai="try-on-fit-callout-card"
            data-sv-fit-dimension={c.dimension}
            className="sv:pointer-events-auto sv:absolute sv:box-border sv:cursor-pointer sv:appearance-none sv:rounded-2xl sv:border-0 sv:bg-[var(--sv-color-bg)] sv:px-3.5 sv:py-2.5 sv:text-left sv:transition-[transform,box-shadow] sv:duration-200 sv:ease-out"
            style={{
              left: c.side === "left" ? c.lineX - FLOAT_CARD_W : c.lineX,
              top: c.cardY,
              width: FLOAT_CARD_W,
              transformOrigin: "center",
              transform: active ? "scale(1.03)" : "scale(1)",
              // Soft and wide rather than tight and dark — the card should sit on the photo,
              // not look stamped onto it.
              boxShadow: active
                ? "0 10px 28px rgba(0, 0, 0, 0.16)"
                : "0 4px 16px rgba(0, 0, 0, 0.10)",
            }}
            onPointerEnter={() => {
              setHoveredDim(c.dimension);
            }}
            onPointerLeave={() => {
              setHoveredDim(null);
            }}
            onClick={() => {
              setPinnedDim((p) => (p === c.dimension ? null : c.dimension));
            }}
          >
            <Text
              render={<span />}
              className="sv:block sv:truncate sv:text-[13px] sv:font-semibold sv:leading-tight sv:text-[var(--sv-color-foreground)]"
            >
              {c.label}
            </Text>
            <span className="sv:mt-1 sv:flex sv:items-center sv:gap-1.5">
              <span
                aria-hidden
                className="sv:size-1.5 sv:shrink-0 sv:rounded-full"
                style={{ backgroundColor: c.color }}
              />
              <span className="sv:truncate sv:text-[11px] sv:font-normal sv:leading-tight sv:text-[var(--sv-color-foreground-secondary)]">
                {c.verdict}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Traffic-light styling per fit verdict. */
function fitCheckStyle(fit: string): { dot: string; text: string } {
  switch (fit) {
    case "ideal": {
      return { dot: "var(--sv-color-fit-ideal)", text: "var(--sv-color-fit-ideal-foreground)" };
    }
    case "runs_tight":
    case "runs_loose": {
      return { dot: "var(--sv-color-fit-warn)", text: "var(--sv-color-fit-warn-foreground)" };
    }
    default: {
      // too_small / too_loose (and any future severe verdicts)
      return { dot: "var(--sv-color-fit-bad)", text: "var(--sv-color-fit-bad-foreground)" };
    }
  }
}

/** Length dimensions verdict as short/long, girths as tight/loose. */
function isLengthDimension(dimension: string): boolean {
  return dimension === "total_length" || dimension === "sleeve_length" || dimension === "inseam";
}

/**
 * A green length whose INTENT is deliberately shifted (the fit model demonstrates extra-long
 * sleeves / a cropped hem — band shift ≥ 1, the same threshold as the intended-look chips) can
 * visibly read long/short: the verdict then says it's by design instead of a bare
 * "as intended". `undefined` for every other row (the normal phrase applies).
 */
function styledLengthVerdict(
  tv: TryOnViewMessages,
  check: FitPanelCheck,
  isLength: boolean,
): string | undefined {
  if (!isLength || check.fit !== "ideal") {
    return undefined;
  }
  if (check.idealShiftNorm >= 1) {
    return tv.lengthStyledLong;
  }
  if (check.idealShiftNorm <= -1) {
    return tv.lengthStyledShort;
  }
  return undefined;
}

/** The localized verdict phrase for a server `fit` value. */
function fitVerdictPhrase(
  verdicts: {
    tooSmall: string;
    runsTight: string;
    ideal: string;
    runsLoose: string;
    tooLoose: string;
  },
  fit: string,
): string {
  switch (fit) {
    case "ideal": {
      return verdicts.ideal;
    }
    case "runs_tight": {
      return verdicts.runsTight;
    }
    case "runs_loose": {
      return verdicts.runsLoose;
    }
    case "too_loose": {
      return verdicts.tooLoose;
    }
    default: {
      return verdicts.tooSmall;
    }
  }
}
