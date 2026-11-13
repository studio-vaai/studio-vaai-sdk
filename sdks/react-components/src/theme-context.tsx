"use client";

import { createContext, useContext } from "react";

import type { SvTokenOverrides } from "./generated/tokens.js";
import type { SheetShellClassNames } from "./ui/sheet-shell-class-names.js";

/**
 * Carries the consumer's `theme` ({@link SvTokenOverrides}) down the tree so the
 * sheet/modal portals — which re-anchor `#studio-vaai-root` outside the provider's
 * DOM subtree — can re-apply the same `--sv-*` CSS variables. React context crosses
 * `createPortal` boundaries, so a single provider value reaches every portal root.
 */
const ThemeContext = createContext<SvTokenOverrides | undefined>(undefined);

export const StudioVaaiThemeProvider = ThemeContext.Provider;

/** Read the active `theme` token overrides, or `undefined` when none were supplied. */
export function useStudioVaaiTheme(): SvTokenOverrides | undefined {
  return useContext(ThemeContext);
}

/**
 * Per-slot `className` overrides applied to every sheet/modal shell in the tree
 * (e.g. all default-flow screens). Read by `SheetShell` so consumers can restyle
 * the chrome once instead of swapping the component. An explicit `classNames`
 * prop on an individual `SheetShell` takes precedence over this value.
 */
const ShellClassNamesContext = createContext<SheetShellClassNames | undefined>(undefined);

export const StudioVaaiShellClassNamesProvider = ShellClassNamesContext.Provider;

/** Read the tree-wide sheet/modal shell `classNames`, or `undefined` when none were supplied. */
export function useShellClassNames(): SheetShellClassNames | undefined {
  return useContext(ShellClassNamesContext);
}
