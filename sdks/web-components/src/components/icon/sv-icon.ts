import { css, html, nothing } from "lit";

import { typedKeys } from "../../internal/typed.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";
import { SV_ICONS } from "./icons.js";

export type SvIconName = keyof typeof SV_ICONS;
export const SV_ICON_NAMES: readonly SvIconName[] = typedKeys(SV_ICONS);

export const SV_ICON_SIZES = ["sm", "md"] as const;
export type SvIconSize = (typeof SV_ICON_SIZES)[number];

export interface SvIconProps {
  /** Which icon, by its lucide name. Unset or unknown draws nothing. */
  name?: SvIconName | undefined;
  /** `sm` (12px) for chevrons in small rows, `md` (16px) everywhere else. */
  size?: SvIconSize | undefined;
  /**
   * Announced to screen readers, e.g. "Close". Leave it out when the icon only decorates
   * something that already says what it is (a button with a label).
   */
  label?: string | undefined;
}

/**
 * `<sv-icon>` — an icon by `name`, drawn in the current text color.
 *
 * Hidden from screen readers unless it has a `label`. The shapes are built in, so nothing is
 * loaded.
 *
 * @csspart svg - The `<svg>`.
 */
export class SvIcon extends SvElement implements SvIconProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: inline-flex;
        flex: none;
        vertical-align: middle;
        --_sv-icon-size: calc(var(--_sv-spacing) * 4);
      }
      :host([size="sm"]) {
        --_sv-icon-size: calc(var(--_sv-spacing) * 3);
      }
      /* A parent can thin the line (the screen header does) through --_sv-icon-stroke. */
      svg {
        stroke-width: var(--_sv-icon-stroke, 2);
        display: block;
        inline-size: var(--_sv-icon-size);
        block-size: var(--_sv-icon-size);
      }
    `,
  ];

  static override properties = {
    name: { reflect: true },
    size: { reflect: true },
    label: {},
  };

  declare name: SvIconName | undefined;
  /** Unset renders `md`. */
  declare size: SvIconSize | undefined;
  declare label: string | undefined;

  constructor() {
    super();
    this.name = undefined;
    this.size = undefined;
    this.label = undefined;
  }

  protected override render() {
    const { name } = this;
    // An attribute can carry any string; only known names draw.
    if (name === undefined || !Object.hasOwn(SV_ICONS, name)) {
      return nothing;
    }
    const labelled = this.label !== undefined && this.label !== "";
    return html`<svg
      part="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      role=${labelled ? "img" : nothing}
      aria-label=${labelled ? this.label : nothing}
      aria-hidden=${labelled ? nothing : "true"}
      focusable="false"
    >
      ${SV_ICONS[name]}
    </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-icon": SvIcon;
  }
}
