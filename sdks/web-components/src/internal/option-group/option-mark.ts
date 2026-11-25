import { css, html, nothing } from "lit";

/**
 * A try-on picker's check on an option already tried: `tried` on any such option, `current` on
 * the selected size once it was tried.
 */
export type OptionMark = "tried" | "current";

export const optionMarkStyles = css`
  .option-mark {
    position: absolute;
    z-index: 1;
    inset-block-start: 1px;
    inset-inline-end: 1px;
    display: grid;
    place-items: center;
    inline-size: calc(var(--_sv-spacing) * 3.75);
    block-size: calc(var(--_sv-spacing) * 3.75);
    border-radius: 50%;
    background: #fff;
    color: #000;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.16);
    pointer-events: none;
    --_sv-icon-stroke: 2.5;
  }
  .option-mark > sv-icon {
    --_sv-icon-size: calc(var(--_sv-spacing) * 2.5);
  }
  .option-mark[data-mark="current"] {
    background: #000;
    color: #fff;
    box-shadow: 0 0 0 1px #fff;
  }
`;

export function renderOptionMark(mark: OptionMark | undefined) {
  return mark === undefined
    ? nothing
    : html`<span class="option-mark" data-mark=${mark} aria-hidden="true">
        <sv-icon name="check"></sv-icon>
      </span>`;
}
