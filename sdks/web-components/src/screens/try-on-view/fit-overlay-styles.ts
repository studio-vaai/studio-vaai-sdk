import { css } from "lit";

export const fitOverlayStyles = css`
  .callouts {
    --_sv-fit-reveal-duration: 100ms;
    --_sv-fit-reveal-ease: cubic-bezier(0.23, 1, 0.32, 1);
    /* The least room between a card and the person. */
    --_sv-fit-clearance: calc(var(--_sv-spacing) * 4);
    position: absolute;
    inset: 0;
    gap: calc(var(--_sv-spacing) * 2.5);
    /* Unused by the absolute layout, so it carries the clearance to the layout controller. */
    column-gap: var(--_sv-fit-clearance);
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
    max-inline-size: calc(50% - var(--_sv-spacing) * 4);
    padding: 0;
    border: 0;
    border-radius: var(--_sv-radius-lg);
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
    stroke-linejoin: round;
    fill: none;
    transition: opacity 260ms ease;
  }
  /* The leader's last stretch: its steps fade out towards the anchor (opacity set per step). */
  .leader-fade line {
    stroke-linecap: butt;
  }
  /* Where a leader ends: a soft white halo dot on the garment, legible on white, dark, striped
     and furry cloth alike — white on any theme, as it marks the photo, not the interface. */
  .callouts[data-layout="columns"] .anchor {
    display: block;
    inline-size: calc(var(--_sv-spacing) * 1.75);
    block-size: calc(var(--_sv-spacing) * 1.75);
    border: 0;
    background: var(--_sv-media-foreground);
    /* A hairline and a soft shadow carry it on white cloth; the white glow on dark cloth. */
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--_sv-media-overlay) 40%, transparent),
      0 0 0 calc(var(--_sv-spacing) * 0.75)
        color-mix(in srgb, var(--_sv-media-foreground) 45%, transparent),
      0 0 calc(var(--_sv-spacing) * 2.5) calc(var(--_sv-spacing) * 1.25)
        color-mix(in srgb, var(--_sv-media-foreground) 55%, transparent),
      0 1px calc(var(--_sv-spacing) * 1.5) var(--_sv-media-overlay);
  }
  .callouts[data-layout="columns"] .anchor::after {
    content: "";
    position: absolute;
    inset: calc(var(--_sv-spacing) * -2.5);
  }
  /* The length is read at the front hem: a short horizontal tick across it, not a dot. */
  .callouts[data-layout="columns"] .anchor[data-marker="tick"] {
    inline-size: calc(var(--_sv-spacing) * 5.5);
    block-size: 3px;
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--_sv-media-overlay) 40%, transparent),
      0 0 0 calc(var(--_sv-spacing) * 0.5)
        color-mix(in srgb, var(--_sv-media-foreground) 45%, transparent),
      0 0 calc(var(--_sv-spacing) * 2) calc(var(--_sv-spacing) * 0.75)
        color-mix(in srgb, var(--_sv-media-foreground) 50%, transparent),
      0 1px calc(var(--_sv-spacing) * 1.5) var(--_sv-media-overlay);
  }
  /* The marker of the callout pinned or pointed at grows and comes to full strength, and its
     leader shows whole, fade included. */
  .callouts[data-layout="columns"] .anchor {
    transition:
      opacity var(--_sv-fit-reveal-duration) var(--_sv-fit-reveal-ease),
      transform var(--_sv-fit-reveal-duration) var(--_sv-fit-reveal-ease),
      scale 180ms ease;
  }
  .callouts[data-open][data-layout="columns"] .anchor {
    opacity: 0.9;
  }
  .callouts[data-open][data-layout="columns"] .anchor[aria-pressed="true"],
  .callouts[data-open][data-layout="columns"] .annotation:has(.callout[data-active]) + .anchor,
  .callouts[data-open][data-layout="columns"]:not([data-pinned])
    .annotation:has(.callout:focus-visible)
    + .anchor {
    opacity: 1;
    scale: 1.75;
  }
  .callouts[data-layout="columns"] .anchor[data-marker="tick"][aria-pressed="true"],
  .callouts[data-layout="columns"]
    .annotation:has(.callout[data-active])
    + .anchor[data-marker="tick"] {
    scale: 1.35 1.75;
  }
  .annotation:has(.callout[data-active]) .leader-fade line {
    opacity: 1;
  }
  @media (hover: hover) {
    .callouts[data-open][data-layout="columns"]:not([data-pinned])
      .annotation:has(.callout:hover)
      + .anchor {
      opacity: 1;
      scale: 1.75;
    }
    .callouts[data-layout="columns"]:not([data-pinned])
      .annotation:has(.callout:hover)
      + .anchor[data-marker="tick"] {
      scale: 1.35 1.75;
    }
    .callouts:not([data-pinned]) .annotation:has(.callout:hover) .leader-fade line {
      opacity: 1;
    }
  }
  /* A phone's frame: a shorter tick. */
  @container sv-try-on-image (max-width: 30rem) {
    .callouts[data-layout="columns"] .anchor[data-marker="tick"] {
      inline-size: calc(var(--_sv-spacing) * 4.5);
    }
  }
  .marker {
    display: none;
  }
  /* Too little room even then: numbered anchors, and the cards as a list in the free area. */
  .callouts[data-layout="legend"] .leader {
    display: none;
  }
  .callouts[data-layout="legend"] .callout {
    display: flex;
    align-items: center;
    gap: calc(var(--_sv-spacing) * 1.5);
  }
  .callouts[data-layout="legend"] .marker {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    inline-size: calc(var(--_sv-spacing) * 5);
    block-size: calc(var(--_sv-spacing) * 5);
    border: 1.5px solid var(--_sv-background);
    border-radius: var(--_sv-radius-full);
    background: var(--_sv-foreground);
    color: var(--_sv-background);
    font-size: calc(var(--_sv-root) * 0.625);
    font-weight: var(--_sv-font-weight-semibold);
    line-height: 1;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
  }
  .callouts[data-layout="legend"] .anchor {
    display: block;
    inline-size: auto;
    block-size: auto;
    border: 0;
    background: none;
    box-shadow: none;
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
  /* Compact cards, so less of the garment is covered. */
  .callout sv-fit-callout::part(card) {
    min-inline-size: 0;
    padding: calc(var(--_sv-spacing) * 1.75) calc(var(--_sv-spacing) * 2.5);
    gap: calc(var(--_sv-spacing) * 1.25);
    border-radius: var(--_sv-radius-lg);
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
  .callout sv-fit-callout::part(label) {
    font-size: calc(var(--_sv-root) * 0.6875);
  }
  .callout sv-fit-callout::part(verdict) {
    font-size: calc(var(--_sv-root) * 0.625);
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
