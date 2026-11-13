"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { DerivedError, InteractionReason } from "./derive-error.js";

/**
 * Carries the single current error message plus the imperative setters used by
 * always-enabled CTAs. The error *value* is derived in the flow (see
 * {@link deriveError}); this context exists so a button deep in the tree can flag
 * a click-disabled reason and {@link ErrorMessage} (also deep) can read the
 * resolved message — without prop-drilling either across the screen layer.
 */
export interface ErrorContextValue {
  /** The current error to display (message + kind), or `undefined` when there's nothing. */
  error: DerivedError | undefined;
  /** Flag a click-disabled reason (called from a button's `onClickDisabled`). */
  setReason: (reason: InteractionReason) => void;
  /** Clear any pending click-disabled reason. */
  clearReason: () => void;
}

const ErrorContext = createContext<ErrorContextValue | null>(null);

export function ErrorProvider({
  value,
  children,
}: {
  value: ErrorContextValue;
  children: ReactNode;
}): ReactNode {
  return <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>;
}

export function useErrorContext(): ErrorContextValue {
  const context = useContext(ErrorContext);
  if (context === null) {
    throw new Error("useErrorContext must be used within an ErrorProvider");
  }

  return context;
}
