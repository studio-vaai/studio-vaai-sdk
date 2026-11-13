"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { StudioVaaiUiComponentOverrides } from "./studio-vaai-ui-component-overrides-types.js";

const EMPTY_OVERRIDES: StudioVaaiUiComponentOverrides = {};

const StudioVaaiUiComponentsContext = createContext(EMPTY_OVERRIDES);

export function StudioVaaiUiComponentsProvider({
  value,
  children,
}: {
  value: StudioVaaiUiComponentOverrides;
  children: ReactNode;
}): React.ReactElement {
  return (
    <StudioVaaiUiComponentsContext.Provider value={value}>
      {children}
    </StudioVaaiUiComponentsContext.Provider>
  );
}

/**
 * Resolve the component for a primitive slot: the consumer's override from
 * {@link StudioVaaiUiProvider} when present, otherwise `Default`.
 */
export function useStudioVaaiUiComponent<K extends keyof StudioVaaiUiComponentOverrides>(
  name: K,
  Default: NonNullable<StudioVaaiUiComponentOverrides[K]>,
): NonNullable<StudioVaaiUiComponentOverrides[K]> {
  const overrides = useContext(StudioVaaiUiComponentsContext);
  const override = overrides[name];
  return override ?? Default;
}
