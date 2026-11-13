import type { PropertyValues } from "lit";

import { css, html, nothing } from "lit";

import {
  closeNow,
  closeWithTransition,
  consumeOwnClose,
  isBackdropClick,
  showModal,
  unlockPageScroll,
} from "../../internal/modal.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

/** What the viewport makes it: a centered dialog from 48em up, a drawer below. */
export type SvDialogShape = "dialog" | "drawer";

export const SV_DISMISS_REASONS = ["escape", "backdrop", "swipe", "close-button"] as const;
export type SvDismissReason = (typeof SV_DISMISS_REASONS)[number];

export interface SvDismissDetail {
  reason: SvDismissReason;
}

export interface SvDialogProps {
  /** Shown in the top layer. Only the owner changes it: the dialog asks with `sv-dismiss`. */
  open?: boolean | undefined;
  /** The dialog's accessible name, usually the current screen's title. */
  label?: string | undefined;
  /**
   * Esc, the backdrop and a swipe don't ask to close, e.g. while an upload is in flight. Close
   * buttons (`data-sv-dismiss`) still do.
   */
  persistent?: boolean | undefined;
}

/** Below this width `auto` is a drawer. A viewport query: the dialog sits in the top layer. */
const WIDE_QUERY = "(min-width: 48em)";
/** A drag past this share of the drawer's height, or a flick, asks to close. */
const SWIPE_DISTANCE = 0.25;
const SWIPE_VELOCITY = 0.6;

interface Drag {
  pointerId: number;
  startY: number;
  startTime: number;
  startOffset: number;
  dy: number;
}

/**
 * `<sv-dialog>` — the container the flow runs in: a centered dialog on wide screens, a drawer
 * from the bottom on narrow ones. The content is slotted.
 *
 * Opens and closes with `open`, animated. It never closes itself: Esc, a click on the backdrop,
 * a swipe down on the drawer or a press on any element marked `data-sv-dismiss` fire
 * `sv-dismiss` with the reason, and the owner decides whether to set `open` to false. With
 * `persistent`, Esc, the backdrop and swipes do nothing, and only `data-sv-dismiss` elements
 * ask. Elements marked `data-sv-swipe` work as drag handles.
 *
 * While open it sits above everything on the page, the page behind can't be scrolled or
 * reached, and focus stays inside; on close, focus returns to where it was.
 *
 * @slot - The content. It fills the box and can query its width as `@container sv-dialog`.
 * @fires sv-dismiss - The shopper asked to close; `detail.reason` says how.
 * @csspart panel - The box.
 * @csspart grabber - The drawer's handle.
 */
