import type { PresentedAxis, VariantRow } from "@studio-vaai/core";

import { Capability } from "@studio-vaai/core";
import { css } from "lit";

import type { SvChipStatus } from "../chip/sv-chip.js";

import { emitChange } from "../../events.js";
import { renderSegments, segmentStyles } from "../../internal/option-group/segments.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvStyleToggleProps {
  /** One selection or displayed-result axis, projected by the Rust experience. */
  row?: VariantRow | PresentedAxis | undefined;
  /** Optional host presentation for choices. Sold-out items stay pressable to explain the refusal. */
  itemStates?:
    | Readonly<
        Record<string, { status?: SvChipStatus | undefined; description?: string | undefined }>
      >
    | undefined;
  /** Not pressable, e.g. while a try-on runs. */
  disabled?: boolean | undefined;
}

/**
 * `<sv-style-toggle>` — a segmented control for how a garment is worn, e.g. buttoned or open.
 *
 * Renders the Rust presentation row directly. A press fires `sv-change` with the item's key;
 * selected state only changes when the owner supplies a new row. The row's label names the
 * group. Items whose `canShow` capability is unavailable cannot be pressed.
 *
 * @fires sv-change - An item was pressed; `detail.value` is its key.
 * @csspart group - The control.
 * @csspart segment - Each option.
 */
export class SvStyleToggle extends SvElement implements SvStyleToggleProps {
  static override styles = [
    svTokens,
    svBase,
    segmentStyles,
    css`
      :host {
        display: inline-flex;
        max-inline-size: 100%;
      }
    `,
  ];

  static override properties = {
    row: { attribute: false },
    itemStates: { attribute: false },
    disabled: { type: Boolean, reflect: true },
  };

  declare row: VariantRow | PresentedAxis | undefined;
  declare itemStates: SvStyleToggleProps["itemStates"];
  declare disabled: boolean;

  constructor() {
    super();
    this.row = undefined;
    this.itemStates = undefined;
    this.disabled = false;
  }

  protected override render() {
    const options = (this.row?.items ?? []).map((item) => ({
      key: item.key,
      display: item.display,
      selected: item.selected,
      ...this.itemStates?.[item.key],
      disabled:
        this.disabled ||
        item.variantId === undefined ||
        ("canShow" in item && !Capability.Available.instanceOf(item.canShow)),
    }));
    return renderSegments(options, this.row?.label, (key) => {
      emitChange(this, key);
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-style-toggle": SvStyleToggle;
  }
}
