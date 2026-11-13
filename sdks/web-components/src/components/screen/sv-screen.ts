import { css, html } from "lit";

import { LiveStatus } from "../../internal/live-status.js";
import { PanelLayoutController } from "../../internal/panel-layout.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export const SV_SCREEN_PANEL_ALIGNS = ["end", "center"] as const;
export type SvScreenPanelAlign = (typeof SV_SCREEN_PANEL_ALIGNS)[number];
export const SV_SCREEN_PANEL_MODES = ["stack", "overlay", "backdrop"] as const;
export type SvScreenPanelMode = (typeof SV_SCREEN_PANEL_MODES)[number];

/** Header actions supplied by a journey. Standalone screens keep their default behavior. */
export interface SvScreenNavigation {
  back: "available" | "disabled" | "hidden";
  close: boolean;
}

export interface SvScreenProps {
  /** Availability of the header actions, independently of progress. */
  navigation?: SvScreenNavigation | undefined;
  /** The step's title in the header. */
  heading?: string | undefined;
  /** One line under the title. */
  description?: string | undefined;
  /** Something is in flight: back and close are disabled. */
  busy?: boolean | undefined;
  /** Optional localized progress text announced politely. Empty clears the announcement. */
  statusMessage?: string | undefined;
  /** Center the stage across the full screen width above any panel content and actions. */
  stageLayout?: "centered" | undefined;
  /**
   * Where the panel's content sits in its area. `end` puts it right on top of the
   * actions, always the same gap away. `center` is for the exceptions, such as the height
   * input.
   */
  panelAlign?: SvScreenPanelAlign | undefined;
  /**
   * Narrow layout: `stack` places the panel below the stage; `overlay` reserves the panel's
   * resting size and expands over the stage; `backdrop` keeps the stage behind the whole panel.
   * Wide screens always use the split layout. Defaults to `stack`.
   */
  panelMode?: SvScreenPanelMode | undefined;
  /** Frost the panel where it overlays the stage in a narrow layout. */
  panelGlass?: boolean | undefined;
}

/**
 * `<sv-screen>` — the layout of one step of the flow: a header, a stage for the big visual, a
 * panel and the actions.
 *
 * Below 40rem of its own width the parts stack by default. `panelMode="overlay"` reserves the
 * resting panel's height and lets expanded content grow over the stage. `panelMode="backdrop"`
 * keeps the stage behind the full panel, without a reservation. Wider, every mode puts the
 * stage left and the panel and actions right. The actions keep the same place and size on
 * every step, with or without a secondary action. Use `stageLayout="centered"` for a visual
 * that needs the full width, with any controls below it and no reserved button rows.
 *
 * The header shows `heading`, `description`, and the available navigation controls.
 * Back fires `sv-back`. Both buttons use the shared localized names.
 * Inside `sv-dialog`, the close button closes
 * the dialog and the header drags the drawer. `navigation` overrides the default busy lock.
 *
 * @slot stage - The big visual: a photo, the camera, a render. It fills its area.
 * @slot - The panel: details and controls.
 * @slot primary - The main action, e.g. one `sv-button`.
 * @slot secondary - The other action, under it.
 * @slot before-actions - Consent, legal copy, or errors kept together with the actions.
 * @slot description - Rich content below the title; overrides `description`.
 * @slot heading - Composed title content; overrides `heading` inside the shared heading element.
 * @fires sv-back - The back button was pressed.
 * @csspart header - The header row.
 * @csspart back - The back button.
 * @csspart close - The close button.
 * @csspart stage - The stage area.
 * @csspart body - The stage and panel together; normally transparent to the grid layout.
 * @csspart panel - The panel area.
 * @csspart actions - The actions block.
 */
