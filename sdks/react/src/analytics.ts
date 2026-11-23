import type { AnalyticsOptions, TryOnAnalytics } from "@studio-vaai/core/analytics";

import { createTryOnAnalytics as createCoreAnalytics } from "@studio-vaai/core/analytics";

export function createTryOnAnalytics(
  options: Omit<AnalyticsOptions, "sdkVersion">,
): TryOnAnalytics {
  const analytics = createCoreAnalytics(options);
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
