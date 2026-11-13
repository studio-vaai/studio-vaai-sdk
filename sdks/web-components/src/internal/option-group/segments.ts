import { ItemDisplay, itemDisplayText } from "@studio-vaai/core";
import { css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { Option } from "./option.js";

import { itemGlyphIcon } from "../item-display.js";
import { isHex } from "../theme/color.js";
import { renderOptionMark } from "./option-mark.js";

export const segmentStyles = css`
  .group {
    display: inline-flex;
    align-items: center;
    max-inline-size: 100%;
    padding: 1px;
    border-radius: var(--_sv-radius-full);
    background: var(--_sv-glass);
    box-shadow: inset 0 0 0 1px var(--_sv-glass-border);
    backdrop-filter: blur(4px);
  }
  .segment {
    appearance: none;
    position: relative;
    margin: 0;
    border: 0;
    display: inline-flex;
    align-items: center;
    gap: calc(var(--_sv-spacing) * 1.5);
    min-inline-size: 0;
    block-size: calc(var(--_sv-spacing) * 7);
    padding-inline: calc(var(--_sv-spacing) * 2) calc(var(--_sv-spacing) * 2.5);
    border-radius: var(--_sv-radius-full);
    background: transparent;
    color: var(--_sv-foreground);
    font-family: inherit;
    font-size: var(--_sv-text-xs);
    line-height: 1;
    font-weight: var(--_sv-font-weight-normal);
    cursor: pointer;
    outline: none;
    transition:
      background-color var(--_sv-duration-fast) var(--_sv-ease),
      color var(--_sv-duration-fast) var(--_sv-ease);
  }
  .group:has(.option-mark) .segment {
    padding-inline-end: calc(var(--_sv-spacing) * 4.5);
  }
  .segment[aria-pressed="true"] {
    background: var(--_sv-control);
    color: var(--_sv-foreground);
    font-weight: var(--_sv-font-weight-medium);
    box-shadow: inset 0 0 0 1px var(--_sv-foreground);
  }
  .segment:focus-visible {
    box-shadow: 0 0 0 2px var(--_sv-ring);
  }
  .segment:disabled {
    cursor: default;
    opacity: 0.4;
  }
  .segment[data-status="sold-out"]:not([aria-pressed="true"]) {
    color: var(--_sv-muted-foreground);
    opacity: 0.5;
  }
  .name {
    display: grid;
    min-inline-size: 0;
  }
  .image,
  .color {
    inline-size: calc(var(--_sv-spacing) * 4);
    block-size: calc(var(--_sv-spacing) * 4);
    flex: none;
    border-radius: 50%;
    object-fit: cover;
  }
  .name span {
    grid-area: 1 / 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Reserve the selected weight's width, so changing value never shifts adjacent segments. */
  .measure {
    visibility: hidden;
    font-weight: var(--_sv-font-weight-medium);
    pointer-events: none;
  }
`;

function renderDisplay(display: Option["display"]) {
  if (ItemDisplay.Glyph.instanceOf(display)) {
    return html`<sv-icon name=${itemGlyphIcon[display.inner.glyph]}></sv-icon>`;
  }
  if (ItemDisplay.Image.instanceOf(display)) {
    return html`<img class="image" src=${display.inner.url} alt="" draggable="false" />`;
  }
  if (ItemDisplay.Color.instanceOf(display)) {
    return html`<span
      class="color"
      style=${isHex(display.inner.hex) ? `background: ${display.inner.hex}` : nothing}
      aria-hidden="true"
    ></span>`;
  }
  return nothing;
}

export function renderSegments(
  options: readonly Option[],
  label: string | undefined,
  onSelect: (key: string) => void,
) {
  return html`<div part="group" class="group" role="group" aria-label=${label ?? nothing}>
    ${repeat(
      options,
      (option) => option.key,
      (option, index) =>
        html`<button
          part="segment"
          class="segment"
          type="button"
          aria-pressed=${option.selected ? "true" : "false"}
          data-status=${option.status ?? nothing}
          aria-disabled=${option.status === "sold-out" ? "true" : nothing}
          aria-describedby=${(option.description?.length ?? 0) > 0 ? `option-description-${String(index)}` : nothing}
          ?disabled=${option.disabled}
          @click=${() => {
            if (!option.disabled) {
              onSelect(option.key);
            }
          }}
        >
          ${renderDisplay(option.display)} ${renderOptionMark(option.mark)}
          <span class="name"
            ><span class="measure" aria-hidden="true">${itemDisplayText(option.display)}</span
            ><span>${itemDisplayText(option.display)}</span></span
          >
          ${(option.description?.length ?? 0) > 0 ? html`<span id=${`option-description-${String(index)}`} hidden>${option.description}</span>` : nothing}
        </button>`,
    )}
  </div>`;
}
