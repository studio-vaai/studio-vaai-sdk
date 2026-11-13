/**
 * Every distinct step in the studio vaai try-on flow state machine. Used as
 * the `source` and `current-step` value type on tracking events.
 *
 * This union is the analytics view of the flow — it doesn't have to match the
 * exact XState state IDs in `@studio-vaai/js-machine` 1:1. Callers translate
 * from machine state to {@link Step} at the event-emit site. Extend the union
 * here when a new flow step needs to appear in analytics.
 */
export type Step =
  | "entry"
  | "intro"
  | "image-record"
  | "image-upload"
  | "image-rejection"
  | "height"
  | "variant-selection"
  | "try-on";
