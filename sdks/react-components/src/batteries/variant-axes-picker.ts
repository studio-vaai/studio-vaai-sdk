import type { RecommendedSizeData } from "@studio-vaai/js-client";
import type { TryOnFlowProduct } from "@studio-vaai/js-machine";
import type { ReactNode } from "react";

import {
  productVariantAxes,
  variantCombinationFor,
  variantOptionsForSize,
  variantValueAvailable,
} from "@studio-vaai/js-machine";

import type { VariantPickerAxis, VariantPickerOption } from "../ui/variant-picker.js";

/** The copy {@link splitSizeAxis} needs, structurally — both screens pass their `tv` bundle. */
export interface VariantAxesCopy {
  variantAxisLabel: (axisLabel: string, valueLabel: string) => ReactNode;
  recommendedChip: (sizeLabel: string) => ReactNode;
  variantUnavailableSr: string;
}

/**
 * The picker rows for a product's size axis. A product sold by size alone gets `[sizeAxis]`
 * back untouched — the same object, so its rendering cannot drift. A product sold along several
 * axes (waist × length) gets one row per axis instead, each headed `Waist: 27`, with:
 *
 * - the selected combination's value on that axis selected;
 * - every value whose combination with the OTHER axes' picks is not published marked
 *   `unavailable` (greyed, still tappable: the tap moves to the nearest published combination);
 * - the fit gate and sold-out flags of the combination a chip would select carried over;
 * - the recommendation ring and pill split per axis (`Recommended 32` on both rows);
 * - the size axis' note (gate / sold-out) on the first row, and `lengthHint` on the others.
 *
 * Selecting still goes through `sizeAxis.onSelect` with a combination's size slug, so the
 * screens' gate, sold-out and staging logic needs no second code path.
 */
export function splitSizeAxis(
  product: TryOnFlowProduct,
  sizeAxis: VariantPickerAxis,
  copy: VariantAxesCopy,
  lengthHint?: ReactNode,
): readonly VariantPickerAxis[] {
  const axes = productVariantAxes(product);
  if (axes === undefined) {
    return [sizeAxis];
  }
  const current = sizeAxis.selected;
  const currentOptions = variantOptionsForSize(product, current);
  const recommendedOptions =
    sizeAxis.recommended === undefined || sizeAxis.recommended.length === 0
      ? undefined
      : variantOptionsForSize(product, sizeAxis.recommended);
  const comboOptions = new Map(sizeAxis.options.map((option) => [option.value, option]));
  return axes.map((axis, index): VariantPickerAxis => {
    const options = axis.values.map((value): VariantPickerOption => {
      const available = variantValueAvailable(product, current, axis.key, value.slug);
      if (!available) {
        return {
          value: value.slug,
          label: value.label,
          unavailable: true,
          srLabel: `${value.label} (${copy.variantUnavailableSr})`,
        };
      }
      const combo = comboOptions.get(
        variantCombinationFor(product, current, axis.key, value.slug) ?? "",
      );
      return {
        value: value.slug,
        label: value.label,
        ...(combo?.gated === true ? { gated: true } : {}),
        ...(combo?.soldOut === true ? { soldOut: true } : {}),
      };
    });
    const selected = currentOptions?.[axis.key] ?? "";
    const selectedLabel = axis.values.find((value) => value.slug === selected)?.label ?? "";
    const recommended = recommendedOptions?.[axis.key];
    const recommendedLabel = axis.values.find((value) => value.slug === recommended)?.label;
    const first = index === 0;
    return {
      key: axis.key,
      label: selectedLabel === "" ? axis.label : copy.variantAxisLabel(axis.label, selectedLabel),
      options,
      selected,
      ...(recommended === undefined ? {} : { recommended }),
      ...(sizeAxis.recommendationLabel === undefined || recommendedLabel === undefined
        ? {}
        : { recommendationLabel: copy.recommendedChip(recommendedLabel) }),
      ...(first && sizeAxis.note !== undefined ? { note: sizeAxis.note } : {}),
      ...(!first && lengthHint !== undefined ? { hint: lengthHint } : {}),
      onSelect: (value: string) => {
        const slug = variantCombinationFor(product, current, axis.key, value);
        if (slug !== undefined) {
          sizeAxis.onSelect(slug);
        }
      },
    };
  });
}

/**
 * What the recommendation says about the recommended combination's length — the sentence of
 * its inseam check (where the hem lands) — on a product sold along several axes. `undefined`
 * when the product is sold by size alone, or the recommendation carries no length check.
 */
export function recommendedLengthHint(
  product: TryOnFlowProduct,
  recommendation: RecommendedSizeData | null | undefined,
  recommendedSlug: string,
): string | undefined {
  if (productVariantAxes(product) === undefined || recommendedSlug.length === 0) {
    return undefined;
  }
  const entry = recommendation?.recommendations.find((r) => r.size === recommendedSlug);
  const check = entry?.fitChecks.find((c) => c.dimension === "inseam");
  return check === undefined || check.sentence.length === 0 ? undefined : check.sentence;
}
