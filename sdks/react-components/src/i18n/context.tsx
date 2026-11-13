"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  compileStudioVaaiUiMessages,
  mergeStudioVaaiUiMessagesSource,
  resolveStudioVaaiUiLocale,
  studioVaaiUiMessagesEn,
  type PartialStudioVaaiUiMessagesSource,
  type StudioVaaiUiLocale,
  type StudioVaaiUiMessages,
} from "./messages.js";

// Outside a provider the SDK speaks English, as it does for any language it does not ship.
const StudioVaaiUiContext = createContext(studioVaaiUiMessagesEn);

interface StudioVaaiUiMessagesProviderProps {
  children: ReactNode;
  /** Any BCP 47 tag; see {@link StudioVaaiUiLocale} for how it picks the catalog. */
  locale?: StudioVaaiUiLocale;
  /** Deep-merge MF2 source overrides onto the locale's catalog before compile. */
  messages?: PartialStudioVaaiUiMessagesSource;
}

/** Compiles and provides the MF2 message bundle for the studio vaai UI tree. Used by {@link StudioVaaiUiProvider}. */
export function StudioVaaiUiMessagesProvider({
  children,
  locale = "en",
  messages: messagesOverride,
}: StudioVaaiUiMessagesProviderProps): React.ReactElement {
  const value = useMemo((): StudioVaaiUiMessages => {
    const { formatLocale, source } = resolveStudioVaaiUiLocale(
      locale,
      messagesOverride !== undefined,
    );
    const merged = mergeStudioVaaiUiMessagesSource(source, messagesOverride);
    return compileStudioVaaiUiMessages(formatLocale, merged);
  }, [locale, messagesOverride]);

  return <StudioVaaiUiContext.Provider value={value}>{children}</StudioVaaiUiContext.Provider>;
}

export function useStudioVaaiUiMessages(): StudioVaaiUiMessages {
  return useContext(StudioVaaiUiContext);
}
