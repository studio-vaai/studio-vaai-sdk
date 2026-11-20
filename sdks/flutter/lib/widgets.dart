/// Ready-made Flutter widgets for studio vaai virtual try-on.
///
/// [StudioVaaiTryOn] presents the default try-on experience: the shared Rust
/// core's flow decides every screen and step, and these widgets render its
/// view and send the shopper's actions back, as the web SDK's components do.
library;

export 'analytics.dart';
export 'src/experience/devices.dart'
    show DeviceFailure, DevicePhoto, PlatformTryOnDevices, TryOnCamera, TryOnDevices;
export 'src/experience/experience.dart'
    show TryOnExperience, TryOnRendererHost, isTryOnProductUnavailable;
export 'src/experience/photo_preparation.dart'
    show PhotoInputException, UnsupportedPhotoException, preparePhotoForUpload;
export 'src/experience/product.dart'
    show
        PresentProduct,
        ProductPresentation,
        TryOnProductReference,
        VariantCommerce,
        simpleProductPresentation;
export 'src/experience/session_store.dart'
    show MemoryTryOnSessionStore, SecureTryOnSessionStore, StoredTryOnSession, TryOnSessionStore;
export 'src/ui/flow_view.dart' show TryOnFlowView;
export 'src/ui/remote_image.dart' show TryOnNetworkImage;
export 'src/ui/messages.dart' show TryOnMessages;
export 'src/ui/scope.dart' show TryOnImageProvider;
export 'src/ui/studio_vaai_try_on.dart'
    show StudioVaaiTryOn, StudioVaaiTryOnController, TryOnExperienceView, TryOnPresentation;
export 'src/ui/theme.dart' show TryOnAppearance, TryOnMixSteps, TryOnTokens;
