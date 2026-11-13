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
  const title = props.productName ?? ui.text("sessionIntro.defaultProductName");
  const price = view.shownCommerce?.price ?? "";
  const summary = view.shown === undefined ? "" : ui.text("tryOnView.variantSummary", shown);
  const provenance = view.shown === undefined ? "" : ui.text("tryOnView.aiGeneratedLabel");
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
    addToCart: ui.text("tryOnView.addVariantToCart", {
      ...shown,
      price,
      hasPrice: price === "" ? "no" : "yes",
    }),
    tryOn: ui.text("tryOnView.tryOnVariant", selected),
    wearing: ui.text("tryOnView.wearingVariant", selected),
    openPicker: ui.text("tryOnView.variantPickerGenericTitle"),
    pickerTitle: ui.text("sizeAndStyleSelection.variantSectionLabel"),
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
