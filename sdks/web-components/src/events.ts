/**
 * Events more than one element fires. Each is declared once here, so an element's listener is
 * typed the same everywhere.
 */

/** `sv-change`: the shopper asked for a new value. The owner decides whether to set it. */
export interface SvChangeDetail {
  /**
   * The value asked for, of the type of the element's value: a checkbox's `checked`, a height
   * input's cm, a style toggle's option.
   */
  value: boolean | number | string;
}

/** Fires `sv-change` from `element` with the value asked for. */
export function emitChange(element: HTMLElement, value: SvChangeDetail["value"]): void {
  element.dispatchEvent(
    new CustomEvent<SvChangeDetail>("sv-change", {
      detail: { value },
      bubbles: true,
      composed: true,
    }),
  );
}

declare global {
  interface HTMLElementEventMap {
    "sv-change": CustomEvent<SvChangeDetail>;
  }
}
