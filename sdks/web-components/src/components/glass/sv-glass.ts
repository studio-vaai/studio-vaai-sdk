import { css, html } from "lit";

import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvGlassProps {
  /** Use a lighter blur for a surface with a subtle tint and no shadow. */
  variant?: "subtle" | undefined;
}

/**
 * `<sv-glass>` — a frosted surface over the content behind it. Put the controls it holds
 * in the default slot. The surface and its contents share the same rounded edge.
 *
 * @slot - Content on the glass surface.
 * @cssprop --sv-photo-overlay - Override the translucent fill.
 */
export class SvGlass extends SvElement implements SvGlassProps {
  static override properties = {
    variant: { reflect: true },
  };

  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        --_sv-glass-fill: rgb(242 242 240 / 0.5);
        display: block;
        min-inline-size: 0;
        overflow: clip;
        border-radius: var(--_sv-radius);
        background: var(--sv-photo-overlay, var(--_sv-glass-fill));
        backdrop-filter: blur(8px) saturate(1.5);
        box-shadow: 0 2px 16px rgb(0 0 0 / 0.07);
        color: var(--_sv-photo-overlay-foreground);
      }
      :host([data-sv-appearance="dark"]) {
        --_sv-glass-fill: color-mix(in srgb, var(--_sv-surface-raised) 50%, transparent);
      }
      :host([variant="subtle"]) {
        --_sv-glass-fill: color-mix(in srgb, var(--_sv-background) 60%, transparent);
        backdrop-filter: blur(4px);
        box-shadow: none;
      }
    `,
  ];

  declare variant: SvGlassProps["variant"];

  protected override render() {
    return html`<slot></slot>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-glass": SvGlass;
  }
}
