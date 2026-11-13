import type { ProductId } from "@studio-vaai/js-client";
import type { ProductTryOnHistory } from "@studio-vaai/js-machine";

import { useMemo } from "react";

import type { DefaultRootSnapshot } from "./default-root-view-model.js";

import { defaultStudioVaai } from "./default-studio-vaai.js";

const EMPTY_HISTORY: ProductTryOnHistory = {
  entries: [],
  cursor: -1,
  currentEntry: null,
};

/**
 * Read the current try-on history for a single product from the
 * {@link defaultStudioVaai} actor. Re-renders only when the product's stored
 * entry changes (XState snapshot equality on the raw context value). Throws
 * {@link StudioVaaiProviderError} when called outside a {@link StudioVaaiProvider}.
 */
export function useProductTryOnHistory(productId: ProductId): ProductTryOnHistory {
  const entry = defaultStudioVaai.useStudioVaaiSelector(
    (snapshot: DefaultRootSnapshot) => snapshot.context.tryOnHistoryByProduct[productId],
  );
  return useMemo(() => {
    if (entry === undefined) {
      return EMPTY_HISTORY;
    }
    const currentEntry = entry.cursor >= 0 ? (entry.entries[entry.cursor] ?? null) : null;
    return {
      entries: entry.entries,
      cursor: entry.cursor,
      currentEntry,
    };
  }, [entry]);
}
