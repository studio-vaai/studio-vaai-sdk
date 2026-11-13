"use client";

import { STYLE_ATTRIBUTE_KEY, type TryOnProductStyleOption } from "@studio-vaai/js-machine";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";
import { IconStyleButtonedDown, IconStyleButtonedUp } from "./icons.js";

/**
 * The picture of one style: the SDK's own glyph when the option names one, the host's icon
 * URL otherwise, nothing for a text-only style. Drawn beside the label in the toggle, and
 * exported so a host chip can draw a style the same way the SDK does.
 */
export function StyleOptionGlyph({
  style,
  className,
}: {
  style: TryOnProductStyleOption;
  className?: string;
}) {
  if (style.glyph === "buttoned-up") {
    return <IconStyleButtonedUp aria-hidden className={className} />;
  }
  if (style.glyph === "buttoned-down") {
    return <IconStyleButtonedDown aria-hidden className={className} />;
  }
  if (style.iconUrl !== undefined && style.iconUrl.length > 0) {
    return (
      <img
        aria-hidden
        alt=""
        src={style.iconUrl}
        draggable={false}
        className={cn("sv:select-none sv:object-contain", className)}
      />
    );
  }
  return null;
}

export interface StyleToggleProps {
  /** The product's styles, in display order (`product.attributeMetadata.styles`). */
  styles: readonly TryOnProductStyleOption[];
  /** Slug of the selected style; `undefined` presses nothing. */
  selected: string | undefined;
  onSelect: (slug: string) => void;
  /** Accessible name of the group ("Style"). */
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A segmented control over a garment's styles — one light pill, one segment per style, each
 * with its glyph and label. Unlike the size/color picker this is never staged: every style of
 * the picked size and colour is rendered together, so flipping between them is instant and a
 * commit step would only add a tap.
 *
 * It sits at the right end of the tried-variant pill row under the try-on photo, so its
 * geometry is that row's: the pills are `border + py-1 + a 20px swatch` = 30px tall, and the
 * group here is a 1px rim (`p-px`, the pill's border width) around 28px (`h-7`) segments —
 * change one and change the other. The selected segment is outlined (an inset ring on the
 * surface colour), not filled, so it reads as the chosen one of two options rather than as a
 * button.
 */
export function StyleToggleDefault({
  styles,
  selected,
  onSelect,
  label,
  disabled = false,
  className,
}: StyleToggleProps) {
  return (
    <div
      role="group"
      aria-label={label}
      data-sv-axis={STYLE_ATTRIBUTE_KEY}
      className={cn(
        // The frosted surface of the tried-variant pills: fill and blur together decide how
        // much of the render reads through, so both travel with the pill.
        "sv:inline-flex sv:max-w-full sv:shrink-0 sv:items-center sv:rounded-full sv:bg-[var(--sv-color-overlay-card)] sv:p-px sv:backdrop-blur-sm sv:backdrop-saturate-150",
        className,
      )}
    >
      {styles.map((style) => {
        const pressed = style.slug === selected;
        return (
          <button
            key={style.slug}
            type="button"
            disabled={disabled}
            aria-pressed={pressed}
            data-sv-value={style.slug}
            onClick={() => {
              onSelect(style.slug);
            }}
            className={cn(
              "sv:inline-flex sv:h-7 sv:min-w-0 sv:cursor-pointer sv:appearance-none sv:items-center sv:gap-1.5 sv:rounded-full sv:border-0 sv:pl-2 sv:pr-2.5 sv:font-sans sv:text-[13px] sv:leading-none sv:outline-none sv:transition-colors sv:focus-visible:ring-2 sv:focus-visible:ring-[var(--sv-color-foreground)] sv:disabled:cursor-default sv:disabled:opacity-40",
              // Selected paints like the selected tried-variant pill beside it — surface fill,
              // foreground outline — so the row agrees on what "chosen" looks like; the rest
              // sit transparent on the pill's glass in secondary text.
              pressed
                ? "sv:bg-[var(--sv-color-bg)] sv:font-medium sv:text-[var(--sv-color-foreground)] sv:ring-1 sv:ring-inset sv:ring-[var(--sv-color-foreground)]"
                : "sv:bg-transparent sv:font-normal sv:text-[var(--sv-color-foreground-secondary)]",
            )}
          >
            <StyleOptionGlyph style={style} className="sv:size-4 sv:shrink-0" />
            <span className="sv:truncate">{style.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function StyleToggle(props: StyleToggleProps) {
  const Comp = useStudioVaaiUiComponent("StyleToggle", StyleToggleDefault);
  return <Comp {...props} />;
}
