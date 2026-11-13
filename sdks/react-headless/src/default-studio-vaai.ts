import { createTrackingSubscriber, defaultRootMachine } from "@studio-vaai/js-machine";

import { createStudioVaaiContext } from "./studio-vaai-context.js";

/**
 * Pre-wired context for {@link defaultRootMachine}; use {@link StudioVaaiProvider}
 * and hooks from this object for the default try-on flow.
 *
 * Tracking is wired automatically: the provider creates a
 * {@link TrackingSubscriber} on mount via {@link createTrackingSubscriber}.
 * Machine-emitted analytics flow through the bridge unchanged; host events
 * (entrypoint-clicked, view-closed, cart-item-added, …) go via
 * {@link useStudioVaaiTracking}.
 */
export const defaultStudioVaai = createStudioVaaiContext(defaultRootMachine, {
  subscribeTracking: createTrackingSubscriber,
});
