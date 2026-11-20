import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../experience/devices.dart';
import '../experience/experience.dart';
import '../experience/product.dart';
import '../analytics/analytics.dart';
import '../experience/session_store.dart';
import '../generated/state_machine.dart';
import '../session.dart';
import 'flow_view.dart';
import 'messages.dart';
import 'remote_image.dart';
import 'scope.dart';
import 'theme.dart';

/// How the experience is presented while open.
enum TryOnPresentation {
  /// A full-height modal sheet on phones, a centered dialog on wide windows:
  /// the same as the web SDK's dialog, which is a drawer on phones.
  adaptive,

  /// A full-screen page.
  fullScreen,
}

/// Opens and closes a [StudioVaaiTryOn], and says whether it is ready.
class StudioVaaiTryOnController extends ChangeNotifier {
  _StudioVaaiTryOnState? _state;

  /// Whether the product is installed and the experience can open.
  bool get ready => _state?._ready ?? false;

  /// The experience behind the widget, once created; for advanced hosts.
  TryOnExperience? get experience => _state?._experience;

  /// Opens the experience for the current product. Returns whether it opened.
  bool open([JourneyEntry? entry]) {
    final experience = _state?._experience;
    if (experience == null || !ready) return false;
    return experience.open(entry);
  }

  /// Closes the experience; the shopper's session and history stay.
  void close() => _state?._experience?.close();

  void _readyChanged() => notifyListeners();
}

/// The ready-made studio vaai virtual try-on, the Flutter counterpart of the
/// web and React SDKs' `StudioVaaiTryOn`.
///
/// Mount it once per product page (keep it mounted to keep the shopper's
/// session, photo and try-ons across products). It looks the product up,
/// installs it in the shared Rust core's default flow, and presents the
/// flow when [StudioVaaiTryOnController.open] is called: consent, photo
/// (library or camera with self-timer), height, variant selection and
/// try-ons, with every step, rule and text decided by the core.
class StudioVaaiTryOn extends StatefulWidget {
  const StudioVaaiTryOn({
    super.key,
    required this.sdk,
    this.productId,
    this.foreignId,
    required this.productName,
    required this.presentProduct,
    this.controller,
    this.locale,
    this.messages,
    this.appearance = TryOnAppearance.light,
    this.tokens,
    this.commerce,
    this.active = true,
    this.autoStart = AutoStartPolicy.never,
    this.presentation = TryOnPresentation.adaptive,
    this.onAddToCart,
    this.onDownload,
    this.onEvent,
    this.analytics,
    this.onError,
    this.onReadyChange,
    this.onLink,
    this.devices,
    this.imageProvider,
    this.keepSession = true,
    this.sessionStore,
    this.child,
  }) : assert((productId == null) != (foreignId == null), 'Pass a productId or a foreignId.');

  /// The shop's API client (its public client key). Share one across pages.
  final StudioVaai sdk;

  /// The product by its studio vaai ID, or by the shop's own [foreignId].
  final String? productId, foreignId;

  /// The product's name, shown as the try-on screen's title.
  final String productName;

  /// The product's axes, labels, selected variant and commerce, from the
  /// API's product details (see [simpleProductPresentation]). Read when a
  /// product is installed: when [productId] or [foreignId] changes.
  final PresentProduct presentProduct;

  final StudioVaaiTryOnController? controller;

  /// A BCP 47 locale such as `de` or `en-GB`; defaults to the app's locale.
  final String? locale;

  /// MessageFormat 2 overrides of the catalog's messages, by key, for [locale].
  final Map<String, String>? messages;

  final TryOnAppearance appearance;

  /// Brand colors and mix steps; defaults to the appearance's tokens.
  final TryOnTokens? tokens;

  /// Live prices and stock by variant ID, over [ProductPresentation.commerce].
  final Map<String, VariantCommerce>? commerce;

  /// Keep the shopper's session while temporarily away from the product.
  final bool active;

  final AutoStartPolicy autoStart;
  final TryOnPresentation presentation;

