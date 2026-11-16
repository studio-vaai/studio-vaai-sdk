import type { AnalyticsOptions, TryOnAnalytics } from "@studio-vaai/core/analytics";

import { createTryOnAnalytics as createCoreAnalytics } from "@studio-vaai/core/analytics";

declare const STUDIO_VAAI_REACT_VERSION: string;

export function createTryOnAnalytics(
  options: Omit<AnalyticsOptions, "sdkVersion">,
): TryOnAnalytics {
  const analytics = createCoreAnalytics({ ...options, sdkVersion: STUDIO_VAAI_REACT_VERSION });
  return {
    ...analytics,
    dispose() {
      // React runs the effect cleanups of a removed tree parent-first. A storefront that disposes
      // its analytics in an effect cleanup does so before StudioVaaiTryOn disposes the experience,
      // whose final events (a detached operation, the closed view) follow in the same flush.
      // Release after that flush so those events are still sent.
      queueMicrotask(() => {
        analytics.dispose();
      });
    },
  };
}
