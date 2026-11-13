/**
 * Where the user started a gallery upload or in-browser camera capture.
 * Distinct from {@link Step} — these are intentional entry points, not
 * derived machine-state snapshots.
 */
export type ImageFlowSource = "intro" | "variant-selection" | "image-rejection" | "height";
