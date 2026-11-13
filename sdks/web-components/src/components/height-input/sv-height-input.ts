import type { PropertyValues } from "lit";

import { css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";

import type { SvFieldAccessibilityProps } from "../../internal/field-accessibility.js";

import { emitChange } from "../../events.js";
import { fieldDescriptionIds } from "../../internal/field-accessibility.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

const MIN_CM = 140;
const MAX_CM = 220;
const VALUES = Array.from({ length: MAX_CM - MIN_CM + 1 }, (_, index) => MIN_CM + index);

/** Rounded to a whole cm, within the range. */
function clampCm(cm: number): number {
  return Math.max(MIN_CM, Math.min(MAX_CM, Math.round(cm)));
}

export const SV_HEIGHT_INPUT_MODES = ["wheel", "stepper"] as const;
export type SvHeightInputMode = (typeof SV_HEIGHT_INPUT_MODES)[number];

export interface SvHeightInputProps extends SvFieldAccessibilityProps {
  /**
   * The height in cm, 140–220; unset shows 170. Only the owner changes it: the input asks with
   * `sv-change`.
   */
  value?: number | undefined;
  /**
   * `wheel` scrolls through the heights, for touch screens; `stepper` is a number field with
   * up and down buttons, for a mouse and keyboard. Unset picks by the device's pointer.
   */
  mode?: SvHeightInputMode | undefined;
  /** The accessible name, e.g. "How tall are you?". */
  label?: string | undefined;
  /** Not changeable, e.g. while the height is saved. */
  disabled?: boolean | undefined;
}

const COARSE_POINTER = "(pointer: coarse)";
/** Without `scrollend`, a pause this long in scroll events ends a scroll. */
const SCROLL_SETTLE_MS = 80;

/**
 * `<sv-height-input>` — the shopper's height in cm, from 140 to 220.
 *
 * Two forms, picked by the device unless `mode` says: on touch screens a wheel to scroll
 * through the heights, which snaps to whole cm; with a mouse a number field to type into, with
 * up and down buttons. The arrow keys step by 1 cm in both.
 *
 * Fires `sv-change` once a value is set: when the wheel comes to rest, on Enter or when
 * the field loses focus, and on each step. The shown value only changes when the owner sets
 * `value`; typed text that isn't a number goes back to it, and numbers outside the range are
 * clamped. Screen readers get a spin button named by `label`.
 *
 * @fires sv-change - The shopper set a height; `detail.value` is in cm.
 * @csspart field - The box around the field or wheel.
 */
export class SvHeightInput extends SvElement implements SvHeightInputProps {
  protected override readonly usesMessages = true;
  static override shadowRootOptions: ShadowRootInit = {
    ...SvElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: block;
        min-inline-size: 0;
      }
      :host([disabled]) {
        pointer-events: none;
        opacity: 0.6;
      }

      .field {
        position: relative;
        display: flex;
        inline-size: 100%;
        overflow: hidden;
        border: 1px solid var(--_sv-input);
        border-radius: var(--_sv-radius);
        background: var(--_sv-control);
        color: var(--_sv-foreground);
        transition: border-color var(--_sv-duration-fast) var(--_sv-ease);
      }
      .field:focus-within {
        border-color: var(--_sv-foreground);
      }

      /* ---------- Stepper ---------- */
      /* The label hands a press on the unit or the padding to the input. */
      .entry {
        flex: 1;
        min-inline-size: 0;
        display: flex;
        align-items: center;
        gap: calc(var(--_sv-spacing) * 1.5);
        padding: calc(var(--_sv-spacing) * 2.5) var(--_sv-field-padding-inline);
        cursor: text;
      }
      /* Sized to its text: browsers give inputs at least a normal line height otherwise. */
      input {
        flex: none;
        inline-size: 3ch;
        block-size: 1em;
        margin: 0;
        padding: 0;
        border: 0;
        appearance: none;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: var(--_sv-text-base);
        line-height: 1;
        font-weight: var(--_sv-font-weight-medium);
        font-variant-numeric: tabular-nums;
        text-align: end;
        outline: none;
      }
      .unit {
        font-size: var(--_sv-text-base);
        line-height: 1;
        color: var(--_sv-muted-foreground);
        pointer-events: none;
      }
      .steps {
        flex: none;
        display: flex;
        flex-direction: column;
        inline-size: calc(var(--_sv-spacing) * 9);
        border-inline-start: 1px solid var(--_sv-input);
      }
      .steps hr {
        margin: 0;
        border: 0;
        block-size: 1px;
        background: var(--_sv-input);
      }
      .step {
        appearance: none;
        flex: 1;
        display: grid;
        place-items: center;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        transition: background-color var(--_sv-duration-fast) var(--_sv-ease);
      }
      .step:hover:not(:disabled) {
        background: var(--_sv-control-hover);
      }
      .step:active:not(:disabled) {
        background: var(--_sv-input);
      }
      .step:disabled {
        cursor: not-allowed;
        opacity: 0.3;
      }

      /* ---------- Wheel ---------- */
      .field.wheel {
        display: block;
        block-size: calc(var(--_sv-spacing) * 14);
        user-select: none;
      }
      .fade {
        position: absolute;
        inset-inline: 0;
        z-index: 1;
        block-size: calc(var(--_sv-spacing) * 2.5);
        pointer-events: none;
      }
      .fade.top {
        inset-block-start: 0;
        background: linear-gradient(var(--_sv-control), transparent);
      }
      .fade.bottom {
        inset-block-end: 0;
        background: linear-gradient(transparent, var(--_sv-control));
      }
      .scroller {
        block-size: 100%;
        overflow-y: auto;
        overscroll-behavior-y: contain;
        scroll-snap-type: y mandatory;
        scrollbar-width: none;
        outline: none;
      }
      .scroller::-webkit-scrollbar {
        display: none;
      }
      /* Padding of half the leftover height puts the first and last rows in the middle. */
      .rows {
        padding-block: calc(var(--_sv-spacing) * 4);
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: center;
        block-size: calc(var(--_sv-spacing) * 6);
        scroll-snap-align: center;
        font-size: var(--_sv-text-base);
        line-height: 1;
        color: var(--_sv-muted-foreground);
        opacity: 0.7;
        transition: color var(--_sv-duration-fast) var(--_sv-ease);
      }
      .row.near {
        opacity: 0.8;
      }
      .row.center {
        color: var(--_sv-foreground);
        opacity: 1;
      }
    `,
  ];

  static override properties = {
    validationError: { attribute: "validation-error" },
    description: {},
    value: { type: Number },
    mode: { reflect: true },
    label: {},
    disabled: { type: Boolean, reflect: true },
    _coarse: { state: true },
    _draft: { state: true },
    _correction: { state: true },
    _center: { state: true },
  };

  declare value: number | undefined;
  declare mode: SvHeightInputMode | undefined;
  declare label: string | undefined;
  declare disabled: boolean;
  declare validationError: string | undefined;
  declare description: string | undefined;
  /** Internal: the device's main pointer is a finger. */
  declare _coarse: boolean;
  /** Internal: the field's text while it's being typed. */
  declare _draft: string | undefined;
  declare _correction: number | undefined;
  /** Internal: the wheel's row nearest the middle, while it scrolls. */
  declare _center: number | undefined;

  #pointer: MediaQueryList | undefined;
  #resize: ResizeObserver | undefined;
  #settle: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.value = undefined;
    this.mode = undefined;
    this.label = undefined;
    this.disabled = false;
    this.validationError = undefined;
    this.description = undefined;
    this._coarse = false;
    this._draft = undefined;
    this._correction = undefined;
    this._center = undefined;
  }

  /** The form shown now: `mode`, or the device's pointer. */
  get resolvedMode(): SvHeightInputMode {
    return this.mode ?? (this._coarse ? "wheel" : "stepper");
  }

  get #cm(): number {
    return clampCm(this.value ?? 170);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (typeof globalThis.matchMedia === "function") {
      this.#pointer = globalThis.matchMedia(COARSE_POINTER);
      this._coarse = this.#pointer.matches;
      this.#pointer.addEventListener("change", this.#onPointer);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#pointer?.removeEventListener("change", this.#onPointer);
    this.#resize?.disconnect();
    this.#resize = undefined;
    clearTimeout(this.#settle);
  }

  readonly #onPointer = (event: MediaQueryListEvent): void => {
    this._coarse = event.matches;
  };

  #emit(cm: number): void {
    this._correction = undefined;
    const value = clampCm(cm);
    if (value !== this.value) {
      emitChange(this, value);
    }
    void this.#resync();
  }

  /** Back to what the owner says, once it had its chance to answer. */
  async #resync(): Promise<void> {
    await this.updateComplete;
    this.#scrollToValue();
  }

  // ---------- Stepper ----------

  readonly #onInput = (event: Event): void => {
    if (event.target instanceof HTMLInputElement) {
      // Digits only, so a pasted "175 cm" lands as "175".
      const digits = event.target.value.replaceAll(/\D/gu, "").slice(0, 3);
      event.target.value = digits;
      this._draft = digits;
      this._correction = undefined;
    }
  };

  #commitDraft(): number | undefined {
    const draft = this._draft;
    this._draft = undefined;
    const typed = Number.parseInt(draft ?? "", 10);
    if (!Number.isNaN(typed)) {
      this.#emit(typed);
      this._correction = typed < MIN_CM || typed > MAX_CM ? clampCm(typed) : undefined;
      return clampCm(typed);
    }
    if (draft !== undefined) {
      this._correction = this.#cm;
    }
    return undefined;
  }

  /** Commits the current edit before an action uses the selected height. */
  commitEdit(): number | undefined {
    if (this.disabled) {
      return;
    }
    if (this.resolvedMode === "stepper") {
      return this.#commitDraft();
    }
    clearTimeout(this.#settle);
    return this.#commitScroll();
  }

  readonly #onBlur = (): void => {
    this.#commitDraft();
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      this._draft = undefined;
      this.#emit(this.#cm + (event.key === "ArrowUp" ? 1 : -1));
    } else if (event.key === "Enter" && this.resolvedMode === "stepper") {
      event.preventDefault();
      this.#commitDraft();
    }
  };

  #renderStepper(cm: number) {
    return html`<div part="field" class="field">
      <label class="entry">
        <input
          type="text"
          inputmode="numeric"
          enterkeyhint="done"
          autocomplete="off"
          maxlength="3"
          role="spinbutton"
          aria-valuemin=${MIN_CM}
          aria-valuemax=${MAX_CM}
          aria-valuenow=${cm}
          aria-valuetext="${cm} cm"
          aria-label=${this.label ?? nothing}
          aria-invalid=${typeof this.validationError === "string" && this.validationError !== "" ? "true" : nothing}
          aria-describedby=${fieldDescriptionIds(this.description, this.validationError, this._correction === undefined ? undefined : "correction") ?? nothing}
          .value=${live(this._draft ?? String(cm))}
          ?disabled=${this.disabled}
          @input=${this.#onInput}
          @blur=${this.#onBlur}
          @keydown=${this.#onKeyDown}
        />
        <span class="unit" aria-hidden="true">cm</span>
      </label>
      <div class="steps" aria-hidden="true">
        <button
          class="step"
          type="button"
          tabindex="-1"
          ?disabled=${this.disabled || cm >= MAX_CM}
          @click=${() => {
            this.#emit(cm + 1);
          }}
        >
          <sv-icon name="chevron-up" size="sm"></sv-icon>
        </button>
        <hr />
        <button
          class="step"
          type="button"
          tabindex="-1"
          ?disabled=${this.disabled || cm <= MIN_CM}
          @click=${() => {
            this.#emit(cm - 1);
          }}
        >
          <sv-icon name="chevron-down" size="sm"></sv-icon>
        </button>
      </div>
    </div>`;
  }

  // ---------- Wheel ----------

  get #scroller(): HTMLElement | null {
    return this.renderRoot.querySelector(".scroller");
  }

  /** The rendered row height; 0 while the wheel has no layout (e.g. hidden). */
  #rowHeight(): number {
    return this.renderRoot.querySelector(".row")?.getBoundingClientRect().height ?? 0;
  }

  #cmAt(scrollTop: number): number | undefined {
    const row = this.#rowHeight();
    return row > 0 ? clampCm(MIN_CM + Math.round(scrollTop / row)) : undefined;
  }

  #scrollToValue(): void {
    const scroller = this.#scroller;
    const row = this.#rowHeight();
    if (!scroller || row === 0) {
      return;
    }
    const top = (this.#cm - MIN_CM) * row;
    if (Math.abs(scroller.scrollTop - top) > 1) {
      scroller.scrollTop = top;
    }
    this._center = this.#cm;
  }

  readonly #onScroll = (): void => {
    const scroller = this.#scroller;
    if (!scroller) {
      return;
    }
    this._center = this.#cmAt(scroller.scrollTop);
    if (!("onscrollend" in globalThis)) {
      clearTimeout(this.#settle);
      this.#settle = setTimeout(this.#onScrollEnd, SCROLL_SETTLE_MS);
    }
  };

  #commitScroll(): number | undefined {
    const scroller = this.#scroller;
    const cm = scroller ? this.#cmAt(scroller.scrollTop) : undefined;
    if (cm !== undefined && cm !== this.#cm) {
      this.#emit(cm);
    }
    return cm;
  }

  readonly #onScrollEnd = (): void => {
    if (!this.disabled) {
      this.#commitScroll();
    }
  };

  #renderWheel(cm: number) {
    const center = this._center ?? cm;
    return html`<div part="field" class="field wheel">
      <div class="fade top" aria-hidden="true"></div>
      <div class="fade bottom" aria-hidden="true"></div>
      <div
        class="scroller"
        tabindex=${this.disabled ? "-1" : "0"}
        role="spinbutton"
        aria-valuemin=${MIN_CM}
        aria-valuemax=${MAX_CM}
        aria-valuenow=${center}
        aria-valuetext="${center} cm"
        aria-label=${this.label ?? nothing}
        aria-invalid=${typeof this.validationError === "string" && this.validationError !== "" ? "true" : nothing}
        aria-describedby=${fieldDescriptionIds(this.description, this.validationError, this._correction === undefined ? undefined : "correction") ?? nothing}
        aria-disabled=${this.disabled ? "true" : nothing}
        @scroll=${this.#onScroll}
        @scrollend=${this.#onScrollEnd}
        @keydown=${this.#onKeyDown}
      >
        <div class="rows" aria-hidden="true">
          ${VALUES.map((row) => {
            const distance = Math.abs(row - center);
            let place = "";
            if (distance === 0) {
              place = "center";
            } else if (distance === 1) {
              place = "near";
            }
            return html`<div class="row ${place}">${row} cm</div>`;
          })}
        </div>
      </div>
    </div>`;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (this.resolvedMode !== "wheel") {
      this.#resize?.disconnect();
      this.#resize = undefined;
      return;
    }
    if (!this.#resize && typeof ResizeObserver !== "undefined") {
      // The wheel can first get a size later (inside a dialog that opens): place it then.
      this.#resize = new ResizeObserver(() => {
        this.#scrollToValue();
      });
      const scroller = this.#scroller;
      if (scroller) {
        this.#resize.observe(scroller);
      }
    }
    if (changed.has("value") || changed.has("mode") || changed.has("_coarse")) {
      this.#scrollToValue();
    }
  }

  protected override render() {
    const cm = this.#cm;
    const correction =
      this._correction === undefined
        ? ""
        : this.ui.text("heightInput.corrected", {
            value: this._correction,
            min: MIN_CM,
            max: MAX_CM,
          });
    return html`${this.resolvedMode === "wheel" ? this.#renderWheel(cm) : this.#renderStepper(cm)}
      ${typeof this.description === "string" && this.description !== "" ? html`<span id="field-description" class="sv-sr-only">${this.description}</span>` : nothing}
      <span id="field-error" class="sv-field-error" role="alert"
        >${this.validationError ?? ""}</span
      >
      <span id="field-correction" class="sv-field-correction" role="status" aria-atomic="true"
        >${correction}</span
      >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-height-input": SvHeightInput;
  }
}
