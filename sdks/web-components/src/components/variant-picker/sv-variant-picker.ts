import type {
  AxisKey,
  ForeignId,
  SelectionView,
  VariantRow,
  VariantRowItem,
  VariantId,
  VariantLabel,
} from "@studio-vaai/core";

import { AxisControl, AxisRole, RefusalReason, itemDisplayText } from "@studio-vaai/core";
import { css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { SvStockNotice, SvVariantCommerce } from "../../commerce/types.js";
import type { SvChangeDetail } from "../../events.js";
import type { OptionMark } from "../../internal/option-group/option-mark.js";
import type { SvChipStatus } from "../chip/sv-chip.js";

import { LiveStatus } from "../../internal/live-status.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvSelectDetail {
  axis: AxisKey;
  item: ForeignId;
}

export interface SvStockNoticeDetail {
  value: SvStockNotice | undefined;
}

export interface SvVariantPickerProps {
  /** The Rust experience's selection projection, including the target of every choice. */
  selection?: SelectionView | undefined;
  /** Previously tried option IDs by axis, after accounting for related selections. */
  triedItems?: ReadonlyMap<AxisKey, ReadonlySet<ForeignId>> | undefined;
  /** The recommended size as host-localized axis values. */
  recommendedSize?: VariantLabel | undefined;
  /** Storefront stock keyed by the Rust-projected target variant. Unknown stock stays selectable. */
  commerce?: Readonly<Record<VariantId, SvVariantCommerce>> | undefined;
  /** A refused stock choice supplied back by the host. A valid next choice requests clearing it. */
  stockNotice?: SvStockNotice | undefined;
  /** Lock all choices while the host is busy. */
  disabled?: boolean | undefined;
}

function variantPickerItemStatus(
  selection: SelectionView | undefined,
  row: VariantRow,
  item: VariantRowItem,
  soldOut: boolean,
): SvChipStatus | undefined {
  if (soldOut) {
    return "sold-out";
  }
  if (item.refusal !== undefined) {
    return "refused";
  }
  if (!item.available) {
    return "unavailable";
  }
  if (
    row.role === AxisRole.Size &&
    item.selected &&
    selection?.recommended === true &&
    !selection.chosenAxes.includes(row.key)
  ) {
    return "recommended";
  }
  return undefined;
}

/**
 * Generic variant axes from the Rust experience. Text, swatches, images and glyphs are display
 * choices within the same selection. An unavailable combination may still select a variant by
 * changing other axes; only an item without a target is disabled. Stock remains host-owned.
 *
 * @fires sv-select - Requests Rust SelectItem with the axis and item identifiers.
 * @fires sv-select-recommendation - Requests the recommended size.
 * @fires sv-stock-notice - Requests a stock explanation, or clears it after an available choice.
 * @csspart row - One axis.
 * @csspart label - The host's optional axis heading.
 * @csspart chips - The axis's choices.
 */
