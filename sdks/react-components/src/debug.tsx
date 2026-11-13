"use client";

import { useStudioVaaiActor } from "@studio-vaai/react-headless";
import { useEffect, type ReactElement } from "react";

/**
 * Minimal interface for the `<studio-vaai-debugger>` custom element's JS properties.
 * No import from `@studio-vaai/js-debugger` — couples by element name only.
 */
interface StudioVaaiDebuggerEl extends HTMLElement {
  snapshot: unknown;
  open: boolean;
}

function getDebuggerEl(): StudioVaaiDebuggerEl | null {
  return document.querySelector("studio-vaai-debugger") as StudioVaaiDebuggerEl | null;
}

/**
 * Drop-in `SheetDebugButton` override for use with `@studio-vaai/js-debugger`.
 *
 * Sends the current machine snapshot to the `<studio-vaai-debugger>` Lit element,
 * which immediately keeps only a phase/product projection,
 * (registered by `setupStudioVaaiDebugger()`) and provides a button to open the panel.
 *
 * Usage in Storybook:
 * ```tsx
 * import { DebugSheetButton } from "@studio-vaai/react-components/debug";
 * <StudioVaaiDefaultFlow components={{ SheetDebugButton: DebugSheetButton }} />
 * ```
 */
export function DebugSheetButton(): ReactElement | null {
  const { state } = useStudioVaaiActor();

  useEffect(() => {
    const el = getDebuggerEl();
    if (!el) {
      return;
    }
    el.snapshot = state; // The element synchronously keeps a sanitized projection only.
    const captured = el.snapshot;
    return () => {
      if (el.snapshot === captured) {
        el.snapshot = null;
      }
    };
  }, [state]);

  return (
    <button
      type="button"
      className="sv:cursor-pointer sv:rounded sv:border sv:border-zinc-300 sv:bg-zinc-100 sv:px-1.5 sv:py-0.5 sv:font-sans sv:text-[0.625rem] sv:font-semibold sv:leading-[1.4] sv:tracking-[0.04em] sv:text-zinc-500 sv:transition-colors hover:sv:bg-zinc-200 hover:sv:text-zinc-700"
      onClick={() => {
        const el = getDebuggerEl();
        if (el) {
          el.open = !el.open;
        }
      }}
      aria-label="Open debugger"
    >
      DBG
    </button>
  );
}
