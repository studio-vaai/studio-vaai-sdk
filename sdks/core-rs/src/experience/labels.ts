import type {
  ItemDisplay,
  SelectionView,
  Variant,
  VariantAxis,
  VariantId,
  VariantLabelFormat,
} from "../../build/wasm2/state_machine.js";
import type { VariantLabel } from "../../build/wasm2/studio_vaai_core.js";

import { ItemDisplay_Tags } from "../../build/wasm2/state_machine.js";
import {
  selectionLabelValue as projectSelectionLabel,
  variantLabelForForeignIds,
} from "../../build/wasm2/studio_vaai_core.js";

/** Host-localized text for any display kind, without assigning roles to axis keys. */
export function itemDisplayText(display: ItemDisplay): string {
  return display.tag === ItemDisplay_Tags.Text ? display.inner.text : display.inner.alt;
}

/** Current selection as a typed MF2 operand. Requires initializeCore(). */
export function selectionLabelValue(selection: SelectionView): VariantLabel {
  return projectSelectionLabel(selection.rows, selection.labelFormats);
}

/** A particular result's label, independent of selection. Requires initializeCore(). */
export function variantLabelValue(
  variantId: VariantId,
  variants: readonly Variant[],
  axes: readonly VariantAxis[],
  formats: readonly VariantLabelFormat[] = [],
): VariantLabel {
  const variant = variants.find((candidate) => candidate.id === variantId);
  // Standalone screens also accept storefront IDs that aren't backend UUIDs.
  return variantLabelForForeignIds(variant?.foreignIds, [...axes], [...formats]);
}
