"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

const LAYOUT_QUERY = "(max-width: 768px)";
const POINTER_QUERY = "(pointer: coarse)";

type ResponsiveLayout = "bottomSheet" | "modal";
type ResponsivePointer = "coarse" | "fine";

export interface Responsive {
  layout: ResponsiveLayout;
  pointer: ResponsivePointer;
}

const DEFAULT_RESPONSIVE: Responsive = { layout: "modal", pointer: "fine" };

const ResponsiveContext = createContext(DEFAULT_RESPONSIVE);

function noop(): void {
  // SSR/no-DOM environments have no media-query store to subscribe to.
}

function subscribeMedia(query: string, notify: () => void): () => void {
  if (
    typeof globalThis.window === "undefined" ||
    typeof globalThis.window.matchMedia !== "function"
  ) {
    return noop;
  }
  const mql = globalThis.window.matchMedia(query);
  mql.addEventListener("change", notify);
  return () => {
    mql.removeEventListener("change", notify);
  };
}

function getMediaSnapshot(query: string): boolean {
  if (
    typeof globalThis.window === "undefined" ||
    typeof globalThis.window.matchMedia !== "function"
  ) {
    return false;
  }
  return globalThis.window.matchMedia(query).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

function useResponsiveValue(): Responsive {
  const isSmall = useSyncExternalStore(
    (notify) => subscribeMedia(LAYOUT_QUERY, notify),
    () => getMediaSnapshot(LAYOUT_QUERY),
    getServerSnapshot,
  );
  const isCoarse = useSyncExternalStore(
    (notify) => subscribeMedia(POINTER_QUERY, notify),
    () => getMediaSnapshot(POINTER_QUERY),
    getServerSnapshot,
  );
  return useMemo<Responsive>(
    () => ({
      layout: isSmall ? "bottomSheet" : "modal",
      pointer: isCoarse ? "coarse" : "fine",
    }),
    [isSmall, isCoarse],
  );
}

export function ResponsiveProvider({ children }: { children: ReactNode }): React.ReactElement {
  const value = useResponsiveValue();
  return <ResponsiveContext.Provider value={value}>{children}</ResponsiveContext.Provider>;
}

export function useResponsive(): Responsive {
  return useContext(ResponsiveContext);
}
