import { html, svg } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";

import type { SvTryOnFitCallout, SvTryOnFitSubjectBand } from "./fit.js";

import { imagePointStyle } from "../../media/image-framing.js";

interface FitOverlay {
  items: readonly SvTryOnFitCallout[];
  /** The person's outline in the image, for placing the cards beside them. */
  subject?: readonly SvTryOnFitSubjectBand[] | undefined;
  open: boolean;
  activeKey: string | undefined;
  onSelect: (key: string | undefined) => void;
}

const unit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * The Try-on image's controlled annotation layer. Keep it mounted for the exit transition.
 * `CalloutLayoutController` places the cards and draws the leaders.
 */
export function renderFitOverlay({ items, subject, open, activeKey, onSelect }: FitOverlay) {
  // Top to bottom, so a legend's numbers read in order down the person.
  const callouts = items
    .filter((item) => unit(item.x) && unit(item.y))
    .toSorted((a, b) => a.y - b.y || a.x - b.x);
  const bands = (subject ?? []).filter(
    (band) =>
      [band.top, band.bottom, band.left, band.right].every((value) => unit(value)) &&
      band.top < band.bottom &&
      band.left <= band.right,
  );
  return html`<div
    class="callouts"
    ?data-open=${open}
    ?data-pinned=${callouts.some((item) => item.key === activeKey)}
    data-subject=${JSON.stringify(bands.map(({ top, bottom, left, right }) => [top, bottom, left, right]))}
    ?inert=${!open}
    aria-hidden=${open ? "false" : "true"}
  >
    ${repeat(
      callouts,
      (item) => item.key,
      (item, index) => {
        const point = imagePointStyle(item.x, item.y);
        const pinned = activeKey === item.key;
        const number = String(index + 1);
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
            data-alternates=${JSON.stringify((item.alternates ?? []).map(({ x, y }) => [x, y]))}
            style=${styleMap({ "--_sv-point-x": point.left, "--_sv-point-y": point.top })}
          >
            <svg class="leader" aria-hidden="true">
              ${svg`<polyline class="leader-halo"></polyline>
              <polyline class="leader-stroke"></polyline>
              <g class="leader-fade"></g>`}
            </svg>
            <button
              type="button"
              class="callout"
              ?data-active=${pinned}
              aria-label=${label}
              aria-pressed=${pinned ? "true" : "false"}
              @click=${toggle}
            >
              <span class="marker" aria-hidden="true">${number}</span>
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
            data-marker=${item.marker ?? "dot"}
            style=${styleMap(point)}
            aria-label=${label}
            aria-pressed=${pinned ? "true" : "false"}
            @click=${toggle}
          >
            <span class="marker" aria-hidden="true">${number}</span>
          </button>`;
      },
    )}
  </div>`;
}
