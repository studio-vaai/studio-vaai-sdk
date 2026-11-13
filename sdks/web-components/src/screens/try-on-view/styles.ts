import { css } from "lit";

/** Layout for the shared variant picker and the result controls. */
export const tryOnViewStyles = css`
  :host {
    container: sv-try-on-view / inline-size;
    display: block;
    block-size: 100%;
    min-block-size: 0;
    color: var(--_sv-foreground);
  }
  sv-screen::part(stage) {
    background: transparent;
    border-radius: 0;
  }
  sv-image {
    block-size: 100%;
    min-block-size: 0;
  }
  sv-image[data-pending] {
    position: absolute;
    inset: 0;
    visibility: hidden;
  }
  sv-image[data-result]:not([data-managed]) {
    animation: sv-result-in 240ms ease-out both;
  }
  @keyframes sv-result-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .panel,
  .result-summary {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }
  .result-summary {
    gap: var(--_sv-screen-gap);
  }
  .panel > *,
  .result-summary > * {
    flex: none;
  }
  .picker-clip {
    overflow: clip;
  }
  .picker-heading {
    margin: 0;
    font-size: calc(var(--_sv-root) * 0.8125);
    line-height: 1.25;
    font-weight: var(--_sv-font-weight-medium);
  }
  .picker-title,
  .picker-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: calc(var(--_sv-spacing) * 2);
    inline-size: 100%;
    padding: calc(var(--_sv-spacing) * 2.5) calc(var(--_sv-spacing) * 3.5);
  }
  .picker-toggle {
    appearance: none;
    border: 0;
    border-radius: var(--_sv-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .picker-toggle:focus-visible {
    outline: 2px solid var(--_sv-ring);
    outline-offset: -2px;
  }
  .picker-toggle sv-icon {
    flex: none;
  }
  .picker-body {
    padding: 0 calc(var(--_sv-spacing) * 3.5) calc(var(--_sv-spacing) * 3);
  }
  .picker-error {
    margin-block-start: calc(var(--_sv-spacing) * 3);
  }
  .primary-label {
    animation: sv-cta-label 140ms ease-out;
  }
  @keyframes sv-cta-label {
    from {
      opacity: 0.85;
    }
    to {
      opacity: 1;
    }
  }
  .history-row {
    display: flex;
    align-items: center;
    gap: calc(var(--_sv-spacing) * 2);
    min-inline-size: 0;
  }
  .history {
    display: flex;
    flex: 1;
    min-inline-size: 0;
    gap: calc(var(--_sv-spacing) * 1.5);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .history sv-history-chip::part(chip):focus-visible {
    box-shadow: inset 0 0 0 2px var(--_sv-ring);
  }
  .result-fold:not([inert]) .history-row[inert] {
    opacity: 0.5;
  }
  .result-toolbar {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--_sv-spacing) * 2);
    max-inline-size: 100%;
    margin-inline-start: auto;
  }
  @container sv-try-on-view (min-width: 40rem) {
    .panel {
      gap: var(--_sv-screen-gap);
    }
    .picker-card {
      background: var(--_sv-surface-raised);
      backdrop-filter: none;
      box-shadow:
        inset 0 0 0 1px var(--_sv-glass-border),
        var(--_sv-shadow-sm);
      color: var(--_sv-foreground);
    }
    .history {
      display: none;
    }
    .history-row:not(:has(.result-toolbar)) {
      display: none;
    }
  }
  @container sv-try-on-view (max-width: 39.999rem) {
    /* Gaps in the overlaid controls must let taps reach the photo underneath. */
    sv-screen::part(panel) {
      pointer-events: none;
    }
    .history,
    .result-toolbar,
    .result-summary > sv-fit-score,
    .picker-slot {
      pointer-events: auto;
    }
    .history-row {
      /* Reserve the strip before another result arrives; a new history chip cannot zoom the photo. */
      min-block-size: calc(var(--_sv-spacing) * 7 + 2px);
    }
    .result-fold,
    .picker-slot {
      display: grid;
      grid-template-rows: 1fr;
    }
    .result-clip,
    .picker-clip {
      min-block-size: 0;
    }
    .result-clip {
      overflow: hidden;
    }
    .result-fold {
      transition:
        grid-template-rows 250ms cubic-bezier(0.22, 1, 0.36, 1),
        opacity 160ms ease-out 140ms;
    }
    .result-fold[inert] {
      grid-template-rows: 0fr;
      opacity: 0;
      transition:
        grid-template-rows 250ms cubic-bezier(0.22, 1, 0.36, 1),
        opacity 110ms ease-out;
    }
    .picker-slot {
      transition: grid-template-rows 250ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .picker-slot[inert] {
      grid-template-rows: 0fr;
    }
    /* Fade the controls so the glass can sample the photo throughout the slide. */
    .picker-body {
      opacity: 1;
      transition: opacity 200ms ease-out 75ms;
    }
    .picker-slot[inert] .picker-body {
      opacity: 0;
      transition: opacity 100ms ease-out;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .result-fold,
    .result-fold[inert],
    .picker-slot,
    .picker-body,
    .picker-slot[inert] .picker-body {
      transition: none;
    }
    .primary-label,
    sv-image[data-result] {
      animation: none;
    }
  }
  .error {
    margin-block-end: calc(var(--_sv-spacing) * 2);
  }
  .sold-out {
    margin: 0 0 calc(var(--_sv-spacing) * 2);
    color: var(--_sv-muted-foreground);
    font-size: var(--_sv-text-sm);
  }
  .image-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    container: sv-try-on-image / size;
  }
  .download {
    position: absolute;
    inset-inline-end: calc(var(--_sv-spacing) * 3);
    inset-block-start: calc(var(--_sv-spacing) * 3);
    pointer-events: auto;
  }
  .download::part(button) {
    inline-size: calc(var(--_sv-spacing) * 9);
    min-inline-size: 0;
    block-size: calc(var(--_sv-spacing) * 9);
    padding: 0;
    border-radius: var(--_sv-radius-full);
    background: var(--_sv-photo-overlay);
    box-shadow: inset 0 0 0 1px var(--_sv-glass-border);
    color: var(--_sv-photo-overlay-foreground);
    backdrop-filter: blur(4px);
  }
  .download::part(label) {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .progress {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    text-wrap: balance;
    padding: calc(var(--_sv-spacing) * 6);
    color: var(--_sv-foreground);
    font-size: var(--_sv-text-base);
  }
  .progress span {
    animation: sv-generating-message-in 500ms cubic-bezier(0.32, 0.72, 0, 1) both;
  }
  @keyframes sv-generating-message-in {
    from {
      transform: translateY(calc(var(--_sv-root) * 0.6));
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .progress span {
      animation: none;
    }
  }
  @container sv-try-on-image (max-width: 20rem) or (max-height: 22rem) {
    .download {
      inset-inline-end: calc(var(--_sv-spacing) * 2);
      inset-block-start: calc(var(--_sv-spacing) * 2);
    }
    .download::part(button) {
      inline-size: calc(var(--_sv-spacing) * 8);
      block-size: calc(var(--_sv-spacing) * 8);
    }
  }
`;
