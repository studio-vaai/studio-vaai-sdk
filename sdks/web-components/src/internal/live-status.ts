import type { ReactiveController, ReactiveControllerHost } from "lit";

/** Mount an empty live region first, then update its text without replacing the region. */
export class LiveStatus implements ReactiveController {
  text = "";
  #requested = "";
  #frame: number | undefined;
  #connected = false;
  readonly #host: ReactiveControllerHost;
  readonly #read: () => string;

  constructor(host: ReactiveControllerHost, read: () => string) {
    this.#host = host;
    this.#read = read;
    host.addController(this);
  }

  hostConnected(): void {
    this.#connected = true;
  }
  hostDisconnected(): void {
    this.#connected = false;
    if (this.#frame !== undefined) {
      cancelAnimationFrame(this.#frame);
    }
    this.#requested = this.text;
  }

  hostUpdated(): void {
    const next = this.#read();
    if (next === this.#requested) {
      return;
    }
    this.#requested = next;
    if (this.#frame !== undefined) {
      cancelAnimationFrame(this.#frame);
    }
    const publish = () => {
      if (this.#connected && this.#requested === next) {
        this.text = next;
        this.#host.requestUpdate();
      }
    };
    if (typeof requestAnimationFrame === "function") {
      this.#frame = requestAnimationFrame(() => {
        this.#frame = requestAnimationFrame(publish);
      });
    } else {
      queueMicrotask(publish);
    }
  }
}
