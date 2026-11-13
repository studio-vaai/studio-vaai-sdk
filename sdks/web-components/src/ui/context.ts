import type {
  FormattedMessage,
  MessageValues,
  MessageFormatter,
  createMessageFormatter,
} from "@studio-vaai/core";

import { canonicalizeLocale } from "@studio-vaai/core";

import type { SvUiOptions, SvUiSnapshot } from "./types.js";

import { attachUiScope } from "./scope.js";

/** Locale, MF2 messages and appearance shared by one SDK mount. No browser preferences are read. */
export class SvUiContext {
  #snapshot: SvUiSnapshot;
  readonly #listeners = new Set<() => void>();
  #ready: Promise<void> | undefined;
  #formatterFactory: typeof createMessageFormatter | undefined;
  #formatter: MessageFormatter | undefined;
  #messagesSupplied: boolean;

  constructor(options: SvUiOptions = {}) {
    this.#messagesSupplied = options.messages !== undefined;
    this.#snapshot = Object.freeze({
      locale: canonicalizeLocale(options.locale ?? "en"),
      resolvedLocale: undefined,
      catalogLocale: undefined,
      appearance: options.appearance ?? "light",
      messages: Object.freeze({ ...options.messages }),
      locales: Object.freeze([]),
      status: "loading",
    });
  }

  get snapshot(): SvUiSnapshot {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #publish(snapshot: SvUiSnapshot): void {
    this.#snapshot = Object.freeze(snapshot);
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #createFormatter(snapshot: SvUiSnapshot, messagesSupplied = this.#messagesSupplied) {
    if (!this.#formatterFactory) {
      return;
    }
    return this.#formatterFactory(
      snapshot.locale,
      messagesSupplied ? snapshot.messages : undefined,
    );
  }

  /** Updates consumers in place. Invalid MF2 overrides leave the previous configuration intact. */
  configure(options: SvUiOptions): void {
    const hasMessages = Object.hasOwn(options, "messages");
    const snapshot: SvUiSnapshot = {
      ...this.#snapshot,
      locale:
        options.locale === undefined ? this.#snapshot.locale : canonicalizeLocale(options.locale),
      appearance: options.appearance ?? this.#snapshot.appearance,
      messages: hasMessages ? Object.freeze({ ...options.messages }) : this.#snapshot.messages,
    };
    const messagesSupplied = hasMessages ? options.messages !== undefined : this.#messagesSupplied;
    if (
      snapshot.locale !== this.#snapshot.locale ||
      snapshot.messages !== this.#snapshot.messages
    ) {
      const formatter = this.#createFormatter(snapshot, messagesSupplied);
      this.#formatter?.dispose();
      this.#formatter = formatter;
    }
    this.#messagesSupplied = messagesSupplied;
    this.#publish({
      ...snapshot,
      resolvedLocale: this.#formatter?.locale,
      catalogLocale: this.#formatter?.catalogLocale,
    });
  }

  /** Lazy, shared WASM initialization; call before displaying localized UI to avoid a loading frame. */
  async ready(): Promise<void> {
    this.#ready ??= this.#initialize();
    await this.#ready;
  }

  async #initialize(): Promise<void> {
    try {
      const core = await import("@studio-vaai/core");
      await core.initializeCore();
      this.#formatterFactory = core.createMessageFormatter;
      const snapshot: SvUiSnapshot = {
        ...this.#snapshot,
        locales: Object.freeze([...core.availableLocales()]),
        status: "ready",
        error: undefined,
      };
      const formatter = this.#createFormatter(snapshot);
      this.#formatter?.dispose();
      this.#formatter = formatter;
      this.#publish({
        ...snapshot,
        resolvedLocale: this.#formatter?.locale,
        catalogLocale: this.#formatter?.catalogLocale,
      });
    } catch (error) {
      this.#publish({ ...this.#snapshot, status: "error", error });
      this.#ready = undefined;
      throw error;
    }
  }

  format(key: string, values?: MessageValues): FormattedMessage | undefined {
    return this.#formatter?.format(key, values);
  }

  text(key: string, values?: MessageValues): string {
    return (
      this.format(key, values)
        ?.parts.map((part) => {
          if ("value" in part) {
            return part.value;
          }
          if ("source" in part) {
            return `{${part.source}}`;
          }
          if (part.type === "number") {
            return part.parts.map((item) => item.value).join("");
          }
          return "";
        })
        .join("") ?? ""
    );
  }

  /** Attach to any existing DOM root. Cleanup restores the enclosing/default scope. */
  attach(root: Node): () => void {
    return attachUiScope(root, this);
  }
}