export class SvScreen extends SvElement implements SvScreenProps {
  protected override readonly usesMessages = true;
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        container: sv-screen / inline-size;
        display: block;
        block-size: 100%;
        min-block-size: 0;
        color: var(--_sv-foreground);
      }

      /* The sizes live on .screen, not :host: a container query can't restyle its container. */
      .screen {
        --_sv-screen-inset: calc(var(--_sv-spacing) * 4);
        --_sv-screen-gap: calc(var(--_sv-spacing) * 4);
        --_sv-screen-action-gap: calc(var(--_sv-spacing) * 2);
        block-size: 100%;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        /* The panel takes its content's height while there is room, then scrolls; the stage
           keeps a minimum and takes the rest. */
        grid-template-rows:
          auto minmax(calc(var(--_sv-spacing) * 32), 1fr) minmax(0, max-content)
          auto;
        grid-template-areas: "header" "stage" "panel" "actions";
        padding-block-end: var(--_sv-screen-inset);
      }

      /* ---------- Header ---------- */
      .header {
        grid-area: header;
        display: grid;
        grid-template-columns:
          calc(var(--_sv-spacing) * 10) minmax(0, 1fr)
          calc(var(--_sv-spacing) * 10);
        align-items: center;
        gap: calc(var(--_sv-spacing) * 2);
        padding: calc(var(--_sv-spacing) * 2) calc(var(--_sv-spacing) * 2)
          calc(var(--_sv-spacing) * 3);
        touch-action: none;
      }
      .titles {
        grid-column: 2;
        display: grid;
        text-align: center;
        min-inline-size: 0;
      }
      h2 {
        margin: 0;
        font-size: var(--_sv-text-base);
        line-height: var(--_sv-text-base--line-height);
        font-weight: var(--_sv-font-weight-semibold);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .description {
        margin: 0;
        font-size: var(--_sv-text-sm);
        line-height: 1.4;
        font-weight: var(--_sv-font-weight-light);
        color: var(--_sv-muted-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .icon-button {
        appearance: none;
        margin: 0;
        padding: 0;
        border: 0;
        inline-size: calc(var(--_sv-spacing) * 10);
        block-size: calc(var(--_sv-spacing) * 10);
        display: grid;
        place-items: center;
        border-radius: var(--_sv-radius-full);
        background: transparent;
        color: inherit;
        cursor: pointer;
        /* Back and close are hairlines in the try-on and its design; no fill on hover. */
        --_sv-icon-stroke: 1.25;
        transition: opacity var(--_sv-duration-fast) var(--_sv-ease);
      }
      .icon-button:hover:not(:disabled) {
        opacity: 0.6;
      }
      .icon-button:focus-visible {
        outline: 2px solid var(--_sv-ring);
        outline-offset: 2px;
      }
      .icon-button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      .back[hidden] {
        visibility: hidden;
      }

      .back {
        grid-column: 1;
      }
      .close {
        grid-column: 3;
      }

      /* ---------- Stage ---------- */
      .body {
        display: contents;
      }
      .stage {
        grid-area: stage;
        position: relative;
        display: grid;
        min-block-size: 0;
        margin-inline: var(--_sv-screen-inset);
        border-radius: var(--_sv-radius-lg);
        overflow: hidden;
        background: var(--_sv-muted);
      }
      ::slotted([slot="stage"]) {
        min-block-size: 0;
        block-size: 100%;
        inline-size: 100%;
      }

      /* ---------- Panel ---------- */
      .panel {
        grid-area: panel;
        display: flex;
        flex-direction: column;
        min-block-size: 0;
        overflow-y: auto;
        /* Keep the panel still at its scroll boundaries, including when all content fits. */
        overscroll-behavior: none;
        padding-inline: var(--_sv-screen-inset);
        padding-block-start: var(--_sv-screen-gap);
      }
      /* Auto margins rather than justify-content: overflowing content stays scrollable from its
         top, and when it fits it sits where the alignment says. */
      .panel-content {
        margin-block: auto 0;
      }
      :host([panel-align="center"]) .panel-content {
        margin-block: auto;
      }

      /* ---------- Actions ---------- */
      .actions {
        grid-area: actions;
        padding-inline: var(--_sv-screen-inset);
        padding-block-start: var(--_sv-screen-gap);
      }
      .action-buttons {
        --_sv-action-text-size: calc(var(--_sv-root) * 0.9375);
        display: grid;
        /* Two rows, always: the primary stays put whether a secondary exists or not. The second
           is a text action's height. */
        grid-template-rows: var(--_sv-button-height) calc(var(--_sv-spacing) * 8);
        row-gap: var(--_sv-screen-action-gap);
      }
      slot[name="before-actions"] {
        display: block;
      }
      ::slotted([slot="primary"]),
      ::slotted([slot="secondary"]) {
        display: block;
        inline-size: 100%;
      }

      @container sv-screen (max-width: 39.999rem) {
        :host([panel-mode="overlay"]) .screen,
        :host([panel-mode="backdrop"]) .screen {
          grid-template-rows: auto minmax(0, 1fr) auto;
          grid-template-areas: "header" "body" "actions";
        }
        :host([panel-mode="overlay"]) .body,
        :host([panel-mode="backdrop"]) .body {
          grid-area: body;
          display: grid;
          grid-template: minmax(0, 1fr) / minmax(0, 1fr);
          min-block-size: 0;
        }
        :host([panel-mode="overlay"]) .stage,
        :host([panel-mode="backdrop"]) .stage {
          grid-area: 1 / 1;
          align-self: start;
          block-size: 100%;
        }
        :host([panel-mode="overlay"]) .stage {
          block-size: max(
            0px,
            calc(100% - var(--_sv-panel-resting-size, 0px) - var(--_sv-screen-gap))
          );
        }
        :host([panel-mode="overlay"]) .panel,
        :host([panel-mode="backdrop"]) .panel {
          grid-area: 1 / 1;
          align-self: end;
          max-block-size: 100%;
          padding-block-start: 0;
          z-index: 1;
        }
        :host([panel-mode="backdrop"]) .body {
          /* Clip the photo and its overlaid panel to a single silhouette. */
          margin-inline: var(--_sv-screen-inset);
          clip-path: inset(0 round var(--_sv-radius));
          overflow: clip;
        }
        :host([panel-mode="backdrop"]) .stage {
          margin-inline: 0;
          border-radius: 0;
        }
        :host([panel-mode="backdrop"]) .panel {
          padding-inline: 0;
        }
        :host([panel-mode="backdrop"]) sv-glass.panel {
          /* The body owns the bottom corners shared with the photo. */
          border-end-start-radius: 0;
          border-end-end-radius: 0;
        }
      }

      /* ---------- Wide: stage left, panel and actions right ---------- */
      @container sv-screen (min-width: 40rem) {
        .screen {
          --_sv-screen-inset: calc(var(--_sv-spacing) * 6);
          --_sv-screen-gap: calc(var(--_sv-spacing) * 6);
          grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
          grid-template-rows: auto minmax(0, 1fr) auto;
          grid-template-areas: "header header" "stage panel" "stage actions";
          column-gap: var(--_sv-screen-inset);
        }
        .header {
          padding-inline: calc(var(--_sv-spacing) * 3);
        }
        /* The dialog's title is larger and lighter than the sheet's, as today. */
        h2 {
          font-size: var(--_sv-text-2xl);
          line-height: 1.4;
          font-weight: var(--_sv-font-weight-medium);
        }
        .stage {
          margin-inline: var(--_sv-screen-inset) 0;
        }
        .panel {
          padding-inline: 0 var(--_sv-screen-inset);
          padding-block-start: 0;
        }
        sv-glass.panel {
          border-radius: 0;
          background: transparent;
          backdrop-filter: none;
          box-shadow: none;
        }
        .actions {
          padding-inline: 0 var(--_sv-screen-inset);
        }
      }

      :host([stage-layout="centered"]) .screen {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr) minmax(0, max-content) auto;
        grid-template-areas: "header" "stage" "panel" "actions";
        padding-block-end: var(--_sv-screen-gap);
      }
      :host([stage-layout="centered"]) .body {
        display: contents;
      }
      :host([stage-layout="centered"]) .stage {
        grid-area: stage;
        align-self: stretch;
        block-size: auto;
        margin-block-start: var(--_sv-screen-gap);
        margin-inline: var(--_sv-screen-inset);
        border-radius: 0;
        background: transparent;
      }
      :host([stage-layout="centered"]) .panel {
        grid-area: panel;
        align-self: stretch;
      }
      :host([stage-layout="centered"]) :is(.panel, .actions) {
        padding-inline: var(--_sv-screen-inset);
        padding-block-start: 0;
      }
      :host([stage-layout="centered"]) .actions {
        display: grid;
        row-gap: var(--_sv-screen-action-gap);
      }
      :host([stage-layout="centered"]) .actions::before {
        /* A zero-height row adds the first gap only when there is action content. */
        content: "";
      }
      :host([stage-layout="centered"]) :is(.action-buttons, slot[name="before-actions"]) {
        display: contents;
      }
    `,
  ];

  static override properties = {
    navigation: { attribute: false },
    heading: {},
    description: {},
    busy: { type: Boolean, reflect: true },
    statusMessage: { attribute: "status-message" },
    stageLayout: { attribute: "stage-layout", reflect: true },
    panelAlign: { attribute: "panel-align", reflect: true },
    panelMode: { attribute: "panel-mode", reflect: true },
    panelGlass: { type: Boolean, attribute: "panel-glass" },
  };

  declare navigation: SvScreenNavigation | undefined;
  declare heading: string | undefined;
  declare description: string | undefined;
  declare busy: boolean;
  declare statusMessage: string | undefined;
  declare stageLayout: SvScreenProps["stageLayout"];
  /** Unset renders `end`. */
  declare panelAlign: SvScreenPanelAlign | undefined;
  declare panelMode: SvScreenPanelMode;
  declare panelGlass: boolean;

  readonly #panelLayout = new PanelLayoutController(this);
  readonly #status = new LiveStatus(this, () => this.statusMessage ?? "");

  constructor() {
    super();
    this.heading = undefined;
    this.description = undefined;
    this.busy = false;
    this.statusMessage = undefined;
    this.panelAlign = undefined;
    this.panelMode = "stack";
    this.panelGlass = false;
    this.addController(this.#panelLayout);
  }

  readonly #onBack = (): void => {
    this.dispatchEvent(new CustomEvent("sv-back", { bubbles: true, composed: true }));
  };

  protected override render() {
    const panelContent = html`<div class="panel-content"><slot></slot></div>`;
    return html`<div class="screen">
      <span class="sv-sr-only" role="status" aria-atomic="true">${this.#status.text}</span>
      <header part="header" class="header" data-sv-swipe>
        <button
          part="back"
          class="icon-button back"
          type="button"
          aria-label=${this.ui.text("surface.backSr")}
          ?disabled=${this.navigation ? this.navigation.back !== "available" : this.busy}
          ?hidden=${this.navigation?.back === "hidden"}
          @click=${this.#onBack}
        >
          <sv-icon name="chevron-left"></sv-icon>
        </button>
        <div class="titles">
          <h2><slot name="heading">${this.heading}</slot></h2>
          <div part="description" class="description">
            <slot name="description">${this.description}</slot>
          </div>
        </div>
        <button
          part="close"
          class="icon-button close"
          type="button"
          aria-label=${this.ui.text("surface.closeSr")}
          data-sv-dismiss
          ?disabled=${this.navigation ? !this.navigation.close : this.busy}
        >
          <sv-icon name="x"></sv-icon>
        </button>
      </header>
      <div part="body" class="body">
        <div part="stage" class="stage"><slot name="stage"></slot></div>
        ${
          this.panelGlass && this.panelMode !== "stack" && this.stageLayout !== "centered"
            ? html`<sv-glass part="panel" class="panel">${panelContent}</sv-glass>`
            : html`<div part="panel" class="panel">${panelContent}</div>`
        }
      </div>
      <div part="actions" class="actions">
        <slot name="before-actions"></slot>
        <div class="action-buttons">
          <slot name="primary"></slot>
          <slot name="secondary"></slot>
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-screen": SvScreen;
  }
  interface HTMLElementEventMap {
    "sv-back": CustomEvent<undefined>;
  }
}