  /// Adds the exact variant to the cart. Completing closes nothing; throwing
  /// shows the cart error. Without it, adding to the bag is unavailable.
  final Future<void> Function(CartRequest request)? onAddToCart;

  /// Saves or shares a downloaded try-on image. Without it, no download button.
  final Future<void> Function(Uint8List bytes, String mimeType)? onDownload;

  /// The shopper's journey, the same facts as the web's `sv-try-on-*` events.
  final void Function(ExperienceEvent event)? onEvent;

  /// studio vaai analytics ([createTryOnAnalytics]): observes the
  /// experience's events, as the web components' `analytics` property.
  final TryOnAnalytics? analytics;
  final void Function(Object error)? onError;
  final void Function(bool ready)? onReadyChange;

  /// Opens a link from the legal copy (terms, privacy).
  final void Function(Uri uri)? onLink;

  /// The camera and photo library; defaults to [PlatformTryOnDevices].
  final TryOnDevices? devices;

  /// Keep the shopper's session, and the body made from their photo, for the
  /// next launch, as the web keeps its session cookie and body selection,
  /// until the API expires the session. False keeps nothing on the device.
  final bool keepSession;

  /// Where the session is kept; defaults to [SecureTryOnSessionStore] (the
  /// Keychain, or Keystore-encrypted storage on Android).
  final TryOnSessionStore? sessionStore;

  /// Loads remote images (try-on results, a restored session's photo);
  /// defaults to [TryOnNetworkImage], which also decodes the API's JPEG XL.
  final TryOnImageProvider? imageProvider;

  /// The host's own content, such as the product page's "Try on" button.
  final Widget? child;

  @override
  State<StudioVaaiTryOn> createState() => _StudioVaaiTryOnState();
}

class _StudioVaaiTryOnState extends State<StudioVaaiTryOn> {
  TryOnExperience? _experience;
  StreamSubscription<ExperienceEvent>? _events;
  void Function()? _stopAnalytics;
  TryOnMessages? _messages;
  (String, Map<String, String>?)? _messagesKey;
  bool _ready = false;
  Route<void>? _route;
  int _generation = 0;
  final _revision = ValueNotifier<int>(0);

  TryOnProductReference get _product => widget.foreignId != null
      ? TryOnProductReference.foreignId(widget.foreignId!)
      : TryOnProductReference.id(widget.productId!);

  @override
  void initState() {
    super.initState();
    widget.controller?._state = this;
    unawaited(_create());
  }

  Future<void> _create() async {
    final generation = ++_generation;
    try {
      final experience = await TryOnExperience.create(
        sdk: widget.sdk,
        product: _product,
        presentProduct: widget.presentProduct,
        devices: widget.devices ?? PlatformTryOnDevices(),
        autoStart: widget.autoStart,
        commerce: widget.commerce,
        active: widget.active,
        sessionStore: widget.keepSession
            ? (widget.sessionStore ?? SecureTryOnSessionStore())
            : null,
      );
      if (!mounted || generation != _generation) {
        experience.dispose();
        return;
      }
      setState(() => _experience = experience);
      _events = experience.events.listen(
        widget.onEvent == null ? null : (e) => widget.onEvent?.call(e),
      );
      _observeAnalytics();
      experience.addListener(_changed);
      _changed();
    } catch (error) {
      if (mounted && generation == _generation && !isTryOnProductUnavailable(error)) {
        widget.onError?.call(error);
      }
    }
  }

  void _observeAnalytics() {
    _stopAnalytics?.call();
    _stopAnalytics = null;
    final experience = _experience, analytics = widget.analytics;
    if (experience == null || analytics == null) return;
    _stopAnalytics = analytics.observe((listener) {
      final subscription = experience.tryOnEvents.listen(listener);
      return () => unawaited(subscription.cancel());
    });
  }

  void _teardown() {
    _generation++;
    _events?.cancel();
    _events = null;
    final experience = _experience;
    _experience = null;
    experience?.removeListener(_changed);
    _popRoute();
    experience?.dispose();
    // After the experience's final events (a detached operation, the closed view).
    _stopAnalytics?.call();
    _stopAnalytics = null;
    _setReady(false);
  }

