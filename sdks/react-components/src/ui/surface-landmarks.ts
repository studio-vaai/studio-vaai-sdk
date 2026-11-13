/** Default {@link SurfaceLandmarks.resolveShell} selector on {@link SheetShell}. */
export const SURFACE_SHELL_SELECTOR = '[data-studio-vaai="surface-shell"]';

/** Default {@link SurfaceLandmarks.resolveShellMain} selector on {@link SheetShell}. */
export const SURFACE_SHELL_MAIN_SELECTOR = '[data-studio-vaai="surface-shell-main"]';

export type SurfaceLandmarkResolver = (from: HTMLElement) => HTMLElement | null;

/**
 * DOM landmark resolvers for scroll-aware preview sizing and related sheet layout
 * measure. Override via {@link StudioVaaiUiProvider} `surfaceLandmarks`.
 */
export interface SurfaceLandmarks {
  /** Sliding panel / modal popup (max-height cap). */
  resolvePopup: SurfaceLandmarkResolver;
  /** Chrome boundary — header, footer, grabber vs scroll body. */
  resolveShell: SurfaceLandmarkResolver;
  /** Scrollport (`overflow-y-auto` or clip body). */
  resolveShellMain: SurfaceLandmarkResolver;
  /** When true, defer px commit until popup geometry is stable (e.g. sheet enter). */
  isPopupEnterAnimating: (popup: HTMLElement) => boolean;
}

export type PartialSurfaceLandmarks = Partial<SurfaceLandmarks>;

export function defaultResolveSurfacePopup(from: HTMLElement): HTMLElement | null {
  return (
    from.closest<HTMLElement>(".sv-sheet-content") ?? from.closest<HTMLElement>(".sv-modal-content")
  );
}

export function defaultResolveSurfaceShell(from: HTMLElement): HTMLElement | null {
  return from.closest<HTMLElement>(SURFACE_SHELL_SELECTOR);
}

export function defaultResolveSurfaceShellMain(from: HTMLElement): HTMLElement | null {
  return from.closest<HTMLElement>(SURFACE_SHELL_MAIN_SELECTOR);
}

export function defaultIsPopupEnterAnimating(popup: HTMLElement): boolean {
  return (
    popup.classList.contains("sv-sheet-content") && Object.hasOwn(popup.dataset, "startingStyle")
  );
}

export const defaultSurfaceLandmarks: SurfaceLandmarks = {
  resolvePopup: defaultResolveSurfacePopup,
  resolveShell: defaultResolveSurfaceShell,
  resolveShellMain: defaultResolveSurfaceShellMain,
  isPopupEnterAnimating: defaultIsPopupEnterAnimating,
};

export function mergeSurfaceLandmarks(override?: PartialSurfaceLandmarks): SurfaceLandmarks {
  return {
    resolvePopup: override?.resolvePopup ?? defaultSurfaceLandmarks.resolvePopup,
    resolveShell: override?.resolveShell ?? defaultSurfaceLandmarks.resolveShell,
    resolveShellMain: override?.resolveShellMain ?? defaultSurfaceLandmarks.resolveShellMain,
    isPopupEnterAnimating:
      override?.isPopupEnterAnimating ?? defaultSurfaceLandmarks.isPopupEnterAnimating,
  };
}
