import type {
  PresentedAxis,
  PresentedAxisItem,
  PresentationView,
  Product,
  SelectionView,
  TryOn,
  VariantId,
} from "@studio-vaai/core";
import type { TemplateResult } from "lit";

import { Capability } from "@studio-vaai/core";
import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";

import type { SvStockNotice, SvVariantCommerce } from "../commerce/types.js";
import type { SvToggleDetail } from "../components/disclosure/sv-disclosure.js";
import type { SvScreenNavigation } from "../components/screen/sv-screen.js";
import type { SvSelectDetail } from "../components/variant-picker/sv-variant-picker.js";
import type { SvChangeDetail } from "../events.js";
import type { SvImageCrop } from "../media/image-crop.js";
import type { SvImageFraming } from "../media/image-framing.js";
import type { SvTryOnFit } from "./try-on-view/fit.js";
import type { TryOnViewMessages } from "./try-on-view/messages.js";
import type {
  SvTryOnViewScreenProps,
  SvTryOnViewState,
  SvTryOnViewActionDetail,
  SvTryOnViewChangeDetail,
} from "./try-on-view/types.js";
import type { TryOnView } from "./try-on-view/view.js";

import { ScreenLayoutController } from "../internal/screen-layout.js";
import { SvElement } from "../internal/ui-element.js";
import {
  backdropImageFraming,
  photoImageFraming,
  STABLE_IMAGE_FRAMING,
} from "../media/image-framing.js";
import { svBase } from "../styles/base.js";
import { svTokens } from "../styles/tokens.js";
import { CalloutLayoutController } from "./try-on-view/callout-layout-controller.js";
import { fitOverlayStyles } from "./try-on-view/fit-overlay-styles.js";
import { renderFitOverlay } from "./try-on-view/fit-overlay.js";
import { tryOnHistoryMessages, tryOnViewMessages } from "./try-on-view/messages.js";
import { tryOnViewStyles } from "./try-on-view/styles.js";
import { tryOnView } from "./try-on-view/view.js";

type StageImage = Pick<TryOnView, "shown" | "shownLabel" | "fit" | "imageSrc" | "imageCrop"> & {
  key: string;
  loadKey: string | undefined;
};

/**
 * Try-on results with history, variant selection, and fit details.
 * @fires sv-try-on-view-change - Selection, displayed image, disclosure, or fit callout change requested.
 * @fires sv-try-on-view-action - Try-on, retry, cart, download, or fit-score retry requested.
 * @fires sv-back - Back requested.
 */
export class SvTryOnViewScreen extends SvElement implements SvTryOnViewScreenProps {
  readonly #layout = new ScreenLayoutController(this);
  #presentedImage: StageImage | undefined;
  protected override readonly usesMessages = true;
  static override styles = [svTokens, svBase, tryOnViewStyles, fitOverlayStyles];
  static override properties = {
    navigation: { attribute: false },
    statusMessage: { attribute: false },
    requestPending: { attribute: false },
    retryVariantId: { attribute: false },
    cartPending: { attribute: false },
    cartAvailable: { attribute: false },
    downloadAvailable: { attribute: false },
    downloadPending: { attribute: false },
    resultImageSrc: { attribute: false },
    resultImageLoadKey: { attribute: false },
    resultImageState: { attribute: false },
    productName: { attribute: "product-name" },
    product: { attribute: false },
    selection: { attribute: false },
    presentation: { attribute: false },
    tryOns: { attribute: false },
    bodyRevision: { attribute: false },
    commerce: { attribute: false },
    flowControlled: { attribute: false },
    stockNotice: { attribute: false },
    photoSrc: { attribute: "photo-src" },
    photoLoadKey: { attribute: false },
    photoCrop: { attribute: false },
    photoFraming: { attribute: false },
    resultFraming: { attribute: false },
    fit: { attribute: false },
    state: {},
    pickerOpen: { type: Boolean, attribute: "picker-open" },
    fitDetailsOpen: { type: Boolean, attribute: "fit-details-open" },
    activeCalloutKey: { attribute: "active-callout-key" },
    busy: { type: Boolean },
    error: {},
  };

