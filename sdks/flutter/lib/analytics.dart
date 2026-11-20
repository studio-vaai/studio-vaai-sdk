/// studio vaai analytics for the try-on: the counterpart of the web SDK's
/// `@studio-vaai/core/analytics`. Pass [createTryOnAnalytics]'s result as a
/// `StudioVaaiTryOn`'s `analytics`.
library;

export 'src/analytics/analytics.dart'
    show
        CommerceAnalyticsEvent,
        TryOnAnalytics,
        analyticsVisitorId,
        createTryOnAnalytics,
        defaultAnalyticsBaseUrl;
export 'src/analytics/version.dart' show studioVaaiSdkVersion;
export 'src/experience/try_on_event.dart' show TryOnExperienceEvent, tryOnExperienceEventOf;
