import type { TryOnFlowProduct, VariantAttributes } from "@studio-vaai/js-machine";
import type { DefaultRootViewModel } from "@studio-vaai/react-headless";
import type { ReactNode } from "react";

import type { StudioVaaiUiMessages } from "../i18n/index.js";

/**
 * A "click-disabled" interaction error: the user clicked a CTA that should have
 * been disabled (a precondition wasn't met). Stored as a *reason tag* rather than
 * a message — {@link deriveError} maps the tag to a localized message and, crucially,
 * gates it through the *same* precondition that drives the button's `disabled`
 * state, so the error self-clears the moment the precondition resolves (see the
 * `RESOLVED` registry).
 *
 * Adding a new always-enabled CTA = add a tag here + a `RESOLVED`/`MESSAGE` entry.
 */
export type InteractionReason = "consentRequired" | "selectionRequired";

/**
 * Everything {@link deriveError} reads. Assembled fresh each render in the flow,
 * so the derivation is pure and effect-free — no snapshot→state mirroring.
 */
export interface DeriveErrorInputs {
  /** The active click-disabled reason, or `undefined` when none is pending. */
  reason: InteractionReason | undefined;
  /** Whether the session-intro consent checkbox is ticked (lifted to the flow). */
  consented: boolean;
  vm: DefaultRootViewModel;
  product: TryOnFlowProduct;
  selection: VariantAttributes;
  ui: StudioVaaiUiMessages;
  /**
   * The machine-/state-derived error for the *currently active* screen (upload
   * failure, validation rejection, try-on error, …), already resolved by the flow.
   * Shown only when no interaction error is active — the interaction error wins
   * because it's the immediate response to the click the user just made.
   */
  machineError: ReactNode | undefined;
}

/** True once the precondition behind `reason` is satisfied (error should vanish). */
const RESOLVED: Record<InteractionReason, (i: DeriveErrorInputs) => boolean> = {
  consentRequired: (i) => i.consented,
  selectionRequired: (i) => i.vm.canStartTryOn,
};

/** Builds the localized message for `reason` from the live inputs. */
const MESSAGE: Record<InteractionReason, (i: DeriveErrorInputs) => ReactNode> = {
  consentRequired: (i): ReactNode => i.ui.sessionIntro.consentRequired,
  selectionRequired: (i): ReactNode => i.ui.productOverview.selectionRequired(missingAxisNames(i)),
};

/**
 * Localized names of the attribute axes the product exposes but the user hasn't
 * picked yet. Computed live, so the prompt shrinks ("size and color" → "color")
 * as the user makes selections. Adding an axis to `attributeMetadata` = one
 * branch here + one `attributeName.*` string.
 */
function missingAxisNames(i: DeriveErrorInputs): string[] {
  const { attributeMetadata } = i.product;
  const names: string[] = [];
  if (attributeMetadata.sizes.length > 0 && i.selection["size"] === undefined) {
    names.push(i.ui.productOverview.attributeName.size);
  }
  if (attributeMetadata.colorways.length > 0 && i.selection["colorway"] === undefined) {
    names.push(i.ui.productOverview.attributeName.color);
  }
  return names;
}

/** Whether a stored reason is now resolved (used by the flow's cleanup effect). */
export function isReasonResolved(reason: InteractionReason, i: DeriveErrorInputs): boolean {
  return RESOLVED[reason](i);
}

/**
 * The single source of truth for "what error is showing." Pure and computed in
 * render: folds the click-disabled interaction error (gated by its precondition)
 * with the active screen's machine error. Interaction error wins.
 */
/**
 * Why the message is showing, which decides how it is drawn.
 *
 * `"interaction"` answers a click the shopper just made ("pick a size first") — a nudge, and
 * the reference draws it as a plain line under the control. `"failure"` is something that went
 * wrong on its own (upload, try-on, recommendation) and stops the screen; the reference boxes
 * those. Deriving it here rather than letting each screen guess is what keeps a system error
 * from rendering like a form-field footnote.
 */
export interface DerivedError {
  message: ReactNode;
  kind: "interaction" | "failure";
}

export function deriveError(i: DeriveErrorInputs): DerivedError | undefined {
  if (i.reason !== undefined && !RESOLVED[i.reason](i)) {
    return { message: MESSAGE[i.reason](i), kind: "interaction" };
  }
  if (i.machineError === undefined || i.machineError === null || i.machineError === false) {
    return undefined;
  }
  return { message: i.machineError, kind: "failure" };
}
