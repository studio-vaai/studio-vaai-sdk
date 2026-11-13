import type { TryOnFlowProduct, VariantAttributes } from "@studio-vaai/js-machine";

import { useEffect, useRef } from "react";

import { defaultStudioVaai } from "./default-studio-vaai.js";

export interface UseStudioVaaiExternalSelectionArgs {
  product: TryOnFlowProduct;
  /**
   * Currently picked attributes (e.g. `{ colorway, size }`). Partial maps are fine — the
   * SDK derives variant resolution internally and gates try-on on a full match.
   */
  selection: VariantAttributes;
  /**
   * Whether `selection.size` is only the page's default (the shopper has not picked a size).
   * Pass it when one actor serves several product pages, so each page's own value reaches the
   * flow; a change to it alone pushes too. Omitted, a push counts as the shopper's pick.
   */
  selectedSizeIsDefault?: boolean;
}

/**
 * Sync host-owned attribute selection (e.g. PDP URL params) into the running default-root actor.
 * Dispatches `PRODUCT_CHANGED` whenever the supplied `product` / `selection` diverges from what
 * this hook last pushed.
 *
 * Tracks "what the host last pushed" — not "current SDK state" — so user-driven changes inside the
 * modal aren't clobbered by re-renders. Re-pushes only on host input changes.
 *
 * It deliberately does NOT wait for the actor to be on the `product` screen. The actor outlives
 * the sheet (it is keyed by product, so try-on history survives closing), so after a try-on it
 * sits on the RESULT screen — and that is exactly the state it is in while the shopper is back on
 * the page changing the size. Gating on the product screen dropped those pushes, so re-opening the
 * sheet resumed the last try-on's size and silently ignored the size the shop was showing.
 *
 * Re-render clobbering is already prevented by the last-pushed ref: a push happens only when the
 * HOST's own input changes, never merely because the SDK's state moved.
 *
 * For the default flow only (relies on the {@link defaultStudioVaai} actor context).
 */
export function useStudioVaaiExternalSelection({
  product,
  selection,
  selectedSizeIsDefault,
}: UseStudioVaaiExternalSelectionArgs): void {
  const { state, dispatch } = defaultStudioVaai.useStudioVaaiActor();

  const lastPushedRef = useRef({
    productId: state.context.product.id,
    selection: state.context.selection,
    selectedSizeIsDefault: state.context.sizeIsDefaultSelection,
  });

  useEffect(() => {
    const prev = lastPushedRef.current;
    const flagChanged =
      selectedSizeIsDefault !== undefined && selectedSizeIsDefault !== prev.selectedSizeIsDefault;
    if (
      prev.productId === product.id &&
      attributesEqual(prev.selection, selection) &&
      !flagChanged
    ) {
      return;
    }
    lastPushedRef.current = {
      productId: product.id,
      selection,
      selectedSizeIsDefault: selectedSizeIsDefault ?? prev.selectedSizeIsDefault,
    };
    dispatch({
      type: "PRODUCT_CHANGED",
      product,
      selection,
      ...(selectedSizeIsDefault === undefined ? {} : { selectedSizeIsDefault }),
    });
  }, [dispatch, product, selection, selectedSizeIsDefault]);
}

function attributesEqual(a: VariantAttributes, b: VariantAttributes): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  return aKeys.every((k) => a[k] === b[k]);
}
