import { css, unsafeCSS } from "lit";

import { SV_FONT_SANS } from "../internal/theme/tokens.js";

/**
 * Shared base rules for every element's shadow root.
 *
 * The family falls back to today's stack (Inter, then the system font) unless a shop names its
 * own in `--sv-font-sans`. The weight is set too, so a page's light body text never leaks into
 * the flow. Never put the family into a `font` shorthand.
 */
export const svBase = css`
  :host {
    box-sizing: border-box;
    font-family: var(--sv-font-sans, ${unsafeCSS(SV_FONT_SANS)});
    font-weight: var(--_sv-font-weight-normal, 400);
    -webkit-tap-highlight-color: transparent;
  }

  :host([hidden]) {
    display: none !important;
  }

  .sv-sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .sv-field-error,
  .sv-field-correction {
    font-size: var(--_sv-text-sm);
    line-height: 1.5;
  }
  .sv-field-error {
    color: var(--_sv-destructive);
  }
  .sv-field-label {
    margin: 0;
    padding: 0;
  }

  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }

  /* Keep focus independent of selection shadows, including in forced-colors mode. */
  :is(button, input, summary, [tabindex]):focus-visible {
    outline: 2px solid var(--_sv-ring);
    outline-offset: 2px;
  }
  @media (forced-colors: active) {
    :is(button, input, summary, [tabindex]):focus-visible {
      outline: 2px solid Highlight;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 1ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 1ms !important;
    }
  }
`;