  @override
  void didUpdateWidget(StudioVaaiTryOn oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      if (oldWidget.controller?._state == this) oldWidget.controller?._state = null;
      widget.controller?._state = this;
    }
    if (oldWidget.sdk != widget.sdk ||
        oldWidget.devices != widget.devices ||
        oldWidget.autoStart != widget.autoStart) {
      _teardown();
      unawaited(_create());
    } else if (_experience != null) {
      final experience = _experience!;
      // A new product reinstalls; [presentProduct] is read on each install,
      // so an inline closure does not reinstall on every rebuild.
      if (oldWidget.productId != widget.productId || oldWidget.foreignId != widget.foreignId) {
        _setReady(false);
        unawaited(
          experience
              .installProduct(_product, widget.presentProduct, commerce: widget.commerce)
              .then(
                (_) => _changed(),
                onError: (Object error) {
                  if (!isTryOnProductUnavailable(error)) widget.onError?.call(error);
                },
              ),
        );
      } else if (oldWidget.commerce != widget.commerce) {
        experience.updateCommerce(widget.commerce);
      }
      if (oldWidget.active != widget.active) experience.setProductActive(widget.active);
      if (oldWidget.analytics != widget.analytics) _observeAnalytics();
    }
    _revision.value++;
  }

  @override
  void dispose() {
    if (widget.controller?._state == this) widget.controller?._state = null;
    _teardown();
    _messages?.dispose();
    _revision.dispose();
    super.dispose();
  }

  void _setReady(bool ready) {
    if (_ready == ready) return;
    _ready = ready;
    widget.onReadyChange?.call(ready);
    widget.controller?._readyChanged();
  }

  void _changed() {
    final experience = _experience;
    if (!mounted || experience == null) return;
    _setReady(widget.active && experience.readyInstallation(_product) != null);
    final open = experience.view.presence.open || experience.failureVisible;
    if (open && _route == null) {
      _pushRoute();
    } else if (!open && _route != null) {
      _popRoute();
    }
  }

  TryOnMessages _messagesFor(BuildContext context) {
    final locale = widget.locale ?? Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';
    final key = (locale, widget.messages);
    if (_messages == null || _messagesKey != key) {
      final previous = _messages;
      try {
        _messages = TryOnMessages(locale, overrides: widget.messages);
        _messagesKey = key;
        previous?.dispose();
      } catch (error) {
        // An invalid override leaves the previous configuration, as on the web.
        widget.onError?.call(error);
        _messages ??= TryOnMessages(locale);
        _messagesKey = key;
      }
    }
    return _messages!;
  }

  void _pushRoute() {
    final navigator = Navigator.maybeOf(context);
    if (navigator == null) return;
    // The web dialog's query, `(min-width: 48em)`; narrower windows get the sheet.
    final wide = MediaQuery.sizeOf(context).width >= 768;
    Widget content(BuildContext context) => _RouteContent(state: this);
    final Route<void> route;
    if (widget.presentation == TryOnPresentation.fullScreen) {
      route = MaterialPageRoute<void>(builder: content, fullscreenDialog: true);
    } else if (wide) {
      route = DialogRoute<void>(
        context: context,
        barrierDismissible: false,
        builder: (context) => Center(
          child: ConstrainedBox(
            // The web's desktop dialog: 65rem × 50rem, 16 px from the window's edges.
            constraints: BoxConstraints(
              maxWidth: math.min(1040, MediaQuery.sizeOf(context).width - 32),
              maxHeight: math.min(800, MediaQuery.sizeOf(context).height - 32),
            ),
            // Rounded (radius xl) with the large shadow, as the web's desktop
            // dialog; only the phone's sheet has square edges.
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(TryOnTokens.radiusXl),
                boxShadow: const [
                  BoxShadow(color: Color(0x2E0A0A0A), blurRadius: 32, offset: Offset(0, 8)),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(TryOnTokens.radiusXl),
                child: content(context),
              ),
            ),
          ),
        ),
      );
    } else {
      route = ModalBottomSheetRoute<void>(
        builder: content,
        isScrollControlled: true,
        useSafeArea: true,
        enableDrag: false,
        isDismissible: false,
        backgroundColor: (widget.tokens ?? TryOnTokens.of(widget.appearance)).background,
        // Square edges, as the web's sheet (Material's default rounds the top).
        shape: const RoundedRectangleBorder(),
        clipBehavior: Clip.hardEdge,
      );
    }
    _route = route;
    unawaited(
      navigator.push(route).then((_) {
        if (_route == route) _route = null;
        // Dismissed by the system: the flow closes too.
        final experience = _experience;
        if (experience != null && experience.view.presence.open) experience.close();
      }),
    );
  }

  void _popRoute() {
    final route = _route;
    _route = null;
    if (route != null && route.isActive) route.navigator?.removeRoute(route);
  }

  @override
  Widget build(BuildContext context) {
    _messagesFor(context);
    return widget.child ?? const SizedBox.shrink();
  }
}

