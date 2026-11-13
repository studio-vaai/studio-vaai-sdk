import type { ReactiveController, ReactiveControllerHost } from "lit";

/** Presentation-only counterpart of the screens' 40rem container breakpoint. */
export class ScreenLayoutController implements ReactiveController {
  readonly #host: ReactiveControllerHost & HTMLElement;
  #observer: ResizeObserver | undefined;
  wide = false;

  constructor(host: ReactiveControllerHost & HTMLElement) {
    this.#host = host;
    host.addController(this);
  }

  hostConnected(): void {
    this.#measure(this.#host.clientWidth);
    if (typeof ResizeObserver !== "undefined") {
      this.#observer = new ResizeObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === this.#host);
        if (entry) {
          this.#measure(entry.contentRect.width);
        }
      });
      this.#observer.observe(this.#host);
    }
  }

  hostDisconnected(): void {
    this.#observer?.disconnect();
  }

  #measure(width: number): void {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const wide = width >= 40 * rem;
    if (wide !== this.wide) {
      this.wide = wide;
      this.#host.requestUpdate();
    }
  }
}
