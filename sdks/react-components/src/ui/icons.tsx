"use client";

import type { SVGProps } from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";

export function IconBackDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 6 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M6 12l-6-6 6-6" />
    </svg>
  );
}

export function IconBack(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconBack", IconBackDefault);
  return <Comp {...props} />;
}

export function IconChevronRightDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 6 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M0 12l6-6-6-6" />
    </svg>
  );
}

export function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconChevronRight", IconChevronRightDefault);
  return <Comp {...props} />;
}

// Carousel-specific chevrons. Compared to `IconBack` / `IconChevronRight`, the chevron
// path occupies a smaller central region of the viewBox (3×6 in 6×10, with padding
// around) so it reads as a subtle "next/prev" hint rather than a full-height "back"
// affordance. Chevron aspect ≈ 0.5 (width:height), matching the proportions of
// typical photo-gallery chevrons (e.g. COS/Apple-style elevated-chevron sprites).
export function IconCarouselArrowLeftDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 6 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M5 8L2 5l3-3" />
    </svg>
  );
}

export function IconCarouselArrowLeft(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconCarouselArrowLeft", IconCarouselArrowLeftDefault);
  return <Comp {...props} />;
}

export function IconCarouselArrowRightDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 6 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M2 8l3-3-3-3" />
    </svg>
  );
}

export function IconCarouselArrowRight(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconCarouselArrowRight", IconCarouselArrowRightDefault);
  return <Comp {...props} />;
}

/**
 * Disclosure chevron, pointing down. Collapsible sections rotate it 180° when open
 * rather than swapping in a second glyph, so the flip animates.
 */
export function IconChevronDownDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 12 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M0 0l6 6 6-6" />
    </svg>
  );
}

export function IconChevronDown(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconChevronDown", IconChevronDownDefault);
  return <Comp {...props} />;
}

/** Tick used inside a selected color swatch. */
export function IconCheckDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 14 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M1 5.5L5 9.5 13 1.5" />
    </svg>
  );
}

export function IconCheck(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconCheck", IconCheckDefault);
  return <Comp {...props} />;
}

/** Circular arrow — the retry affordance on the unavailable fit-score bar. */
/** Tray-with-arrow download glyph, matching the reference's corner control. */
export function IconDownloadDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M12 3v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 17.5V19a2 2 0 002 2h12a2 2 0 002-2v-1.5" />
    </svg>
  );
}

export function IconDownload(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconDownload", IconDownloadDefault);
  return <Comp {...props} />;
}

export function IconRetryDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M20 11a8 8 0 10-2.3 5.7" />
      <path d="M20 4.5V11h-6.5" />
    </svg>
  );
}

export function IconRetry(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconRetry", IconRetryDefault);
  return <Comp {...props} />;
}

/** "Only you see it" — the privacy-facts eye row on the intro screen. */
export function IconEyeDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  );
}

export function IconEye(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconEye", IconEyeDefault);
  return <Comp {...props} />;
}

/** "Deleted right after" — the privacy-facts bin row on the intro screen. */
export function IconTrashDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M3.5 6h17" />
      <path d="M9 6V4.5A1.5 1.5 0 0110.5 3h3A1.5 1.5 0 0115 4.5V6" />
      <path d="M5.5 6l1 13a2 2 0 002 2h7a2 2 0 002-2l1-13" />
      <path d="M10 10.5v6.5M14 10.5v6.5" />
    </svg>
  );
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconTrash", IconTrashDefault);
  return <Comp {...props} />;
}

export function IconCloseDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M12 0L0 12M0 0l12 12" />
    </svg>
  );
}

export function IconClose(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconClose", IconCloseDefault);
  return <Comp {...props} />;
}

export function IconCameraDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export function IconCamera(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconCamera", IconCameraDefault);
  return <Comp {...props} />;
}

export function IconAlertCircleDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <circle cx="12" cy="12" r="10" fill="none" />
      <path d="M12 8v5" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconAlertCircle(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconAlertCircle", IconAlertCircleDefault);
  return <Comp {...props} />;
}

export function IconImageDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

export function IconImage(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconImage", IconImageDefault);
  return <Comp {...props} />;
}

export function IconInfoDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <circle cx="12" cy="12" r="10" fill="none" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <path d="M12 11v6" />
    </svg>
  );
}

export function IconInfo(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconInfo", IconInfoDefault);
  return <Comp {...props} />;
}

export function IconSwitchCameraDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {/* Camera body + lens (re-uses the `IconCamera` body path at a thinner stroke). */}
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      {/* Inner reverse arrows indicating "swap" */}
      <path d="M9 14h6" />
      <path d="M11 12l-2 2 2 2" />
      <path d="M13 16l2-2-2-2" />
    </svg>
  );
}

export function IconSwitchCamera(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconSwitchCamera", IconSwitchCameraDefault);
  return <Comp {...props} />;
}

/**
 * A blazer worn closed: the lapels meet at a single front seam with the buttons on it.
 * One of the two built-in style glyphs (see `TryOnProductStyleOption.glyph`); drawn in
 * `currentColor` at the icon set's 1.5 stroke so it sits beside the other controls.
 */
export function IconStyleButtonedUpDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {/* Body silhouette */}
      <path d="M8 4 5 6 3.5 20.5h17L19 6l-3-2" />
      {/* Lapels meeting at the closed front */}
      <path d="M8 4l4 6 4-6" />
      <path d="M12 10v10.5" />
      <circle cx="12" cy="12.6" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="16.2" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconStyleButtonedUp(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconStyleButtonedUp", IconStyleButtonedUpDefault);
  return <Comp {...props} />;
}

/**
 * A blazer worn open: the two fronts fall apart from the collar and the buttons sit on the
 * right front. The counterpart of {@link IconStyleButtonedUpDefault}.
 */
export function IconStyleButtonedDownDefault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {/* Body silhouette */}
      <path d="M8 4 5 6 3.5 20.5h17L19 6l-3-2" />
      {/* The two open fronts */}
      <path d="M8 4c.6 5.5 1.4 11 2.6 16.5" />
      <path d="M16 4c-.6 5.5-1.4 11-2.6 16.5" />
      {/* Collar notch */}
      <path d="M8 4l2.4 3.6L12 4.3 13.6 7.6 16 4" />
      <circle cx="14.6" cy="12.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.1" cy="16" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconStyleButtonedDown(props: SVGProps<SVGSVGElement>) {
  const Comp = useStudioVaaiUiComponent("IconStyleButtonedDown", IconStyleButtonedDownDefault);
  return <Comp {...props} />;
}
