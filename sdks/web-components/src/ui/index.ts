import type { SvUiOptions } from "./types.js";

import { SvUiContext } from "./context.js";

export { SvUiContext } from "./context.js";
export type { SvUiOptions, SvUiSnapshot } from "./types.js";
export type { SvAppearance } from "../internal/theme/tokens.js";

export function createUiContext(options?: SvUiOptions): SvUiContext {
  return new SvUiContext(options);
}

/** Shared SDK default; createUiContext().attach(root) gives independent mounts. */
export const ui = createUiContext();
