/// studio vaai virtual try-on for Flutter and Dart.
///
/// The try-on logic is the shared Rust SDK core, called through Dart bindings
/// generated from the same UniFFI annotations as the iOS, Android and web SDKs.
/// This library exports the try-on journey, the state machine's types, and the
/// API types it takes; `package:studio_vaai/api.dart` has the whole API client
/// and `package:studio_vaai/core.dart` the core's own helpers.
library;

export 'src/generated/api.dart'
    show
        ApiClient,
        ApiException,
        ClientConfig,
        FailedTransportException,
        HttpHeader,
        HttpRequest,
        HttpResponse,
        HttpTransport,
        NotSentTransportException,
        ProductDetails,
        ProductVariant,
        TransportException;
export 'src/generated/state_machine.dart';
export 'src/generated/studio_vaai_core.dart' show ImageMetadata, readImageMetadata;
export 'src/session.dart';
export 'src/transport.dart';
