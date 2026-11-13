"use client";

import type { ReactNode } from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";
import { IconCheck, IconInfo } from "./icons.js";

/** One selectable value on a size axis. */
export interface VariantPickerOption {
  /** Stable identifier handed back to `onSelect`. */
  value: string;
  /** Chip text (e.g. "28"). */
  label: string;
  /**
   * The option exists but the try-on gate rejects it for this body — struck through and
   * muted, yet still selectable, because tapping it re-scores the fit panel and explains
   * why. Distinct from a value the product simply doesn't offer, which isn't listed at all.
   */
  gated?: boolean;
  /**
   * Out of stock. Rendered muted and non-selectable — unlike {@link gated}, which stays
   * selectable because inspecting a size the body can't wear is still informative.
   */
  soldOut?: boolean;
  /**
   * On a product sold along several axes: this value is not published together with the
   * other axes' current picks (a waist 27 that has no length 32). Greyed but still visible and
   * tappable, as on the brand's own storefront — the tap moves the other axes to the nearest
   * combination that exists. Never set on a single-axis product.
   */
  unavailable?: boolean;
  /** Screen-reader name; falls back to `label` (plus the recommended suffix). */
  srLabel?: string;
}

/**
 * One row of the picker: a labelled axis with its own recommendation and selection. The
 * reference draws jeans as two axes (Waist, Length); products with a single size list pass
 * one axis. Nothing here assumes a particular axis count.
 */
export interface VariantPickerAxis {
  /** Stable key (e.g. `"size"`), used for React keys and `data-sv-axis`. */
  key: string;
  /** Axis name shown before the recommendation pill (e.g. "Waist"). */
  label: ReactNode;
  options: readonly VariantPickerOption[];
  /** Currently inspected value. */
  selected: string;
  /** Value the recommender ranks first, ring-marked in the row. Empty when unranked. */
  recommended?: string;
  /** Pill copy next to the axis label, e.g. "Recommended 27". Omitted hides the pill. */
  recommendationLabel?: ReactNode;
  /**
   * Replaces {@link recommendationLabel} while something needs saying about the row — e.g.
   * "Size 31 is currently sold out." after the shopper taps an out-of-stock chip. The
   * recommendation pill is the steady state; this is the interruption, and showing both
   * would put two competing claims on one line.
   */
  note?: ReactNode;
  /**
   * A quiet line under the row's chips — e.g. why the recommended length is the one it is
   * ("Hem sits at the ankle bone at length 32"). Unlike {@link note} it never replaces the
   * recommendation pill.
   */
  hint?: ReactNode;
  onSelect: (value: string) => void;
}

export interface VariantPickerColorway {
  /** The shop's colorway id, handed back to `onSelectColorway`. */
  slug: string;
  label: string;
  hex: string;
  /** Ring the swatch so near-white colors stay visible against the card. */
  swatchRing?: boolean;
  /** Fabric/pattern image filling the swatch instead of the flat `hex` (stripes, prints). */
  imageUrl?: string;
}

export interface VariantPickerProps {
  axes: readonly VariantPickerAxis[];
  /** Colorways row. Omit (or pass an empty list) for products with no colorway axis. */
  colorways?: readonly VariantPickerColorway[];
  selectedColorway?: string;
  onSelectColorway?: (slug: string) => void;
  /** Row label for the colorways, e.g. "Color: Mid Blue". */
  colorwayLabel?: ReactNode;
  disabled?: boolean;
  className?: string;
}

function sizeChipClassName(
  selected: boolean,
  recommended: boolean,
  gated: boolean,
  soldOut: boolean,
  unavailable: boolean,
): string {
  if (selected) {
    return "sv:bg-[var(--sv-color-primary)] sv:font-semibold sv:text-[var(--sv-color-on-primary)]";
  }
  if (unavailable) {
    // Not offered with the other axis' pick: the chip keeps its place in the run but drops its
    // surface to a dashed outline, so it reads as "not in this combination" rather than as a
    // sold-out size (muted fill) or a fit refusal (struck through).
    return "sv:bg-transparent sv:font-normal sv:text-[var(--sv-color-muted-foreground)] sv:border sv:border-dashed sv:border-[var(--sv-color-border-strong)]";
  }
  if (soldOut) {
    // Quiet but not struck: the size exists and may come back, it just isn't buyable now.
    // The strike-through is reserved for the fit gate, which is a verdict about the body.
    return "sv:bg-[var(--sv-color-muted)] sv:font-normal sv:text-[var(--sv-color-muted-foreground)]";
  }
  if (gated) {
    // A muted chip surface, NOT bare text. Dropping the surface only read as "quietly refused"
    // while the card behind it was opaque; on the frosted card the chip lost its own background
    // too and a gated size became near-invisible against the render showing through. The
    // reference draws these as struck-through chips with a surface, not as floating text.
    return "sv:bg-[var(--sv-color-muted)] sv:font-normal sv:text-[var(--sv-color-muted-foreground)] sv:line-through";
  }
  if (recommended) {
    return "sv:bg-[var(--sv-color-bg)] sv:font-semibold sv:text-[var(--sv-color-foreground)] sv:ring-2 sv:ring-inset sv:ring-[var(--sv-color-recommendation-ring)]";
  }
  return "sv:bg-[var(--sv-color-bg)] sv:font-normal sv:text-[var(--sv-color-foreground)]";
}

