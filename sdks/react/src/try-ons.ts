import type { TryOn } from "@studio-vaai/core";
import type { TryOnExperience } from "@studio-vaai/web-components/experience";

import React from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";

export const TryOnExperienceContext = React.createContext<TryOnExperience | undefined>(
  globalThis.undefined,
);

const empty: readonly TryOn[] = Object.freeze([]);

/** Completed results in creation order for the enclosing StudioVaaiTryOn. */
export function useTryOns(): readonly TryOn[] {
  const experience = React.useContext(TryOnExperienceContext);
  const subscribe = React.useCallback(
    (listener: () => void) => experience?.subscribe(listener) ?? (() => globalThis.undefined),
    [experience],
  );
  return useSyncExternalStore(
    subscribe,
    () => experience?.view.domain.tryOns ?? empty,
    () => empty,
  );
}