  declare productName: string | undefined;
  declare product: Product | undefined;
  declare selection: SelectionView | undefined;
  declare presentation: PresentationView | undefined;
  declare tryOns: readonly TryOn[];
  declare bodyRevision: SvTryOnViewScreenProps["bodyRevision"];
  declare commerce: Readonly<Record<VariantId, SvVariantCommerce>> | undefined;
  declare flowControlled: boolean | undefined;
  declare stockNotice: SvStockNotice | undefined;
  declare photoSrc: string | undefined;
  declare photoLoadKey: string | undefined;
  declare photoCrop: SvImageCrop | undefined;
  declare photoFraming: SvImageFraming | undefined;
  declare resultFraming: SvImageFraming | undefined;
  declare fit: SvTryOnFit | undefined;
  declare state: SvTryOnViewState;
  declare pickerOpen: boolean;
  declare fitDetailsOpen: boolean;
  declare activeCalloutKey: string | undefined;
  declare busy: boolean;
  declare error: string | undefined;

  declare statusMessage: string | undefined;
  declare requestPending: boolean | undefined;
  declare retryVariantId: VariantId | undefined;
  declare cartPending: boolean | undefined;
  declare cartAvailable: boolean | undefined;
  declare downloadAvailable: boolean | undefined;
  declare downloadPending: boolean | undefined;
  declare resultImageSrc: string | null | undefined;
  declare resultImageLoadKey: string | undefined;
  declare resultImageState: SvTryOnViewScreenProps["resultImageState"];
  declare navigation: SvScreenNavigation | undefined;

  constructor() {
    super();
    this.addController(new CalloutLayoutController(this));
    this.productName = undefined;
    this.product = undefined;
    this.selection = undefined;
    this.presentation = undefined;
    this.tryOns = [];
    this.commerce = undefined;
    this.stockNotice = undefined;
    this.photoSrc = undefined;
    this.photoCrop = undefined;
    this.photoFraming = undefined;
    this.resultFraming = undefined;
    this.fit = undefined;
    this.state = "ready";
    this.pickerOpen = false;
    this.fitDetailsOpen = false;
    this.activeCalloutKey = undefined;
    this.busy = false;
    this.error = undefined;
  }

