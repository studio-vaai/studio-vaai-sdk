import type { MessageId } from "../../build/message-types.js";
import type { VariantLabel } from "../../build/wasm2/studio_vaai_core.js";

export type { MessageId } from "../../build/message-types.js";

/** A complete caller-supplied MF2 catalog; adding an SDK message adds a required key. */
export type MessageSource = Readonly<Record<MessageId, string>>;
/** Partial overrides may also add caller-owned message IDs. */
export type MessageOverrides = Readonly<Partial<MessageSource> & Record<string, string>>;

export type MessageValue = string | number | bigint | readonly string[] | VariantLabel;
export type MessageValues = Readonly<Record<string, MessageValue>>;

/** Stable web representation of the Rust formatter's MF2 parts. */
export type MessagePart =
  | { type: "text" | "bidiIsolation"; value: string }
  | {
      type: "string";
      value: string;
      locale: string;
      direction: "ltr" | "rtl" | "auto";
      id?: string | undefined;
    }
  | {
      type: "number";
      parts: readonly { kind: string; value: string }[];
      locale: string;
      direction: "ltr" | "rtl" | "auto";
      id?: string | undefined;
    }
  | {
      type: "markup";
      kind: "open" | "close" | "standalone";
      name: string;
      id?: string | undefined;
      options: readonly { name: string; value: string }[];
    }
  | { type: "fallback"; source: string };
export interface FormattedMessage {
  parts: readonly MessagePart[];
  errors: readonly string[];
}

export interface MessageFormatter {
  /** The exact locale used for MF2 value formatting. */
  readonly locale: string;
  /** The shipped SDK text language, before caller overrides. */
  readonly catalogLocale: string;
  format(key: string, values?: MessageValues): FormattedMessage | undefined;
  dispose(): void;
}
