import { css } from "lit";

export const fitOverlayStyles = css`
  .callouts {
    --_sv-fit-reveal-duration: 100ms;
    --_sv-fit-reveal-ease: cubic-bezier(0.23, 1, 0.32, 1);
    position: absolute;
    inset: 0;
    gap: calc(var(--_sv-spacing) * 2.5);
    padding: calc(var(--_sv-spacing) * 3) calc(var(--_sv-spacing) * 2);
    padding-block-end: calc(var(--_sv-spacing) * 11.5 + var(--_sv-caption-lift));
    visibility: hidden;
    transition: visibility 0s linear var(--_sv-fit-reveal-duration);
  }
  .callouts[data-open] {
    --_sv-fit-reveal-duration: 200ms;
    --_sv-fit-reveal-ease: cubic-bezier(0.16, 1, 0.3, 1);
    visibility: visible;
    transition-delay: 0s;
  }
  .annotation,
  .anchor {
    opacity: 0;
    transition:
      opacity var(--_sv-fit-reveal-duration) var(--_sv-fit-reveal-ease),
      transform var(--_sv-fit-reveal-duration) var(--_sv-fit-reveal-ease);
  }
  .callouts[data-open] .annotation,
  .callouts[data-open] .anchor {
    opacity: 1;
    transform: none;
  }
  .annotation {
    --_sv-fit-emphasis: 0;
    position: absolute;
    inset: 0;
    pointer-events: none;
    transform-origin: var(--_sv-point-x) var(--_sv-point-y);
    transform: scale(0.94);
  }
  .annotation:has(.callout[data-active]),
  .callouts:not([data-pinned]) .annotation:has(.callout:focus-visible) {
    --_sv-fit-emphasis: 1;
    z-index: 1;
  }
  @media (hover: hover) {
    .callouts:not([data-pinned]) .annotation:has(.callout:hover) {
      --_sv-fit-emphasis: 1;
      z-index: 1;
    }
  }
  .callout {
    position: absolute;
    left: var(--_sv-card-x);
    top: var(--_sv-card-y);
    inline-size: max-content;
    min-inline-size: min(calc(var(--_sv-spacing) * 31), calc(50% - var(--_sv-spacing) * 4));
    max-inline-size: calc(50% - var(--_sv-spacing) * 4);
    padding: 0;
    border: 0;
    border-radius: var(--_sv-radius-xl);
    background: none;
    font: inherit;
    text-align: start;
    pointer-events: auto;
    cursor: pointer;
  }
  /* Also reveal on the first open render and when a tiny-frame verdict becomes visible. */
  @starting-style {
    .callouts[data-open] .annotation {
      opacity: 0;
      transform: scale(0.94);
    }
    .callouts[data-open] .anchor {
      opacity: 0;
      transform: scale(0.7);
    }
  }
  .leader {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    opacity: calc(0.6 + 0.4 * var(--_sv-fit-emphasis));
    stroke-dasharray: 6 5;
    stroke-linecap: round;
    transition: opacity 260ms ease;
  }
  .leader-halo {
    stroke: rgb(255 255 255 / 0.55);
    stroke-width: calc(2.5px + 1px * var(--_sv-fit-emphasis));
    transition: stroke-width 220ms ease;
  }
  .leader-stroke {
    stroke: color-mix(
      in srgb,
      var(--_sv-foreground) calc(38% + 22% * var(--_sv-fit-emphasis)),
      transparent
    );
    stroke-width: 1.25px;
    transition: stroke 220ms ease;
  }
  .callout sv-fit-callout {
    display: block;
  }
  .callout sv-fit-callout::part(card) {
    min-inline-size: 0;
    padding: calc(var(--_sv-spacing) * 2.5) calc(var(--_sv-spacing) * 3.5);
    gap: var(--_sv-spacing);
    background: var(--_sv-background);
    box-shadow: 0 calc(4px + 6px * var(--_sv-fit-emphasis))
      calc(16px + 12px * var(--_sv-fit-emphasis))
      rgb(0 0 0 / calc(0.1 + 0.06 * var(--_sv-fit-emphasis)));
    transform: scale(calc(1 + 0.03 * var(--_sv-fit-emphasis)));
  }
  .callout sv-fit-callout::part(label),
  .callout sv-fit-callout::part(verdict) {
    white-space: normal;
    overflow-wrap: anywhere;
    overflow: visible;
    text-overflow: clip;
    text-box: normal;
    line-height: 1.25;
  }
  .callout sv-fit-callout::part(verdict) {
    color: var(--_sv-muted-foreground);
  }
  .callout sv-fit-callout::part(dot) {
    inline-size: calc(var(--_sv-spacing) * 1.5);
    block-size: calc(var(--_sv-spacing) * 1.5);
  }
  .anchor {
    display: none;
    transform: scale(0.7);
    position: absolute;
    inline-size: calc(var(--_sv-spacing) * 4);
    block-size: calc(var(--_sv-spacing) * 4);
    margin: 0;
    padding: 0;
    translate: -50% -50%;
    border: 2px solid var(--_sv-background);
    border-radius: var(--_sv-radius-full);
    background: var(--_sv-foreground);
    box-shadow: 0 0 0 1px var(--_sv-foreground);
    pointer-events: auto;
    cursor: pointer;
  }
  .anchor[aria-pressed="true"] {
    scale: 1.2;
  }
  .anchor:focus-visible {
    outline: 2px solid var(--_sv-ring);
    outline-offset: 3px;
  }
  .callout:focus-visible {
    outline: 2px solid var(--_sv-ring);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .callouts,
    .annotation,
    .anchor {
      transition: none;
    }
  }
  /* Small-ish frames keep every verdict visible in a compact legend. Layout is based on
     the actual fitted image, including when a wide dialog is short. */
  @container sv-try-on-image (max-width: 20rem) or (max-height: 22rem) {
    .callouts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-content: end;
      align-items: end;
      gap: calc(var(--_sv-spacing) * 1);
      padding: calc(var(--_sv-spacing) * 1.5);
      /* Keep the bottom-right provenance text clear of the compact verdicts. */
      padding-block-end: calc(var(--_sv-spacing) * 11.5 + var(--_sv-caption-lift));
    }
    .leader,
    .anchor {
      display: none;
    }
    .annotation {
      display: block;
      position: static;
      transform-origin: center;
      min-inline-size: 0;
    }
    .callout {
      position: static;
      inline-size: 100%;
      min-inline-size: 0;
      max-inline-size: none;
    }
    .callout sv-fit-callout::part(card) {
      transform: none;
      padding: calc(var(--_sv-spacing) * 1.5);
      gap: calc(var(--_sv-spacing) * 1.5);
      border-radius: var(--_sv-radius-lg);
    }
    .callout sv-fit-callout::part(label) {
      font-size: calc(var(--_sv-root) * 0.6875);
      line-height: 1.2;
    }
    .callout sv-fit-callout::part(verdict) {
      font-size: calc(var(--_sv-root) * 0.625);
      line-height: 1.2;
    }
  }
  /* Only genuinely tiny frames use a single host-selected verdict. */
  @container sv-try-on-image (max-width: 10rem) or (max-height: 11rem) {
    .annotation {
      display: none;
    }
    .annotation:has(.callout[data-active]) {
      display: block;
      position: absolute;
      top: auto;
      left: calc(var(--_sv-spacing) * 2);
      right: calc(var(--_sv-spacing) * 2);
      bottom: calc(var(--_sv-spacing) * 2);
    }
    .anchor {
      display: block;
    }
    .anchor::after {
      content: "";
      position: absolute;
      inset: calc(var(--_sv-spacing) * -3);
    }
    .callouts[data-open]:has(.callout[data-active]) ~ .image-caption {
      visibility: hidden;
    }
  }
`;
