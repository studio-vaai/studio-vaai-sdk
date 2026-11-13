"use client";

import { useLayoutEffect, useRef, useState, type ImgHTMLAttributes } from "react";

import guideGraphicDePortraitUrl from "../assets/guide-graphic-annotated-de-portrait.svg?url";
import guideGraphicDeUrl from "../assets/guide-graphic-annotated-de.svg?url";
import guideGraphicEnPortraitUrl from "../assets/guide-graphic-annotated-en-portrait.svg?url";
import guideGraphicEnUrl from "../assets/guide-graphic-annotated-en.svg?url";
import { languageOfTag } from "../i18n/messages.js";
import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { cn } from "./cn.js";

/**
 * The intro screen's "how to shoot your photo" figure: the duo photograph with the
 * design's annotations (pose/clothing labels, the head-to-toe measure arrow) baked in.
 *
 * The artwork is a per-locale EXPORT of the design frame rather than markup composed at
 * runtime — pixel-identical alignment to the reference beats runtime-localizable labels
 * here, so each shipped language has its own annotated file and the language of
 * `messages.locale` picks one (`de-AT` gets the German art; other languages fall back to English).
 *
 * **Re-exporting these: recompress the embedded photo first.** The frame exports as SVG with
 * the photograph inlined as a base64 PNG, which lands at ~1.9 MB per locale — six times the
 * raster it replaced, on the flow's first screen. Re-encoding that one data URI as WebP
 * (quality 92, alpha preserved — the models are a cutout) takes each file to ~170 KB with no
 * visible change: a pixel diff against the original maxed out at 10/255 over 19 pixels. The
 * annotations stay vector either way, which is why these beat the PNGs they replaced on both
 * weight and sharpness.
 */
const GUIDE_ART_BY_LOCALE: Record<string, string> = {
  de: guideGraphicDeUrl,
  en: guideGraphicEnUrl,
};

/**
 * The same frame recomposed portrait: the "head to toe" caption sits above the arrow instead of
 * beside it, and the frame is cropped just below the feet. Photo, arrow and labels are otherwise
 * untouched (the embedded photo is byte-identical), so re-export both variants together.
 */
const GUIDE_ART_PORTRAIT_BY_LOCALE: Record<string, string> = {
  de: guideGraphicDePortraitUrl,
  en: guideGraphicEnPortraitUrl,
};

/** `viewBox` sizes of the two frames. The models are drawn at the same scale in both. */
const LANDSCAPE_FRAME = { width: 569, height: 600 } as const;
const PORTRAIT_FRAME = { width: 444, height: 620 } as const;

/**
 * Whether the portrait frame draws the models larger than the landscape one in a `width` x
 * `height` box under `object-contain`.
 *
 * The landscape frame is nearly square, so in a column much taller than it is wide (the modal's
 * picture column on a tall viewport) it is width-bound and leaves a band of white above the
 * models' heads. In a box at or wider than its own aspect (the sheet's `569/600` wrapper, a
 * short viewport) it is the larger of the two, so it stays the default there, and on a tie.
 */
export function prefersPortraitGuideArt(width: number, height: number): boolean {
  const scale = (frame: { width: number; height: number }) =>
    Math.min(width / frame.width, height / frame.height);
  return scale(PORTRAIT_FRAME) > scale(LANDSCAPE_FRAME);
}

export type GuideGraphicProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">;

export function GuideGraphicDefault({ className, ...rest }: GuideGraphicProps) {
  const { messages } = useStudioVaaiUi();
  const ref = useRef<HTMLImageElement>(null);
  // Picked from the box the layout hands the image, not from the viewport, so each layout gets
  // whichever frame fills it: measured before paint, so only the chosen file is fetched and
  // there is no swap on screen. `null` until then keeps the `src` off the first commit.
  const [portrait, setPortrait] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setPortrait(prefersPortraitGuideArt(width, height));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const artByLocale = portrait === true ? GUIDE_ART_PORTRAIT_BY_LOCALE : GUIDE_ART_BY_LOCALE;
  const fallback = portrait === true ? guideGraphicEnPortraitUrl : guideGraphicEnUrl;
  const src =
    portrait === null ? undefined : (artByLocale[languageOfTag(messages.locale)] ?? fallback);
  return (
    <img
      ref={ref}
      src={src}
      // Decorative — the intro copy above it carries the instructions; callers additionally
      // pass `aria-hidden`.
      alt=""
      draggable={false}
      // `object-contain` letterboxes inside whatever box the layout hands it (the sheet gives
      // it the leftover body height, the modal a column), mirroring the artwork's
      // `preserveAspectRatio="xMidYMid meet"` so it is centred and undistorted at any size.
      className={cn("sv:block sv:object-contain sv:pointer-events-none sv:select-none", className)}
      {...rest}
    />
  );
}

export function GuideGraphic(props: GuideGraphicProps) {
  const Comp = useStudioVaaiUiComponent("GuideGraphic", GuideGraphicDefault);
  return <Comp {...props} />;
}
