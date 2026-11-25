import type { VariantLabel } from "@studio-vaai/core";

import { AxisRole } from "@studio-vaai/core";

import type { SvUiContext } from "../../ui/index.js";
import type { SvTryOnViewScreenProps } from "./types.js";
import type { TryOnView } from "./view.js";

const EMPTY_VARIANT_LABEL: VariantLabel = { axes: [], formats: [] };

/** Context flags select MF2 wording; the Rust function composes the caller's literal labels. */
function variantLabelValues(variant = EMPTY_VARIANT_LABEL) {
  const present = variant.axes.filter((axis) => axis.label !== "");
  return {
    variant,
    hasVariant: present.length > 0 ? "yes" : "no",
    hasSize: present.some((axis) => axis.role === AxisRole.Size) ? "yes" : "no",
    hasColor: present.some((axis) => axis.role === AxisRole.Color) ? "yes" : "no",
  };
}

export function tryOnHistoryMessages(ui: SvUiContext, variant: VariantLabel) {
  const values = variantLabelValues(variant);
  return {
    label: ui.text("tryOnView.historyVariantLabel", values),
    accessibleLabel: ui.text("tryOnView.historyVariantSr", values),
  };
}

/** SDK copy uses Rust MF2; product labels, price and fit descriptions remain caller-owned. */
export function tryOnViewMessages(ui: SvUiContext, props: SvTryOnViewScreenProps, view: TryOnView) {
  const shown = variantLabelValues(view.shownLabel);
  const selected = variantLabelValues(view.selectedLabel);
  const tryOnVariant = variantLabelValues(view.tryOnLabel);
  const title = props.productName ?? ui.text("sessionIntro.defaultProductName");
  const price = view.shownCommerce?.price ?? "";
  const summary = view.shown === undefined ? "" : ui.text("tryOnView.variantSummary", shown);
  const provenance = view.shown === undefined ? "" : ui.text("tryOnView.aiGeneratedLabel");
  const pickerRows = view.pickerSelection?.rows ?? [];
  const progress = ui.text("tryOnView.busyMessages.0");
  let status = "";
  if (props.state === "generating") {
    status = progress;
  } else if (view.selecting && props.busy === true) {
    status = ui.text("sizeAndStyleSelection.busyTryOnSr");
  }
  return {
    title,
    subtitle:
      view.selecting && view.shown === undefined
        ? ui.text("sizeAndStyleSelection.variantSubtitle")
        : [summary, provenance].filter((part) => part !== "").join(" · "),
    imageDescription:
      view.shown === undefined
        ? ui.text("photo.previewAlt")
        : [title, summary].filter((part) => part !== "").join(" · "),
    // The bag takes the result on screen, named as the picker names it. A result the rows cannot
    // name (e.g. of a variant the picker does not offer) borrows the selection's name when it is
    // the same variant, so the action never falls back to "this variant" while one is named.
    addToCart: ui.text("tryOnView.addVariantToCart", {
      ...(shown.hasVariant === "no" && view.shown?.key.variantId === view.pickerSelection?.variantId
        ? selected
        : shown),
      price,
      hasPrice: price === "" ? "no" : "yes",
    }),
    tryOn: ui.text("tryOnView.tryOnVariant", tryOnVariant),
    wearing: ui.text("tryOnView.wearingVariant", selected),
    // The collapsed picker's button says what the open picker's heading says.
    openPicker: ui.text("tryOnView.pickerHeading", {
      hasResult: "yes",
      hasSize: pickerRows.some(({ role }) => role === AxisRole.Size) ? "yes" : "no",
      hasColor: pickerRows.some(({ role }) => role === AxisRole.Color) ? "yes" : "no",
    }),
    pickerTitle: ui.text("tryOnView.pickerHeading", {
      hasResult: view.shown === undefined ? "no" : "yes",
      hasSize: pickerRows.some(({ role }) => role === AxisRole.Size) ? "yes" : "no",
      hasColor: pickerRows.some(({ role }) => role === AxisRole.Color) ? "yes" : "no",
    }),
    upload: ui.text("sizeAndStyleSelection.useAnotherImage"),
    status: props.statusMessage ?? status,
    retry:
      props.retryVariantId === undefined
        ? ui.text("experience.retryTryOn")
        : ui.text("experience.retryNamedTryOn", { variant: view.labelFor(props.retryVariantId) }),
    history: ui.text("tryOnView.triedVariantsLabel"),
    score: ui.text("tryOnView.fitScoreForVariant", shown),
    scoreUnavailable: ui.text("tryOnView.fitScoreUnavailable"),
    retryScore: ui.text("tryOnView.fitScoreRetrySr"),
    error:
      props.error ??
      (props.state === "error" ? ui.text("tryOnView.variantTryOnFailed", selected) : ""),
    soldOut: ui.text("tryOnView.variantSoldOut", shown),
    download: ui.text("tryOnView.downloadImage"),
    progress,
  };
}
export type TryOnViewMessages = ReturnType<typeof tryOnViewMessages>;