/**
 * The one badge an axis header carries. A `note` pre-empts the recommendation pill (see
 * {@link VariantPickerAxis.note}) and is a live region, so a screen reader announces
 * "…is currently sold out" on the tap that produced it — the visual swap alone is silent.
 */
function AxisBadge({
  note,
  recommendationLabel,
}: {
  note?: ReactNode;
  recommendationLabel?: ReactNode;
}): ReactNode {
  if (note !== undefined) {
    return (
      <span
        role="status"
        // The gate note's stable hook, carried by whichever element ends up drawing it: the
        // reference puts a fit refusal in THIS pill, and only a size the shopper has not
        // selected falls through to the standalone line under the picker.
        data-studio-vaai="try-on-gate-note"
        className="sv:flex sv:min-w-0 sv:flex-1 sv:basis-full sv:items-start sv:gap-1 sv:rounded-[var(--sv-radius-control)] sv:bg-[var(--sv-color-muted)] sv:px-1.5 sv:py-0.5 sv:text-[12px] sv:font-normal sv:leading-tight sv:text-[var(--sv-color-foreground-secondary)] sv:sm:basis-auto"
      >
        <IconInfo aria-hidden className="sv:mt-px sv:size-3 sv:shrink-0 sv:self-start" />
        <span className="sv:min-w-0">{note}</span>
      </span>
    );
  }
  if (recommendationLabel !== undefined) {
    return (
      <span className="sv:min-w-0 sv:truncate sv:rounded-[var(--sv-radius-control)] sv:bg-[var(--sv-color-recommendation-surface)] sv:px-1.5 sv:py-0.5 sv:text-[12px] sv:font-medium sv:leading-tight sv:text-[var(--sv-color-recommendation-on-surface)]">
        {recommendationLabel}
      </span>
    );
  }
  return null;
}

/**
 * The "try another size or color" body: one chip row per size axis, each headed by its axis
 * name and a recommendation pill, followed by the color swatches.
 *
 * Chip rows scroll horizontally rather than wrapping — a jeans waist run is long, and a
 * rewrapping grid makes the recommended chip jump to a different line as the viewport
 * changes. `min-w-0` on the scroller is what actually lets it shrink inside the flex column.
 */