  get #locked(): boolean {
    return this.busy || (this.navigation === undefined && this.state === "generating");
  }

  #change(detail: SvTryOnViewChangeDetail): void {
    if (
      this.#locked &&
      (detail.field === "stockNotice" ||
        detail.field === "selection" ||
        detail.field === "displayedImage" ||
        detail.field === "displayedAxis")
    ) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<SvTryOnViewChangeDetail>("sv-try-on-view-change", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  #act(action: SvTryOnViewActionDetail["action"]): void {
    if (this.#locked) {
      return;
    }
    const { primary, recommendedSize, selecting, cartVariantId, shown, fit } = tryOnView(
      this,
      this.ui.snapshot.status === "ready",
    );
    let detail: SvTryOnViewActionDetail;
    if (action === "try-on" || action === "retry") {
      if (
        primary.action !== action ||
        primary.variantId === undefined ||
        this.requestPending === true
      ) {
        return;
      }
      detail = { action, variantId: primary.variantId };
    } else if (action === "select-recommendation") {
      if (recommendedSize === undefined) {
        return;
      }
      detail = { action };
    } else if (action === "upload") {
      if (!selecting) {
        return;
      }
      detail = { action };
    } else if (action === "add-to-cart") {
      if (
        cartVariantId === undefined ||
        shown === undefined ||
        this.cartPending === true ||
        this.cartAvailable === false ||
        !this.#imageReady
      ) {
        return;
      }
      detail = { action, variantId: cartVariantId, tryOnId: shown.id };
    } else {
      if (
        shown === undefined ||
        (action === "download" &&
          (this.downloadAvailable === false || this.state === "generating" || !this.#imageReady)) ||
        (action === "retry-fit-score" && fit?.state !== "error")
      ) {
        return;
      }
      detail = { action, tryOnId: shown.id };
    }
    this.dispatchEvent(
      new CustomEvent<SvTryOnViewActionDetail>("sv-try-on-view-action", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  readonly #onSelection = (event: CustomEvent<SvSelectDetail>): void => {
    event.stopPropagation();
    this.#change({ field: "selection", ...event.detail });
  };
  readonly #onStockNotice = (event: HTMLElementEventMap["sv-stock-notice"]): void => {
    event.stopPropagation();
    this.#change({ field: "stockNotice", value: event.detail.value });
  };
  readonly #closePicker = (): void => {
    this.#change({ field: "pickerOpen", value: false });
  };
  readonly #onScore = (event: CustomEvent<SvToggleDetail>): void => {
    event.stopPropagation();
    this.#change({ field: "fitDetailsOpen", value: event.detail.open });
  };
  readonly #onScoreRetry = (event: Event): void => {
    event.stopPropagation();
    this.#act("retry-fit-score");
  };

  #showAxisItem(axis: PresentedAxis, item: PresentedAxisItem): void {
    if (!Capability.Available.instanceOf(item.canShow)) {
      return;
    }
    if (item.tryOnId === undefined) {
      this.#change({ field: "displayedAxis", axis: axis.key, item: item.key });
    } else {
      this.#change({ field: "displayedImage", tryOnId: item.tryOnId });
    }
  }

  #toolbarAxis(row: PresentedAxis) {
    return html`<sv-option-group
      wrap
      .label=${row.label}
      .control=${row.displayOptions?.control}
      .options=${row.items.map((item) => ({
        key: item.key,
        display: item.display,
        selected: item.selected,
        disabled:
          this.#locked ||
          !Capability.Available.instanceOf(item.canShow) ||
          (item.tryOnId === undefined &&
            item.variantId !== undefined &&
            this.commerce?.[item.variantId]?.inStock === false),
      }))}
      @sv-change=${(event: CustomEvent<SvChangeDetail>) => {
        event.stopPropagation();
        const item = row.items.find((candidate) => candidate.key === event.detail.value);
        if (item !== undefined) {
          this.#showAxisItem(row, item);
        }
      }}
    ></sv-option-group>`;
  }

  #history(copy: TryOnViewMessages, view: TryOnView) {
    const { results, shown, toolbarRows } = view;
    const hasHistory = results.length >= 2 || toolbarRows.length > 0;
    if (shown === undefined && !hasHistory) {
      return nothing;
    }
    const entries = results.map((result) => {
      const { variantId } = result.key;
      const { label, accessibleLabel } = tryOnHistoryMessages(
        this.ui,
        view.historyLabelValue(variantId),
      );
      const sameVariant = results.filter((candidate) => candidate.key.variantId === variantId);
      const number = sameVariant.findIndex(({ id }) => id === result.id) + 1;
      const distinguish = (text: string) =>
        sameVariant.length > 1
          ? this.ui.text("experience.resultNumber", { label: text, number })
          : text;
      return { result, label: distinguish(label), accessibleLabel: distinguish(accessibleLabel) };
    });
    return html`<div class="history-row" ?inert=${this.#locked}>
      ${
        hasHistory
          ? html`<div class="history" role="group" aria-label=${copy.history}>
              ${repeat(
                entries,
                ({ result }) => result.id,
                ({ result, label, accessibleLabel }) => {
                  const { variantId } = result.key;
                  const { color, image } = view.historySwatch(variantId);
                  const collides = entries.some(
                    (entry) =>
                      entry.result.id !== result.id && entry.accessibleLabel === accessibleLabel,
                  );
                  const options = collides ? view.historyOptions(variantId) : undefined;
                  const withOptions = (text: string) =>
                    options !== undefined && options.axes.length > 0
                      ? this.ui.text("tryOnView.historyVariantWithOptions", {
                          label: text,
                          options,
                        })
                      : text;
                  return html`<sv-history-chip
                    .selected=${result.id === shown?.id}
                    .disabled=${this.#locked}
                    .label=${withOptions(accessibleLabel)}
                    .color=${color}
                    .image=${image}
                    @click=${() => {
                      this.#change({ field: "displayedImage", tryOnId: result.id });
                    }}
                    >${withOptions(label)}</sv-history-chip
                  >`;
                },
              )}
            </div>`
          : nothing
      }
      ${
        toolbarRows.length === 0
          ? nothing
          : html`<div class="result-toolbar">
              ${repeat(
                toolbarRows,
                (row) => row.key,
                (row) => this.#toolbarAxis(row),
              )}
            </div>`
      }
    </div>`;
  }

  get #imageReady(): boolean {
    return this.resultImageState === undefined || this.resultImageState === "ready";
  }

  #fit(copy: TryOnViewMessages, { fit, shown }: TryOnView) {
    if (
      shown === undefined ||
      (fit === undefined && (!this.#imageReady || this.fit === undefined))
    ) {
      return nothing;
    }
    return html`<sv-fit-score
      style=${fit === undefined ? "visibility: hidden" : nothing}
      aria-hidden=${fit === undefined ? "true" : nothing}
      ?inert=${fit === undefined}
      .loading=${fit === undefined || fit.state === "loading"}
      .score=${fit?.state === "ready" ? fit.score : undefined}
      .label=${fit?.state === "error" ? copy.scoreUnavailable : copy.score}
      .description=${fit?.state === "ready" ? fit.description : undefined}
      .expandable=${fit?.state === "ready" && (fit.callouts?.length ?? 0) > 0}
      .open=${this.fitDetailsOpen}
      .failed=${fit?.state === "error"}
      .busy=${this.#locked || !this.#imageReady}
      .retryLabel=${copy.retryScore}
      .retryable=${fit?.state === "error" ? fit.retryable : undefined}
      @sv-toggle=${this.#onScore}
      @sv-retry=${this.#onScoreRetry}
    ></sv-fit-score>`;
  }

  #picker(copy: TryOnViewMessages, view: TryOnView, open: boolean, error: string) {
    const canClose = !this.#layout.wide && !view.selecting && this.state !== "error";
    return html`<div class="picker-slot" data-sv-panel-overlay ?inert=${!open}>
      <div class="picker-clip">
        <sv-glass class="picker-card" role="region" aria-labelledby="variant-picker-heading">
          <h3 class="picker-heading" id="variant-picker-heading">
            ${
              canClose
                ? html`<button
                    class="picker-toggle"
                    type="button"
                    aria-expanded=${open}
                    aria-controls="variant-picker-body"
                    @click=${this.#closePicker}
                  >
                    ${copy.pickerTitle}<sv-icon name="chevron-up" size="sm"></sv-icon>
                  </button>`
                : html`<span class="picker-title">${copy.pickerTitle}</span>`
            }
          </h3>
          <div class="picker-body" id="variant-picker-body">
            <sv-variant-picker
              .selection=${view.pickerSelection}
              .triedItems=${view.triedItems}
              .recommendedSize=${view.recommendedSize}
              .commerce=${this.commerce}
              .flowControlled=${this.flowControlled}
              .stockNotice=${this.stockNotice}
              .disabled=${this.#locked}
              @sv-select=${this.#onSelection}
              @sv-select-recommendation=${() => {
                this.#act("select-recommendation");
              }}
              @sv-stock-notice=${this.#onStockNotice}
            ></sv-variant-picker>
            <slot name="picker-note"></slot>
            ${error === "" ? nothing : html`<sv-message class="picker-error">${error}</sv-message>`}
          </div>
        </sv-glass>
      </div>
    </div>`;
  }

  #overlay(copy: TryOnViewMessages, view: TryOnView, pickerOpen: boolean) {
    if (this.state === "generating") {
      return html`<div slot="overlay" class="image-overlay">
        <div class="progress">
          <span>${copy.progress}</span>
        </div>
      </div>`;
    }
    if (view.selecting || view.shown === undefined) {
      return nothing;
    }
    return html`<div slot="overlay" class="image-overlay">
      ${renderFitOverlay({
        items: view.fit?.state === "ready" ? (view.fit.callouts ?? []) : [],
        open: this.fitDetailsOpen && !pickerOpen,
        activeKey: this.activeCalloutKey,
        onSelect: (value) => {
          this.#change({ field: "activeCalloutKey", value });
        },
      })}
      <sv-button
        class="download"
        variant="ghost"
        .disabled=${this.#locked || !this.#imageReady || this.downloadAvailable === false}
        .busy=${this.downloadPending === true}
        @click=${() => {
          this.#act("download");
        }}
        ><sv-icon name="download"></sv-icon
        ><span class="sv-sr-only">${copy.download}</span></sv-button
      >
    </div>`;
  }

  #primary(copy: TryOnViewMessages, view: TryOnView, opensPicker: boolean) {
    const { action, label, variantId } = view.primary;
    const labelKind = opensPicker ? "openPicker" : label;
    const pending = this.requestPending === true;
    return html`<sv-button
      slot="primary"
      .busy=${this.#locked || (!opensPicker && pending)}
      .disabled=${this.#locked || (!opensPicker && (pending || variantId === undefined))}
      @click=${() => {
        if (opensPicker) {
          this.#change({ field: "pickerOpen", value: true });
        } else if (action !== undefined) {
          this.#act(action);
        }
      }}
      >${keyed(labelKind, html`<span class="primary-label">${copy[labelKind]}</span>`)}</sv-button
    >`;
  }

  #stageImage(
    view: StageImage,
    copy: TryOnViewMessages,
    hasPicker: boolean,
    overlay: TemplateResult | typeof nothing,
    pending: boolean,
  ) {
    const framing =
      view.shown === undefined
        ? photoImageFraming(this.photoFraming)
        : (this.resultFraming ?? STABLE_IMAGE_FRAMING);
    let imageFraming = framing;
    if (!this.#layout.wide) {
      if (view.shown === undefined && hasPicker) {
        imageFraming = backdropImageFraming(framing);
      } else if (framing !== undefined) {
        imageFraming = { ...framing, blockAlign: "end" };
      }
    }
    return html`<sv-image
      slot="stage"
      ?data-result=${view.shown !== undefined}
      ?data-managed=${this.flowControlled === true}
      ?data-pending=${pending}
      aria-hidden=${pending ? "true" : nothing}
      ?inert=${pending}
      .src=${view.imageSrc}
      .sourceKey=${view.shown?.id}
      .loadKey=${view.loadKey}
      .alt=${pending ? "" : copy.imageDescription}
      .crop=${view.imageCrop}
      .framing=${imageFraming}
      .zoomable=${!pending && this.#imageReady && this.state === "ready" && !this.#locked}
      .busy=${!pending && this.state === "generating"}
      >${pending ? nothing : overlay}</sv-image
    >`;
  }

  protected override render() {
    const view = tryOnView(this, this.ui.snapshot.status === "ready");
    const loadKey = view.shown === undefined ? this.photoLoadKey : this.resultImageLoadKey;
    const image: StageImage = {
      key: loadKey ?? (view.shown === undefined ? "photo" : "result"),
      loadKey,
      shown: view.shown,
      shownLabel: view.shownLabel,
      fit: view.fit,
      imageSrc: view.imageSrc,
      imageCrop: view.imageCrop,
    };
    const holding = this.flowControlled === true && view.shown !== undefined && !this.#imageReady;
    if (!holding) {
      this.#presentedImage = image;
    }
    // The incoming image loads in the stage but stays hidden until the flow accepts its decode.
    const visible =
      holding && this.#presentedImage?.imageSrc === undefined
        ? {
            key: this.photoLoadKey ?? "photo",
            loadKey: this.photoLoadKey,
            imageSrc: this.photoSrc,
            imageCrop: this.photoCrop,
            shown: undefined,
            shownLabel: undefined,
            fit: undefined,
          }
        : (this.#presentedImage ?? image);
    const { shown, shownLabel, fit } = visible;
    const displayed = { ...view, shown, shownLabel, fit };
    const pending = holding && image.imageSrc !== undefined && image.key !== visible.key;
    const copy = tryOnViewMessages(this.ui, this, displayed);
    const hasPicker = (view.pickerSelection?.rows.length ?? 0) > 0;
    const pickerOpen =
      hasPicker &&
      (this.#layout.wide ||
        view.pickerOpen ||
        (this.flowControlled !== true && (this.pickerOpen || this.state === "error")));
    const overlay = this.#overlay(copy, displayed, pickerOpen && !this.#layout.wide);
    return html`<sv-screen
      .navigation=${this.navigation}
      lang=${this.ui.snapshot.resolvedLocale ?? this.ui.snapshot.locale}
      .heading=${copy.title}
      .description=${copy.subtitle}
      .busy=${this.#locked}
      .statusMessage=${copy.status}
      panel-mode="overlay"
    >
      ${repeat(
        pending ? [visible, image] : [visible],
        ({ key }) => key,
        (stage) => this.#stageImage(stage, copy, hasPicker, overlay, stage !== visible),
      )}
      <div class="panel">
        ${
          view.shown === undefined && shown === undefined
            ? nothing
            : html`<div
                class="result-fold"
                ?inert=${view.selecting || (!this.#layout.wide && pickerOpen)}
              >
                <div class="result-clip">
                  <div class="result-summary">
                    ${this.#history(copy, displayed)}${this.#fit(copy, displayed)}
                  </div>
                </div>
              </div>`
        }
        ${hasPicker ? this.#picker(copy, view, pickerOpen, pickerOpen ? copy.error : "") : nothing}
      </div>
      <div slot="before-actions">
        <slot name="recovery"></slot>
        ${copy.error !== "" && !pickerOpen ? html`<sv-message class="error">${copy.error}</sv-message>` : nothing}
        ${!view.selecting && view.shownCommerce?.inStock === false ? html`<p class="sold-out" role="status">${copy.soldOut}</p>` : nothing}
      </div>
      ${this.#primary(copy, view, hasPicker && !pickerOpen)}
      <sv-button
        slot="secondary"
        variant="ghost"
        .busy=${this.cartPending === true}
        .disabled=${this.#locked || (!view.selecting && (this.cartPending === true || view.cartVariantId === undefined || this.cartAvailable === false || !this.#imageReady))}
        @click=${() => {
          this.#act(view.selecting ? "upload" : "add-to-cart");
        }}
        >${view.selecting ? copy.upload : copy.addToCart}</sv-button
      >
    </sv-screen>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-try-on-view-screen": SvTryOnViewScreen;
  }
  interface HTMLElementEventMap {
    "sv-try-on-view-change": CustomEvent<SvTryOnViewChangeDetail>;
    "sv-try-on-view-action": CustomEvent<SvTryOnViewActionDetail>;
  }
}
