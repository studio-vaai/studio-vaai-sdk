import { installClientInterceptor } from "@studio-vaai/js-client";

import { createDebugClient } from "./debug-client.js";
// Side effect: registers the <studio-vaai-debugger> custom element.
import "./web-components/studio-vaai-debugger.js";

/**
 * Activate the studio vaai debugger:
 * 1. Registers the `<studio-vaai-debugger>` custom element (via side-effect import above).
 * 2. Creates the element and appends it to `document.body` if not already present.
 * 3. Installs the debug client interceptor so every `StudioVaaiProvider` automatically
 *    uses the wrapped client for error injection and API call logging.
 *
 * Returns an uninstall function that removes the client interceptor.
 * Not idempotent: the element append is guarded against duplicates, but each call pushes a
 * fresh interceptor onto the stack — call the returned uninstall function to clean up.
 */
export function setupStudioVaaiDebugger(): () => void {
  if (typeof document !== "undefined" && !document.querySelector("studio-vaai-debugger")) {
    document.body.append(document.createElement("studio-vaai-debugger"));
  }
  return installClientInterceptor(createDebugClient);
}