export function VariantPickerDefault({
  axes,
  colorways,
  selectedColorway,
  onSelectColorway,
  colorwayLabel,
  disabled = false,
  className,
}: VariantPickerProps) {
  return (
    <div
      data-studio-vaai="try-on-variant-picker"
      className={cn("sv:flex sv:min-w-0 sv:flex-col sv:gap-3", className)}
    >
      {axes.map((axis) => (
        <div key={axis.key} className="sv:flex sv:min-w-0 sv:flex-col sv:gap-1.5">
          {/* Wraps: the note is a whole sentence naming two sizes, and on a narrow sheet it does
              not fit beside the axis label. It used to sit on one non-wrapping line and get cut
              mid-word ("Our recommendatio…"), which is exactly the part the shopper needs. */}
          <span className="sv:flex sv:min-w-0 sv:flex-wrap sv:items-center sv:gap-x-1.5 sv:gap-y-1">
            <span className="sv:shrink-0 sv:text-[13px] sv:font-light sv:leading-tight sv:text-[var(--sv-color-foreground)]">
              {axis.label}
            </span>
            <AxisBadge
              {...(axis.note === undefined ? {} : { note: axis.note })}
              {...(axis.recommendationLabel === undefined
                ? {}
                : { recommendationLabel: axis.recommendationLabel })}
            />
          </span>
          <div
            role="group"
            data-sv-axis={axis.key}
            className="sv-scroll-x-hidden sv:-mx-0.5 sv:flex sv:min-w-0 sv:gap-1.5 sv:overflow-x-auto sv:px-0.5 sv:py-0.5"
          >
            {axis.options.map((option) => {
              const selected = option.value === axis.selected;
              const recommended = option.value === axis.recommended;
              const gated = option.gated === true;
              const soldOut = option.soldOut === true;
              const unavailable = option.unavailable === true;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  // A sold-out chip stays clickable so the tap can EXPLAIN itself (the axis note),
                  // but `aria-disabled` tells assistive tech it won't change the selection.
                  aria-disabled={soldOut || undefined}
                  aria-pressed={selected}
                  aria-label={option.srLabel ?? option.label}
                  data-sv-value={option.value}
                  data-sv-unavailable={unavailable || undefined}
                  onClick={() => {
                    axis.onSelect(option.value);
                  }}
                  className={cn(
                    "sv:inline-flex sv:h-11 sv:shrink-0 sv:cursor-pointer sv:appearance-none sv:items-center sv:justify-center sv:rounded-full sv:border-0 sv:font-sans sv:text-[14px] sv:leading-none sv:whitespace-nowrap sv:outline-none sv:transition-colors sv:focus-visible:ring-2 sv:focus-visible:ring-offset-1 sv:focus-visible:ring-[var(--sv-color-foreground)] sv:disabled:cursor-default sv:disabled:opacity-40",
                    option.label.length > 3 ? "sv:min-w-11 sv:px-3" : "sv:w-11",
                    sizeChipClassName(selected, recommended, gated, soldOut, unavailable),
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {axis.hint === undefined ? null : (
            <span
              data-studio-vaai="try-on-axis-hint"
              className="sv:min-w-0 sv:text-[12px] sv:font-light sv:leading-snug sv:text-[var(--sv-color-foreground-secondary)]"
            >
              {axis.hint}
            </span>
          )}
        </div>
      ))}
      {colorways === undefined || colorways.length === 0 ? null : (
        <div className="sv:flex sv:min-w-0 sv:flex-col sv:gap-1.5">
          {colorwayLabel === undefined ? null : (
            <span className="sv:min-w-0 sv:truncate sv:text-[13px] sv:font-light sv:leading-tight sv:text-[var(--sv-color-foreground)]">
              {colorwayLabel}
            </span>
          )}
          <div
            role="group"
            data-sv-axis="colorway"
            className="sv-scroll-x-hidden sv:-mx-0.5 sv:flex sv:min-w-0 sv:gap-2.5 sv:overflow-x-auto sv:px-0.5 sv:py-0.5"
          >
            {colorways.map((color) => {
              const selected = color.slug === selectedColorway;
              const hasImage = color.imageUrl !== undefined && color.imageUrl.length > 0;
              return (
                <button
                  key={color.slug}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  aria-label={color.label}
                  data-sv-value={color.slug}
                  onClick={() => {
                    onSelectColorway?.(color.slug);
                  }}
                  // Selected, the button paints the GAP color and the ring sits inset at its
                  // edge — the swatch never grows past its layout box, so the row stays
                  // aligned with the size chips and the labels above it (an outset outline
                  // jutted 4px left of the column and read as misalignment).
                  style={{ backgroundColor: selected ? "var(--sv-color-bg)" : color.hex }}
                  className={cn(
                    "sv:relative sv:inline-flex sv:size-11 sv:shrink-0 sv:cursor-pointer sv:appearance-none sv:items-center sv:justify-center sv:overflow-hidden sv:rounded-full sv:border-0 sv:p-0 sv:outline-none sv:focus-visible:ring-2 sv:focus-visible:ring-offset-1 sv:focus-visible:ring-[var(--sv-color-foreground)] sv:disabled:cursor-default sv:disabled:opacity-40",
                    color.swatchRing === true &&
                      !selected &&
                      "sv:ring-1 sv:ring-inset sv:ring-[var(--sv-color-border-strong)]",
                    // The selection ring: 2px primary at the edge, then a 2px gap (the button's
                    // bg) around the shrunken disc — an outline that works over any fabric
                    // image, without overflowing the layout.
                    selected && "sv:ring-2 sv:ring-inset sv:ring-[var(--sv-color-primary)]",
                  )}
                >
                  {/* The color disc: full-bleed at rest, inset behind the ring+gap when
                      selected. Carries the hex as backdrop for image swatches — it paints
                      while the fabric shot loads and if it 404s. */}
                  <span
                    aria-hidden
                    style={{ backgroundColor: color.hex }}
                    className={cn(
                      "sv:absolute sv:overflow-hidden sv:rounded-full",
                      selected ? "sv:inset-1" : "sv:inset-0",
                    )}
                  >
                    {hasImage ? (
                      <img
                        src={color.imageUrl}
                        alt=""
                        draggable={false}
                        className="sv:absolute sv:inset-0 sv:h-full sv:w-full sv:select-none sv:object-cover"
                      />
                    ) : null}
                  </span>
                  {selected && !hasImage ? (
                    // Tick color follows the swatch's own luminance so it stays legible on
                    // both a near-black and a near-white swatch. Image swatches skip it —
                    // the ring is the selection signal there, and a tick over a busy
                    // fabric shot is illegible anyway.
                    <IconCheck
                      className={cn(
                        "sv:relative sv:size-3.5",
                        isLightHex(color.hex) ? "sv:text-black/80" : "sv:text-white",
                      )}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Relative luminance of a `#rgb` / `#rrggbb` swatch, thresholded for tick contrast.
 * Unparseable values are treated as light, which yields the darker tick — the safer
 * default against the light card these swatches sit on.
 */
function isLightHex(hex: string): boolean {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (full.length !== 6) {
    return true;
  }
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return true;
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export function VariantPicker(props: VariantPickerProps) {
  const Comp = useStudioVaaiUiComponent("VariantPicker", VariantPickerDefault);
  return <Comp {...props} />;
}
