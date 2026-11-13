import type { ItemDisplay } from "@studio-vaai/core";

import type { SvChipStatus } from "../../components/chip/sv-chip.js";
import type { OptionMark } from "./option-mark.js";

/** A visual choice after its owner has resolved selection, availability and stock. */
export interface Option {
  key: string;
  display: ItemDisplay;
  selected: boolean;
  mark?: OptionMark | undefined;
  disabled: boolean;
  status?: SvChipStatus | undefined;
  description?: string | undefined;
}
