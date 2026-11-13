/**
 * The frosted-glass card surface, shared by every panel that floats over content — today the
 * try-on's size/color picker and the size step's, in both the sheet and the modal.
 *
 * It is one exported constant rather than a repeated class string because these panels are the
 * SAME control on consecutive screens: when the styling was duplicated they drifted, and the two
 * steps visibly stopped matching. Change it here and every surface moves together.
 *
 * Sampled from the demo shop's scrolled navbar and then opened up: `#F2F2F0` at 60% over a `sm`
 * blur with a touch of saturation, lifted by the same soft shadow. The fill and the blur are what
 * decide how much of the render reads through, so tune them together — dropping the fill alone
 * leaves the blur doing the hiding.
 */
export const FROSTED_CARD_CLASS =
  "sv:min-w-0 sv:shrink-0 sv:overflow-hidden sv:rounded-[var(--sv-radius-control)] sv:bg-[var(--sv-color-overlay-card)] sv:shadow-[0_2px_16px_rgba(0,0,0,0.07)] sv:backdrop-blur-sm sv:backdrop-saturate-150";