export class SvVariantPicker extends SvElement implements SvVariantPickerProps {
  protected override readonly usesMessages = true;
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: calc(var(--_sv-spacing) * 3);
        min-inline-size: 0;
      }
      .row {
        display: flex;
        flex-direction: column;
        gap: calc(var(--_sv-spacing) * 1.5);
        min-inline-size: 0;
      }
      .label {
        font-size: calc(var(--_sv-root) * 0.8125);
        line-height: 1.25;
        font-weight: var(--_sv-font-weight-light);
        color: var(--_sv-foreground);
      }
      .heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: calc(var(--_sv-spacing) * 1.5);
      }
      .recommendation {
        display: inline-flex;
        appearance: none;
        background: transparent;
        border: 0;
        border-radius: var(--_sv-radius);
        padding: 0;
        cursor: pointer;
      }
      .recommendation:focus-visible {
        outline: 2px solid var(--_sv-ring);
        outline-offset: 2px;
      }
      .recommendation:disabled {
        cursor: default;
        opacity: 0.5;
      }
      .note {
        display: inline-flex;
        align-items: flex-start;
        gap: var(--_sv-spacing);
        min-inline-size: 0;
        padding: calc(var(--_sv-spacing) * 0.5) calc(var(--_sv-spacing) * 1.5);
        border-radius: var(--_sv-radius);
        background: var(--_sv-muted);
        color: var(--_sv-muted-foreground);
        font-size: var(--_sv-text-xs);
        line-height: 1.25;
      }
      .note sv-icon {
        flex: none;
        --_sv-icon-size: calc(var(--_sv-spacing) * 3);
      }
    `,
  ];

  static override properties = {
    selection: { attribute: false },
    triedItems: { attribute: false },
    recommendedSize: { attribute: false },
    commerce: { attribute: false },
    flowControlled: { attribute: false },
    stockNotice: { attribute: false },
    disabled: { type: Boolean, reflect: true },
  };

  declare selection: SelectionView | undefined;
  declare triedItems: ReadonlyMap<AxisKey, ReadonlySet<ForeignId>> | undefined;
  declare recommendedSize: VariantLabel | undefined;
  declare commerce: Readonly<Record<VariantId, SvVariantCommerce>> | undefined;
  declare flowControlled: boolean | undefined;
  declare stockNotice: SvStockNotice | undefined;
  declare disabled: boolean;

  constructor() {
    super();
    this.selection = undefined;
    this.commerce = undefined;
    this.stockNotice = undefined;
    this.disabled = false;
  }

  #select(axis: AxisKey, item: VariantRowItem): void {
    if (this.disabled || item.variantId === undefined) {
      return;
    }
    if (this.flowControlled !== true && this.#soldOut(item)) {
      this.#notice({ axis, item: item.key, variantId: item.variantId });
      return;
    }
    if (this.flowControlled !== true && this.stockNotice !== undefined) {
      this.#notice();
    }
    this.dispatchEvent(
      new CustomEvent<SvSelectDetail>("sv-select", {
        detail: { axis, item: item.key },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #notice(detail?: SvStockNotice): void {
    this.dispatchEvent(
      new CustomEvent<SvStockNoticeDetail>("sv-stock-notice", {
        detail: { value: detail },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #soldOut(item: VariantRowItem): boolean {
    return item.variantId !== undefined && this.commerce?.[item.variantId]?.inStock === false;
  }

  #status(row: VariantRow, item: VariantRowItem): SvChipStatus | undefined {
    return variantPickerItemStatus(this.selection, row, item, this.#soldOut(item));
  }

  #description(item: VariantRowItem): string | undefined {
    if (item.variantId === undefined) {
      return this.ui.text("variantPicker.noVariant");
    }
    if (this.flowControlled !== true && this.#soldOut(item)) {
      return this.ui.text("tryOnView.sizeSoldOutSr");
    }
    if (item.refusal === RefusalReason.GarmentTooSmall) {
      return this.ui.text("variantPicker.refusedTooSmall");
    }
    if (item.refusal === RefusalReason.GarmentTooLarge) {
      return this.ui.text("variantPicker.refusedTooLarge");
    }
    return item.available ? undefined : this.ui.text("variantPicker.changesOtherAxes");
  }

  readonly #announcements = new LiveStatus(this, () =>
    (this.selection?.rows ?? [])
      .map((row) => this.#noticeText(row))
      .filter(Boolean)
      .join(" "),
  );

  #noticeText(row: VariantRow): string | undefined {
    const notice = this.stockNotice;
    const refused =
      notice?.axis === row.key
        ? row.items.find(
            (item) =>
              item.key === notice.item &&
              item.variantId === notice.variantId &&
              this.#soldOut(item),
          )
        : undefined;
    return refused === undefined
      ? undefined
      : this.ui.text("tryOnView.variantSoldOut", {
          variant: {
            axes: [
              {
                key: row.key,
                ...(row.role === undefined ? {} : { role: row.role }),
                label: itemDisplayText(refused.display),
              },
            ],
            formats: [],
          },
          hasVariant: "yes",
          hasSize: row.role === AxisRole.Size ? "yes" : "no",
        });
  }

  #renderRow(row: VariantRow, firstSize: AxisKey | undefined) {
    const tried = this.triedItems?.get(row.key);
    const selected = row.items.find((item) => item.selected);
    const value = selected === undefined ? "" : itemDisplayText(selected.display);
    const label =
      row.label === undefined || row.label === "" || value === ""
        ? row.label
        : this.ui.text("tryOnView.variantAxisLabel", { axisLabel: row.label, valueLabel: value });
    const note = this.#noticeText(row);
    const recommendation =
      this.recommendedSize !== undefined && row.key === firstSize
        ? this.ui.text("tryOnView.recommendedVariant", { variant: this.recommendedSize })
        : undefined;
    const fallback =
      this.recommendedSize === undefined &&
      selected !== undefined &&
      this.#status(row, selected) === "recommended"
        ? this.ui.text("tryOnView.recommendedChip", { sizeLabel: value })
        : undefined;
    const hasHeading = [label, note, recommendation, fallback].some(
      (text) => text !== undefined && text !== "",
    );
    return html`<div part="row" class="row">
      ${
        hasHeading
          ? html`<div class="heading">
              ${label === undefined || label === "" ? nothing : html`<span part="label" class="label">${label}</span>`}
              ${note === undefined ? nothing : html`<span class="note"><sv-icon name="info"></sv-icon><span>${note}</span></span>`}
              ${this.#recommendationBadge(recommendation, note === undefined ? fallback : undefined)}
            </div>`
          : nothing
      }
      <sv-option-group
        exportparts="chips"
        .label=${row.displayOptions?.control === AxisControl.Segmented ? row.label : label}
        .control=${row.displayOptions?.control}
        .options=${row.items.map((item) => {
          const wasTried = tried?.has(item.key) === true;
          let mark: OptionMark | undefined = wasTried ? "tried" : undefined;
          if (row.role === AxisRole.Size && item.selected) {
            mark = "current";
          }
          const description = this.#description(item);
          return {
            key: item.key,
            display: item.display,
            selected: item.selected,
            disabled: this.disabled || item.variantId === undefined,
            status: this.#status(row, item),
            mark,
            description: wasTried
              ? [description, this.ui.text("tryOnView.optionTriedOn")].filter(Boolean).join(" ")
              : description,
          };
        })}
        @sv-change=${(event: CustomEvent<SvChangeDetail>) => {
          event.stopPropagation();
          const item = row.items.find((candidate) => candidate.key === event.detail.value);
          if (item !== undefined) {
            this.#select(row.key, item);
          }
        }}
      ></sv-option-group>
    </div>`;
  }

  #recommendationBadge(label: string | undefined, fallback: string | undefined) {
    if (label === undefined) {
      return fallback === undefined
        ? nothing
        : html`<sv-badge variant="positive">${fallback}</sv-badge>`;
    }
    return html`<button
      class="recommendation"
      type="button"
      ?disabled=${this.disabled}
      @click=${() => {
        if (this.flowControlled !== true && this.stockNotice !== undefined) {
          this.#notice();
        }
        this.dispatchEvent(
          new CustomEvent("sv-select-recommendation", { bubbles: true, composed: true }),
        );
      }}
    >
      <sv-badge variant="positive">${label}</sv-badge>
    </button>`;
  }

  protected override render() {
    const rows = this.selection?.rows ?? [];
    const firstSize = rows.find(({ role }) => role === AxisRole.Size)?.key;
    return html`<span class="sv-sr-only" role="status" aria-atomic="true"
        >${this.#announcements.text}</span
      >${repeat(
        rows,
        (row) => row.key,
        (row) => this.#renderRow(row, firstSize),
      )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-variant-picker": SvVariantPicker;
  }
  interface HTMLElementEventMap {
    "sv-select": CustomEvent<SvSelectDetail>;
    "sv-select-recommendation": CustomEvent<undefined>;
    "sv-stock-notice": CustomEvent<SvStockNoticeDetail>;
  }
}
