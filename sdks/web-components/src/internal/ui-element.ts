import { LitElement } from "lit";

import type { SvUiContext } from "../ui/index.js";

import { ui } from "../ui/index.js";
import { isUiScopeRoot, observeUiScopes, resolveUiScope } from "../ui/scope.js";

/** Every element follows the nearest UI context; consumer state stays in the host. */
export class SvElement extends LitElement {
  #ui: SvUiContext | undefined;
  #unsubscribe: (() => void) | undefined;
  #unobserve: (() => void) | undefined;
  #managedLanguage: string | undefined;

  constructor() {
    super();
    // Run after rendering/hydration, also for subclasses with their own updated() hook.
    this.addController({
      hostUpdated: () => {
        this.#syncLanguage();
      },
    });
  }

  #syncLanguage(): void {
    if (!this.usesMessages || isUiScopeRoot(this)) {
      return;
    }
    const explicit = this.getAttribute("lang");
    if (explicit !== null && explicit !== this.#managedLanguage) {
      return;
    }
    this.#managedLanguage = this.ui.snapshot.resolvedLocale ?? this.ui.snapshot.locale;
    this.lang = this.#managedLanguage;
  }

  protected get ui(): SvUiContext {
    return this.#ui ?? resolveUiScope(this, ui);
  }

  /** Primitives that only render caller-supplied content do not load the formatter. */
  protected readonly usesMessages: boolean = false;

  readonly #bind = (): void => {
    const context = resolveUiScope(this, ui);
    if (context !== this.#ui) {
      this.#unsubscribe?.();
      this.#ui = context;
      this.#unsubscribe = context.subscribe(this.#refresh);
      // The error is published on the context for the host to display/retry.
      if (this.usesMessages) {
        void this.#initialize(context);
      }
    }
    this.#refresh();
  };

  async #initialize(context: SvUiContext): Promise<void> {
    try {
      await context.ready();
    } catch {
      this.requestUpdate();
    }
  }

  readonly #refresh = (): void => {
    // Leave default markup untouched while React hydrates the custom element hosts.
    if (!isUiScopeRoot(this)) {
      if (this.ui.snapshot.appearance === "dark") {
        this.dataset["svAppearance"] = "dark";
      } else {
        delete this.dataset["svAppearance"];
      }
    }
    this.requestUpdate();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unobserve = observeUiScopes(this.#bind);
    this.#bind();
  }

  override disconnectedCallback(): void {
    this.#unsubscribe?.();
    this.#unobserve?.();
    this.#ui = undefined;
    super.disconnectedCallback();
  }
}
