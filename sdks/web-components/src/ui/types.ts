import type { MessageOverrides } from "@studio-vaai/core";

import type { SvAppearance } from "../internal/theme/tokens.js";

export interface SvUiOptions {
  locale?: string;
  appearance?: SvAppearance;
  /** Caller-supplied MF2 sources in the selected locale. Missing SDK messages
   * use shipped German/English text. Supplying even an empty catalog opts an
   * unsupported language into formatting with the requested locale. Configure
   * with `messages: undefined` to clear caller sources and restore defaults. */
  messages?: MessageOverrides | undefined;
}

export interface SvUiSnapshot {
  readonly locale: string;
  /** The exact locale used to format values; available after ready(). */
  readonly resolvedLocale: string | undefined;
  /** The shipped SDK text language, before caller overrides. */
  readonly catalogLocale: string | undefined;
  readonly appearance: SvAppearance;
  readonly messages: MessageOverrides;
  readonly locales: readonly string[];
  readonly status: "loading" | "ready" | "error";
  readonly error?: unknown;
}
