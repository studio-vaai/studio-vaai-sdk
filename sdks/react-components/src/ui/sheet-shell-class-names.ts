/**
 * Per-slot `className` overrides for the sheet/modal shell. Each value is merged
 * (via `cn`) onto the built-in classes, so consumers can restyle a region without
 * replacing the component or matching internal component identities. The shared
 * vocabulary is identical across `BottomSheetShell`/`ModalShell`; keys that don't
 * apply to a given shell (e.g. `grabber`/`subfooter` on the modal) are no-ops.
 *
 * Lives in its own leaf module so the theme/provider layer and the shell
 * components can both reference it without a circular import.
 */
export interface SheetShellClassNames {
  /** Outermost shell container (the `surface-shell` landmark). */
  root?: string;
  /** Drag-handle grabber row (bottom sheet only). */
  grabber?: string;
  /** Header row containing back / title / close. */
  header?: string;
  /** Header back button. */
  backButton?: string;
  /** Header title (`Drawer.Title` / `Dialog.Title`). */
  title?: string;
  /** Header subtitle line rendered directly under the title. */
  subtitle?: string;
  /** Header close button. */
  closeButton?: string;
  /** Scrollable body region (the `surface-shell-main` landmark). */
  body?: string;
  /** Footer region. */
  footer?: string;
  /** Subfooter region (e.g. "powered by"). */
  subfooter?: string;
}
