import type {
  FormattedMessage,
  MessageValues,
  MessageFormatter,
  MessageOverrides,
} from "./types.js";

import {
  messageLocales,
  MessageCatalog,
  Message,
  MessageArgument,
} from "../../build/wasm2/studio_vaai_core.js";
import { toWeb } from "./parts.js";

/** Available after initializeCore(), from the Rust build's catalog table. */
export function availableLocales(): readonly string[] {
  return messageLocales();
}

function argumentsFor(values: MessageValues): Map<string, MessageArgument> {
  return new Map<string, MessageArgument>(
    Object.entries(values).map(([key, value]): [string, MessageArgument] => {
      if (typeof value === "string") {
        return [key, MessageArgument.String.new({ value })];
      }
      if (typeof value === "number") {
        return [key, MessageArgument.Number.new({ value })];
      }
      if (typeof value === "bigint") {
        return [key, MessageArgument.Integer.new({ value })];
      }
      if ("axes" in value) {
        return [key, MessageArgument.VariantLabel.new({ value })];
      }
      return [key, MessageArgument.List.new({ items: [...value] })];
    }),
  );
}

/** A reusable catalog with cached compiled host overrides. All MF2 evaluation stays in Rust. */
export function createMessageFormatter(
  locale: string,
  overrides?: MessageOverrides,
): MessageFormatter {
  const catalog = new MessageCatalog(locale, overrides !== undefined);
  const cache = new Map<string, FormattedMessage | undefined>();
  const compiled = new Map<string, ReturnType<typeof catalog.compile>>();
  const dispose = () => {
    for (const message of compiled.values()) {
      if (Message.instanceOf(message)) {
        message.uniffiDestroy();
      }
    }
    catalog.uniffiDestroy();
  };
  try {
    for (const [key, source] of Object.entries(overrides ?? {})) {
      compiled.set(key, catalog.compile(source));
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    locale: catalog.locale(),
    catalogLocale: catalog.catalogLocale(),
    format(key: string, values: MessageValues = {}): FormattedMessage | undefined {
      const cacheable = Object.keys(values).length === 0;
      if (cacheable && cache.has(key)) {
        return cache.get(key);
      }
      const args = argumentsFor(values);
      const result = compiled.get(key)?.formatToParts(args) ?? catalog.formatToParts(key, args);
      const formatted = result && toWeb(result);
      if (cacheable) {
        cache.set(key, formatted);
      }
      return formatted;
    },
    dispose,
  };
}
