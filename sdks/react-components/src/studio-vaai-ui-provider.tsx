"use client";

import { useMemo, type ReactNode } from "react";

import type { SvTokenOverrides } from "./generated/tokens.js";
import type { PartialStudioVaaiUiMessagesSource, StudioVaaiUiLocale } from "./i18n/messages.js";
import type { StudioVaaiUiMessages } from "./i18n/messages.js";
import type { StudioVaaiUiComponentOverrides } from "./studio-vaai-ui-component-overrides-types.js";
import type { Responsive } from "./ui/responsive-context.js";
import type { SheetShellClassNames } from "./ui/sheet-shell-class-names.js";

import { StudioVaaiUiMessagesProvider, useStudioVaaiUiMessages } from "./i18n/context.js";
import { StudioVaaiUiComponentsProvider } from "./studio-vaai-ui-components-context.js";
import { SurfaceLandmarksProvider } from "./surface-landmarks-context.js";
import { StudioVaaiShellClassNamesProvider, StudioVaaiThemeProvider } from "./theme-context.js";
import { ResponsiveProvider, useResponsive } from "./ui/responsive-context.js";
import { mergeSurfaceLandmarks, type PartialSurfaceLandmarks } from "./ui/surface-landmarks.js";

const EMPTY_COMPONENT_OVERRIDES: StudioVaaiUiComponentOverrides = {};

export interface StudioVaaiUiProviderProps {
  children: ReactNode;
  /**
   * Any BCP 47 tag (`de`, `de-AT`, `en-GB`, `fr`); default `en`. Its language picks the shipped
   * catalog (`de` or `en`; other languages use `en`), and number and list formatting follow the
   * full tag. See {@link StudioVaaiUiLocale}.
   */
  locale?: StudioVaaiUiLocale;
  /**
   * MF2 sources deep-merged onto the locale's catalog before compile. Pass a complete
   * `StudioVaaiUiMessagesSource` to supply a language the SDK does not ship.
   */
  messages?: PartialStudioVaaiUiMessagesSource;
  /** Optional replacements for UI primitives (see {@link StudioVaaiUiComponentOverrides}). */
  components?: StudioVaaiUiComponentOverrides;
  /**
   * Typed `--sv-*` design-token overrides (brand color, radii, font, spacing).
   * Applied as inline CSS variables on every `#studio-vaai-root` anchor — including
   * the portaled sheet/modal — so most restyling needs no component overrides.
   */
  theme?: SvTokenOverrides;
  /**
   * Per-slot `className` overrides applied to every sheet/modal shell in this tree
   * (header, title, body, footer, buttons …). Restyle the chrome once without
   * swapping components. See {@link SheetShellClassNames}.
   */
  shellClassNames?: SheetShellClassNames;
  /** Partial overrides for sheet/modal DOM landmark resolvers (scroll-aware preview sizing). */
  surfaceLandmarks?: PartialSurfaceLandmarks;
}

/**
 * Root provider for studio vaai UI: MF2 messages, responsive state, theme tokens, and optional component overrides.
 */
export function StudioVaaiUiProvider({
  children,
  locale = "en",
  messages,
  components,
  theme,
  shellClassNames,
  surfaceLandmarks,
}: StudioVaaiUiProviderProps): React.ReactElement {
  const componentsValue = useMemo(() => components ?? EMPTY_COMPONENT_OVERRIDES, [components]);
  const surfaceLandmarksValue = useMemo(
    () => mergeSurfaceLandmarks(surfaceLandmarks),
    [surfaceLandmarks],
  );
  return (
    <StudioVaaiThemeProvider value={theme}>
      <StudioVaaiShellClassNamesProvider value={shellClassNames}>
        <StudioVaaiUiComponentsProvider value={componentsValue}>
          <SurfaceLandmarksProvider value={surfaceLandmarksValue}>
            <StudioVaaiUiMessagesProvider
              locale={locale}
              {...(messages === undefined ? {} : { messages })}
            >
              <ResponsiveProvider>{children}</ResponsiveProvider>
            </StudioVaaiUiMessagesProvider>
          </SurfaceLandmarksProvider>
        </StudioVaaiUiComponentsProvider>
      </StudioVaaiShellClassNamesProvider>
    </StudioVaaiThemeProvider>
  );
}

/** Umbrella value exposed by {@link useStudioVaaiUi}. Grows as the SDK exposes more shared state. */
export interface StudioVaaiUi {
  messages: StudioVaaiUiMessages;
  responsive: Responsive;
}

/** Read MF2 messages and responsive state from the {@link StudioVaaiUiProvider} tree. */
export function useStudioVaaiUi(): StudioVaaiUi {
  const messages = useStudioVaaiUiMessages();
  const responsive = useResponsive();
  return useMemo(() => ({ messages, responsive }), [messages, responsive]);
}
