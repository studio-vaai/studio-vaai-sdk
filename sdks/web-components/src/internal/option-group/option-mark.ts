import { css, html, nothing } from "lit";

/** A tried-on option or the currently selected size in a try-on picker. */
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
    background: #222;
    color: #fff;
    pointer-events: none;
    --_sv-icon-stroke: 2.5;
  }
  .option-mark > sv-icon {
    --_sv-icon-size: calc(var(--_sv-spacing) * 2.5);
  }
  .option-mark[data-mark="current"] {
    background: #fff;
    color: #000;
  }
`;

export function renderOptionMark(mark: OptionMark | undefined) {
  return mark === undefined
    ? nothing
    : html`<span class="option-mark" data-mark=${mark} aria-hidden="true">
        <sv-icon name="check"></sv-icon>
      </span>`;
}
