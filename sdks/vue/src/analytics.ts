import type { AnalyticsOptions, TryOnAnalytics } from "@studio-vaai/core/analytics";

import { createTryOnAnalytics as createCoreAnalytics } from "@studio-vaai/core/analytics";

declare const STUDIO_VAAI_VUE_VERSION: string;

export function createTryOnAnalytics(
  options: Omit<AnalyticsOptions, "sdkVersion">,
): TryOnAnalytics {
  return createCoreAnalytics({ ...options, sdkVersion: STUDIO_VAAI_VUE_VERSION });
}