export class SvDialog extends SvElement implements SvDialogProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: contents;
      }

      .panel {
        position: fixed;
        margin: 0;
        padding: 0;
        border: 0;
        max-inline-size: none;
        max-block-size: none;
        overflow: hidden;
        background: var(--_sv-background);
        color: var(--_sv-foreground);
        font-family: inherit;
        outline: none;
      }
      .panel[open] {
        display: flex;
        flex-direction: column;
      }
      .panel::backdrop {
        /* Older engines don't let ::backdrop inherit custom properties. */
        background: var(--_sv-backdrop, rgb(0 0 0 / 0.45));
        transition: opacity var(--_sv-duration, 250ms) var(--_sv-ease, ease);
      }
      .panel[data-closing]::backdrop {
        opacity: 0;
      }
      @starting-style {
        .panel[open]::backdrop {
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel::backdrop {
          transition-duration: 1ms;
        }
      }

      /* Content can size itself to the box with @container sv-dialog (…). */
      .body {
        container: sv-dialog / inline-size;
        flex: 1;
        min-block-size: 0;
        display: flex;
        flex-direction: column;
        overflow: auto;
        overscroll-behavior: contain;
      }
      ::slotted(*) {
        flex: 1;
        min-block-size: 0;
      }

      /* ---------- Dialog ---------- */
      .panel[data-shape="dialog"] {
        inset: 0;
        margin: auto;
        inline-size: min(calc(var(--_sv-root) * 65), calc(100% - var(--_sv-spacing) * 8));
        block-size: min(calc(var(--_sv-root) * 50), calc(100dvh - var(--_sv-spacing) * 8));
        border-radius: var(--_sv-radius-xl);
        box-shadow: var(--_sv-shadow-lg);
        transition:
          opacity var(--_sv-duration) var(--_sv-ease),
          transform var(--_sv-duration) var(--_sv-ease);
      }
      .panel[data-shape="dialog"][data-closing] {
        opacity: 0;
        transform: translateY(calc(var(--_sv-spacing) * 2)) scale(0.98);
      }
      @starting-style {
        .panel[data-shape="dialog"][open] {
          opacity: 0;
          transform: translateY(calc(var(--_sv-spacing) * 2)) scale(0.98);
        }
      }

      /* ---------- Drawer ---------- */
      .panel[data-shape="drawer"] {
        inset: auto 0 0;
        inline-size: 100%;
        /* The top strip keeps the shop in view, so the drawer reads as a layer. */
        block-size: calc(100dvh - env(safe-area-inset-top, 0px) - var(--_sv-spacing) * 10);
        border-radius: var(--_sv-radius-xl) var(--_sv-radius-xl) 0 0;
        padding-block-end: env(safe-area-inset-bottom, 0px);
        transition: transform var(--_sv-duration-slow) var(--_sv-ease);
        touch-action: pan-y;
      }
      .panel[data-shape="drawer"][data-closing] {
        transform: translateY(100%);
      }
      @starting-style {
        .panel[data-shape="drawer"][open] {
          transform: translateY(100%);
        }
      }
      .panel[data-dragging] {
        transition: none;
      }

      .grabber {
        display: none;
      }
      .panel[data-shape="drawer"] .grabber {
        display: block;
        flex: none;
        block-size: calc(var(--_sv-spacing) * 5);
        position: relative;
        cursor: grab;
        touch-action: none;
      }
      .grabber::before {
        content: "";
        position: absolute;
        inset-block-start: calc(var(--_sv-spacing) * 2);
        inset-inline-start: 50%;
        inline-size: calc(var(--_sv-spacing) * 9);
        block-size: calc(var(--_sv-spacing) * 1.25);
        transform: translateX(-50%);
        border-radius: var(--_sv-radius-full);
        background: var(--_sv-border);
      }
    `,
  ];

  static override properties = {
    open: { type: Boolean, reflect: true },
    label: {},
    persistent: { type: Boolean, reflect: true },
  };

  declare open: boolean;
  declare label: string | undefined;
  declare persistent: boolean;

  #wide: MediaQueryList | null = null;
  #drag: Drag | null = null;
  /** Set after a drag so the click that follows the pointer release is not a backdrop click. */
  #justDragged = false;

  constructor() {
    super();
    this.open = false;
    this.label = undefined;
    this.persistent = false;
  }

  get #dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("dialog");
  }

  /** The shape shown now, from the viewport's width. */
  get resolvedShape(): SvDialogShape {
    return this.#wide?.matches === false ? "drawer" : "dialog";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Absent in some test DOMs; `auto` then means the dialog.
    if (typeof globalThis.matchMedia === "function") {
      this.#wide = globalThis.matchMedia(WIDE_QUERY);
      this.#wide.addEventListener("change", this.#onViewport);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#wide?.removeEventListener("change", this.#onViewport);
    const dialog = this.#dialog;
    if (dialog) {
      closeNow(dialog);
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("open")) {
      this.#sync();
    }
  }

  /** Includes the time the native dialog spends animating out. */
  get showing(): boolean {
    return this.#dialog?.open === true;
  }

  readonly #onViewport = (): void => {
    const dialog = this.#dialog;
    if (dialog && this.#drag) {
      this.#resetDrag(dialog);
    }
    this.requestUpdate();
  };

  #sync(): void {
    const dialog = this.#dialog;
    if (!dialog) {
      return;
    }
    this.#resetDrag(dialog);
    dialog.inert = !this.open;
    if (this.open) {
      showModal(dialog);
    } else {
      closeWithTransition(dialog);
    }
  }

  #dismiss(reason: SvDismissReason): void {
    this.dispatchEvent(
      new CustomEvent<SvDismissDetail>("sv-dismiss", {
        detail: { reason },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Esc. The browser's own close is prevented; the owner decides. */
  readonly #onCancel = (event: Event): void => {
    event.preventDefault();
    if (!this.persistent) {
      this.#dismiss("escape");
    }
  };

  /**
   * The browser closed the dialog without us: Chrome lets a repeated Esc through when the page
   * had no user activation in between. Report it, and reopen if the owner still says open.
   */
  readonly #onClose = (): void => {
    const dialog = this.#dialog;
    if (!dialog) {
      return;
    }
    if (consumeOwnClose(dialog)) {
      if (!dialog.open) {
        this.dispatchEvent(new Event("sv-dialog-closed"));
      }
      return;
    }
    // Balance the lock taken when it opened; showModal() below takes a new one.
    unlockPageScroll();
    if (!this.persistent) {
      this.#dismiss("escape");
    }
    queueMicrotask(() => {
      if (this.open) {
        showModal(dialog);
      }
    });
  };

  readonly #onClick = (event: MouseEvent): void => {
    if (this.#justDragged) {
      this.#justDragged = false;
      return;
    }
    const dialog = this.#dialog;
    if (!dialog) {
      return;
    }
    const closer = event
      .composedPath()
      .find((node) => node instanceof HTMLElement && Object.hasOwn(node.dataset, "svDismiss"));
    if (closer !== globalThis.undefined) {
      this.#dismiss("close-button");
      return;
    }
    if (!this.persistent && isBackdropClick(dialog, event)) {
      this.#dismiss("backdrop");
    }
  };

  /** A drag starts on the grabber or on content marked `data-sv-swipe` (a screen's header). */
  readonly #onPointerDown = (event: PointerEvent): void => {
    const dialog = this.#dialog;
    if (
      !dialog ||
      !this.open ||
      this.#drag ||
      this.resolvedShape !== "drawer" ||
      event.button !== 0
    ) {
      return;
    }
    this.#justDragged = false;
    const path = event.composedPath();
    const fromHandle = path.some(
      (node) =>
        node instanceof HTMLElement &&
        (node.classList.contains("grabber") || Object.hasOwn(node.dataset, "svSwipe")),
    );
    const fromControl = path.some(
      (node) => node instanceof Element && node.matches("button, a, input, select, textarea"),
    );
    if (!fromHandle || fromControl) {
      return;
    }
    // Freeze the current position before disabling a return transition.
    const { transform } = getComputedStyle(dialog);
    const startOffset =
      transform === "none" || transform === "" ? 0 : new DOMMatrixReadOnly(transform).m42;
    dialog.setPointerCapture(event.pointerId);
    this.#drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTime: performance.now(),
      startOffset,
      dy: startOffset,
    };
    dialog.style.transform = `translateY(${startOffset}px)`;
    dialog.dataset["dragging"] = "";
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    const dialog = this.#dialog;
    if (!dialog || this.#drag?.pointerId !== event.pointerId) {
      return;
    }
    const { startOffset, startY } = this.#drag;
    const startPull = this.persistent ? (startOffset / 4) ** 2 : startOffset;
    const raw = Math.max(0, startPull + event.clientY - startY);
    // Persistent: the drawer gives a little, then springs back.
    const dy = this.persistent ? Math.sqrt(raw) * 4 : raw;
    this.#drag.dy = dy;
    dialog.style.transform = `translateY(${dy}px)`;
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    const dialog = this.#dialog;
    const drag = this.#drag;
    if (!dialog || drag?.pointerId !== event.pointerId) {
      return;
    }
    const { height } = dialog.getBoundingClientRect();
    const distance = drag.dy - drag.startOffset;
    this.#justDragged = Math.abs(distance) > 4;
    const velocity = distance / Math.max(1, performance.now() - drag.startTime);
    const far = distance > 0 && drag.dy > height * SWIPE_DISTANCE;
    const flick = velocity > SWIPE_VELOCITY && distance > 24;
    this.#resetDrag(dialog);
    if (!this.persistent && (far || flick)) {
      this.#dismiss("swipe");
    }
  };

  readonly #onPointerCancel = (event: PointerEvent): void => {
    const dialog = this.#dialog;
    if (dialog && this.#drag?.pointerId === event.pointerId) {
      this.#resetDrag(dialog);
    }
  };

  #resetDrag(dialog: HTMLDialogElement): void {
    this.#drag = null;
    delete dialog.dataset["dragging"];
    dialog.style.transform = "";
  }

  protected override render() {
    return html`<dialog
      part="panel"
      class="panel"
      data-shape=${this.resolvedShape}
      aria-label=${this.label ?? nothing}
      @cancel=${this.#onCancel}
      @close=${this.#onClose}
      @click=${this.#onClick}
      @pointerdown=${this.#onPointerDown}
      @pointermove=${this.#onPointerMove}
      @pointerup=${this.#onPointerUp}
      @pointercancel=${this.#onPointerCancel}
      @lostpointercapture=${this.#onPointerCancel}
    >
      <div part="grabber" class="grabber" aria-hidden="true"></div>
      <div class="body"><slot></slot></div>
    </dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-dialog": SvDialog;
  }
  interface HTMLElementEventMap {
    "sv-dismiss": CustomEvent<SvDismissDetail>;
  }
}
