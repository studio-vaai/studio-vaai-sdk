import { ItemGlyph } from "@studio-vaai/core";

import type { SvIconName } from "../components/icon/sv-icon.js";

/** The web icon for each shared, platform-independent item glyph. */
export const itemGlyphIcon: Readonly<Record<ItemGlyph, SvIconName>> = {
  [ItemGlyph.ShirtButtoned]: "shirt-buttoned",
  [ItemGlyph.ShirtOpen]: "shirt-open",
};
