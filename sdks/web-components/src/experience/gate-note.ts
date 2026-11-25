import type { MessageId, MessageValues } from "@studio-vaai/core";

/** Why the fit gate refuses a size. */
export type GateRefusal = "too-small" | "too-large";

/** What the fit gate's note is made of, with the sizes already named. */
export interface GateNoteInput {
  /** The refusal the presentation warns about for the selected size, if any. */
  warning?: GateRefusal | undefined;
  /** The refusal of a host's size the selection already left (`gateSwitch`), if any. */
  switched?: GateRefusal | undefined;
  /** The refused size: the one the selection left, else the selected one. */
  requested: string;
  /** The next size along the run that can be tried on; undefined at the end of the run. */
  next?: string | undefined;
  /** True while choosing (no result shown yet), false over a shown result. */
  choosing: boolean;
}

/** The fit-gate note: why the picked size is refused, and the next size that can be tried on. */
export interface FitGateNote {
  id: MessageId;
  values: MessageValues;
}

/**
 * The fit gate's note, pure: the message and its values for a refused size. A refused size names
 * the next one along the size run that can be tried on, and the primary button offers it. Picking
 * on the size step reads as a recommendation; on a shown result, as an inspection of the picked
 * size. With no size left in that direction it says there is none. The Flutter SDK's
 * `gateNoteMessage` follows the same rules, checked against the shared vectors
 * (`sdks/flutter/test/shared_vectors/fit_overlay.json`).
 */
export function gateNote({
  warning,
  switched,
  requested,
  next,
  choosing,
}: GateNoteInput): FitGateNote | undefined {
  // The recommendation's fit gate refuses the selected size before any request; a host's size
  // the gate refused was already left for the next one, and the note says why.
  const refusal = warning ?? switched;
  if (refusal === undefined) {
    return globalThis.undefined;
  }
  const tooLarge = refusal === "too-large";
  if (next === undefined) {
    return {
      id: tooLarge
        ? "sizeAndStyleSelection.garmentTooLargeNoAlternativeNote"
        : "sizeAndStyleSelection.garmentTooSmallNoAlternativeNote",
      values: { requestedSize: requested },
    };
  }
  if (choosing) {
    return {
      id: tooLarge
        ? "sizeAndStyleSelection.garmentTooLargeNote"
        : "sizeAndStyleSelection.garmentTooSmallNote",
      values: { requestedSize: requested, recommendedSize: next },
    };
  }
  return {
    id: tooLarge ? "tryOnView.gateInspectTooLargeNote" : "tryOnView.gateInspectTooSmallNote",
    values: { sizeLabel: requested, recommendedSize: next },
  };
}
