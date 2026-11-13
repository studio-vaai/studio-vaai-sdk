import { html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";

import type { SvTryOnFitCallout } from "./fit.js";

import { imagePointStyle } from "../../media/image-framing.js";

interface FitOverlay {
  items: readonly SvTryOnFitCallout[];
  open: boolean;
  activeKey: string | undefined;
  onSelect: (key: string | undefined) => void;
}

/** The Try-on image's controlled annotation layer. Keep it mounted for the exit transition. */
export function renderFitOverlay({ items, open, activeKey, onSelect }: FitOverlay) {
  const callouts = items.filter(
    (item) =>
      Number.isFinite(item.x) &&
      Number.isFinite(item.y) &&
      item.x >= 0 &&
      item.x <= 1 &&
      item.y >= 0 &&
      item.y <= 1,
  );
  return html`<div
    class="callouts"
    ?data-open=${open}
    ?data-pinned=${callouts.some((item) => item.key === activeKey)}
    ?inert=${!open}
    aria-hidden=${open ? "false" : "true"}
  >
    ${repeat(
      callouts,
      (item) => item.key,
      (item) => {
        const point = imagePointStyle(item.x, item.y);
        const pinned = activeKey === item.key;
        const label = [item.label ?? item.key, item.description]
          .filter((text) => text !== undefined && text !== "")
          .join(": ");
        const toggle = () => {
          onSelect(pinned ? undefined : item.key);
        };
        return html`<div
            class="annotation"
            data-x=${item.x}
            data-y=${item.y}
            style=${styleMap({ "--_sv-point-x": point.left, "--_sv-point-y": point.top })}
          >
            <svg class="leader" aria-hidden="true">
              <line class="leader-halo"></line>
              <line class="leader-stroke"></line>
            </svg>
            <button
              type="button"
              class="callout"
              ?data-active=${pinned}
              aria-label=${label}
              aria-pressed=${pinned ? "true" : "false"}
              @click=${toggle}
            >
              <sv-fit-callout
                .label=${item.label}
                .description=${item.description}
                .variant=${item.variant}
              ></sv-fit-callout>
            </button>
          </div>
          <button
            class="anchor"
            type="button"
            style=${styleMap(point)}
            aria-label=${label}
            aria-pressed=${pinned ? "true" : "false"}
            @click=${toggle}
          ></button>`;
      },
    )}
  </div>`;
}