/// The open experience inside its route, rebuilt when the host widget changes.
class _RouteContent extends StatelessWidget {
  const _RouteContent({required this.state});
  final _StudioVaaiTryOnState state;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<int>(
    valueListenable: state._revision,
    builder: (context, _, _) {
      final widget = state.widget;
      final experience = state._experience;
      final messages = state._messages;
      if (experience == null || messages == null) return const SizedBox.shrink();
      return TryOnExperienceView(
        experience: experience,
        messages: messages,
        appearance: widget.appearance,
        tokens: widget.tokens,
        productName: widget.productName,
        onAddToCart: widget.onAddToCart,
        onDownload: widget.onDownload,
        onError: widget.onError,
        onLink: widget.onLink,
        imageProvider: widget.imageProvider,
      );
    },
  );
}

/// The experience's screens for an existing [TryOnExperience], without a
/// route: embed it in your own page or sheet. [StudioVaaiTryOn] uses it.
class TryOnExperienceView extends StatelessWidget {
  const TryOnExperienceView({
    super.key,
    required this.experience,
    required this.messages,
    this.appearance = TryOnAppearance.light,
    this.tokens,
    this.productName,
    this.onAddToCart,
    this.onDownload,
    this.onError,
    this.onLink,
    this.imageProvider,
  });

  final TryOnExperience experience;
  final TryOnMessages messages;
  final TryOnAppearance appearance;
  final TryOnTokens? tokens;
  final String? productName;
  final Future<void> Function(CartRequest request)? onAddToCart;
  final Future<void> Function(Uint8List bytes, String mimeType)? onDownload;
  final void Function(Object error)? onError;
  final void Function(Uri uri)? onLink;
  final TryOnImageProvider? imageProvider;

  @override
  Widget build(BuildContext context) {
    final t = tokens ?? TryOnTokens.of(appearance);
    return Theme(
      data: tryOnThemeData(t, appearance),
      child: TryOnScope(
        messages: messages,
        tokens: t,
        appearance: appearance,
        imageProvider: imageProvider ?? TryOnNetworkImage.new,
        onLink: onLink,
        child: Material(
          color: t.background,
          child: PopScope(
            canPop: false,
            onPopInvokedWithResult: (didPop, _) {
              if (didPop) return;
              // The system back gesture is the flow's Back, or Close at the start.
              if (experience.failure != null) {
                experience.close();
              } else if (experience.view.canGoBack) {
                experience.dispatchShopper(NavigationFlowAction(NavigationAction.back));
              } else {
                experience.close();
              }
            },
            child: DefaultTextStyle.merge(
              style: TextStyle(
                fontFamily: TryOnTokens.fontFamily,
                fontFamilyFallback: TryOnTokens.fontFamilyFallback,
                color: t.foreground,
              ),
              child: TryOnFlowView(
                experience: experience,
                productName: productName,
                onAddToCart: onAddToCart,
                onDownload: onDownload,
                onError: onError,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
