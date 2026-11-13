import type { FormattedMessage as NativeMessage } from "../../build/wasm2/studio_vaai_core.js";
import type { FormattedMessage, MessagePart } from "./types.js";

import {
  Direction,
  MarkupKind,
  MessageError,
  MessagePart_Tags,
} from "../../build/wasm2/studio_vaai_core.js";

export function toWeb(message: NativeMessage): FormattedMessage {
  const parts = message.parts.map((part): MessagePart => {
    switch (part.tag) {
      case MessagePart_Tags.Text: {
        return { type: "text", value: part.inner.value };
      }
      case MessagePart_Tags.String: {
        return {
          type: "string",
          value: part.inner.value,
          locale: part.inner.locale,
          direction: direction(part.inner.dir),
          id: part.inner.id,
        };
      }
      case MessagePart_Tags.BidiIsolation: {
        return { type: "bidiIsolation", value: part.inner.value };
      }
      case MessagePart_Tags.Number: {
        return {
          type: "number",
          parts: part.inner.parts,
          locale: part.inner.locale,
          direction: direction(part.inner.dir),
          id: part.inner.id,
        };
      }
      case MessagePart_Tags.Fallback: {
        return { type: "fallback", source: part.inner.source };
      }
      case MessagePart_Tags.Markup: {
        return {
          type: "markup",
          name: part.inner.name,
          id: part.inner.id,
          options: part.inner.options,
          kind: markupKind(part.inner.kind),
        };
      }
      default: {
        throw new Error("Unknown MF2 part from the Rust SDK.");
      }
    }
  });
  return { parts, errors: message.errors.map((error) => MessageError[error]) };
}

function direction(value: Direction): "ltr" | "rtl" | "auto" {
  if (value === Direction.Ltr) {
    return "ltr";
  }
  if (value === Direction.Rtl) {
    return "rtl";
  }
  return "auto";
}

function markupKind(kind: MarkupKind): "open" | "close" | "standalone" {
  if (kind === MarkupKind.Open) {
    return "open";
  }
  if (kind === MarkupKind.Close) {
    return "close";
  }
  return "standalone";
}
