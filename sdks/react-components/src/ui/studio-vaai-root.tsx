import type { CSSProperties, ReactNode } from "react";

import type { SvTokenOverrides } from "../generated/tokens.js";

export interface StudioVaaiRootProps {
  children: ReactNode;
  /**
   * Typed `--sv-*` design-token overrides, applied as inline CSS variables on
   * the root element. Names + types are generated from the design tokens
   * (`../generated/tokens.ts`).
   */
  tokens?: SvTokenOverrides | undefined;
  /**
   * When `true`, the wrapper renders as a block-level `div`. Defaults to
   * `display: contents` so the wrapper doesn't affect layout — only its
   * `id="studio-vaai-root"` anchor matters for the prefixed Tailwind output.
   */
  asBlock?: boolean;
  className?: string;
}

/**
 * Root wrapper that establishes `#studio-vaai-root` so the prefixed Tailwind
 * stylesheet matches inside it. Also accepts typed design-token overrides.
 *
 * Use at the top of an SDK consumer's tree, or inside a portal that lifts
 * children outside the provider's wrapper (Base UI `Dialog.Portal`,
 * `Drawer.Portal`, `react-dom` `createPortal`).
 */
export function StudioVaaiRoot({
  children,
  tokens,
  asBlock = false,
  className,
}: StudioVaaiRootProps) {
  const style = {
    ...(tokens as CSSProperties),
    ...(asBlock ? {} : { display: "contents" }),
  } satisfies CSSProperties;
  return (
    <div id="studio-vaai-root" className={className} style={style}>
      {children}
    </div>
  );
}
