import type { BodyRevision, TryOn } from "@studio-vaai/core";

import {
  AxisPlacement,
  AxisRole,
  Capability,
  DisplayedImage,
  ItemDisplay,
  PresentationMode,
  PrimaryTryOnAction,
  selectionLabelValue,
  triedPickerItems,
  variantLabelValue,
} from "@studio-vaai/core";

import type { SvTryOnViewScreenProps } from "./types.js";

interface PrimaryAction {
  label: "tryOn" | "retry" | "wearing";
  action?: "try-on" | "retry";
  variantId?: string;
}

function primaryAction(
  props: SvTryOnViewScreenProps,
  shown: TryOn | undefined,
  selecting: boolean,
  bodyRevision: BodyRevision | null | undefined,
): PrimaryAction {
  const next = props.presentation?.primaryAction;
  if (next !== undefined) {
    if (PrimaryTryOnAction.Try.instanceOf(next)) {
      return { label: "tryOn", action: "try-on", variantId: next.inner.variantId };
    }
    if (PrimaryTryOnAction.Retry.instanceOf(next)) {
      return { label: "retry", action: "retry", variantId: next.inner.variantId };
    }
    return { label: PrimaryTryOnAction.AlreadyWearing.instanceOf(next) ? "wearing" : "tryOn" };
  }
  const { presentation, selection } = props;
  if (
    !selecting &&
    shown !== undefined &&
    shown.key.variantId === selection?.variantId &&
    shown.key.bodyRevision === bodyRevision
  ) {
    return { label: "wearing" };
  }
  const variantId =
    presentation !== undefined && Capability.Available.instanceOf(presentation.canRequestTryOn)
      ? selection?.variantId
      : undefined;
  const retry =
    props.state === "error" &&
    (props.navigation === undefined ||
      (props.retryVariantId !== undefined && props.retryVariantId === variantId));
  return {
    label: retry && props.navigation !== undefined ? "retry" : "tryOn",
    ...(variantId === undefined ? {} : { action: retry ? "retry" : "try-on", variantId }),
  };
}

/** Joins experience references to immutable domain records without resolving a new selection. */
export function tryOnView(props: SvTryOnViewScreenProps, coreReady: boolean) {
  const { selection, presentation, product } = props;
  const results = (presentation?.tryOns ?? []).flatMap((id) => {
    const result = props.tryOns?.find((item) => item.id === id);
    return result === undefined ? [] : [result];
  });
  const displayed = presentation?.displayed;
  const shown =
    displayed !== undefined && DisplayedImage.TryOn.instanceOf(displayed)
      ? results.find((result) => result.id === displayed.inner.tryOnId)
      : undefined;
  const selecting = shown === undefined || presentation?.mode === PresentationMode.Selection;
  const pickerOpen = selecting || presentation?.mode === PresentationMode.EditingVariant;
  const variants = product?.variants ?? [];
  const rows = selection?.rows ?? [];
  const formats = selection?.labelFormats;
  const historyRows = rows.filter(
    (row) => row.displayOptions?.placement !== AxisPlacement.ResultToolbar,
  );
  const historyFormats =
    historyRows.length === rows.length
      ? formats
      : formats?.filter(
          (format) =>
            format.role !== undefined && historyRows.some((row) => row.role === format.role),
        );
  const sizeRows = rows.filter((row) => row.role === AxisRole.Size);
  const colorRows = rows.filter((row) => row.role === AxisRole.Color);
  const bodyRevision =
    props.bodyRevision === undefined
      ? (shown?.key.bodyRevision ?? props.tryOns?.at(-1)?.key.bodyRevision)
      : props.bodyRevision;
  let tried = presentation?.triedItems;
  if (coreReady && tried === undefined && selection !== undefined) {
    // Standalone screens can receive domain records without a flow projection.
    const triedIds = new Set(
      props.tryOns
        ?.filter(({ key }) => key.bodyRevision === bodyRevision)
        .map(({ key }) => key.variantId),
    );
    if (triedIds.size > 0) {
      tried = triedPickerItems(
        new Map(rows.flatMap(({ key, role }) => (role === undefined ? [] : [[key, role]]))),
        variants.find(({ id }) => id === selection.variantId)?.foreignIds,
        variants.filter(({ id }) => triedIds.has(id)).map(({ foreignIds }) => foreignIds),
      );
    }
  }
  const triedItems =
    tried !== undefined && tried.size > 0
      ? new Map([...tried].map(([axis, items]) => [axis, new Set(items)]))
      : undefined;
  const recommendedId = selection?.recommendedVariantId;
  const shownVariantId = shown?.key.variantId;
  const shownCommerce = shownVariantId === undefined ? undefined : props.commerce?.[shownVariantId];
  let imageSrc = props.photoSrc;
  if (shown !== undefined) {
    imageSrc =
      props.resultImageSrc === undefined ? shown.imageUrl : (props.resultImageSrc ?? undefined);
  }
  const labelFor = (id: string, labelRows = rows, labelFormats = formats) =>
    coreReady
      ? variantLabelValue(id, variants, labelRows, labelFormats)
      : { axes: [], formats: [] };
  return {
    results,
    shown,
    selecting,
    pickerOpen,
    fit: shown !== undefined && props.fit?.tryOnId === shown.id ? props.fit : undefined,
    labelFor,
    historyLabelValue: (variantId: string) => labelFor(variantId, historyRows, historyFormats),
    historyOptions: (variantId: string) =>
      labelFor(
        variantId,
        rows.filter((row) => row.displayOptions?.placement === AxisPlacement.ResultToolbar),
        [],
      ),
    historySwatch: (variantId: string) => {
      const variant = variants.find((item) => item.id === variantId);
      for (const row of colorRows) {
        const item = row.items.find(
          (candidate) => candidate.key === variant?.foreignIds.get(row.key),
        );
        if (item !== undefined && ItemDisplay.Color.instanceOf(item.display)) {
          return { color: item.display.inner.hex, image: undefined };
        }
        if (item !== undefined && ItemDisplay.Image.instanceOf(item.display)) {
          return { color: undefined, image: item.display.inner.url };
        }
      }
      return { color: undefined, image: undefined };
    },
    pickerSelection: selection,
    triedItems,
    recommendedSize:
      recommendedId === undefined || props.commerce?.[recommendedId]?.inStock === false
        ? undefined
        : labelFor(recommendedId, sizeRows),
    primary: primaryAction(props, shown, selecting, bodyRevision),
    toolbarRows:
      shown === undefined
        ? []
        : (presentation?.axisRows ?? []).filter(
            (row) => row.displayOptions?.placement === AxisPlacement.ResultToolbar,
          ),
    shownLabel: shownVariantId === undefined ? undefined : labelFor(shownVariantId),
    selectedLabel:
      coreReady && selection !== undefined ? selectionLabelValue(selection) : undefined,
    shownCommerce,
    cartVariantId: selecting || shownCommerce?.inStock === false ? undefined : shownVariantId,
    imageSrc,
    imageCrop: shown === undefined ? props.photoCrop : undefined,
  };
}
export type TryOnView = ReturnType<typeof tryOnView>;
