import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../experience/experience.dart';
import '../generated/state_machine.dart';
import 'components.dart';
import 'fit.dart';
import 'flow_image.dart';
import 'gate_note.dart';
import 'pinch_zoom.dart';
import 'scope.dart';
import 'screens.dart';
import 'theme.dart';
import 'try_on_view.dart';

const _photoRejectionMessages = {
  PhotoRejection.noHumanDetected: 'bodyFailure.noHumanDetected',
  PhotoRejection.humanOccluded: 'bodyFailure.humanOccluded',
  PhotoRejection.humanNotStanding: 'bodyFailure.humanNotStanding',
  PhotoRejection.humanTooSmall: 'bodyFailure.humanTooSmall',
  PhotoRejection.inappropriateClothing: 'bodyFailure.inappropriateClothing',
  PhotoRejection.multiplePeople: 'bodyFailure.multiplePeople',
  PhotoRejection.feetNotVisible: 'bodyFailure.feetNotVisible',
};

const _warnings = {
  TryOnWarning.heightUncertain: 'experience.heightUncertain',
  TryOnWarning.renderUncertain: 'experience.renderUncertain',
  TryOnWarning.pickerFailed: 'experience.pickerFailed',
  TryOnWarning.tooSmall: 'experience.tryOnTooSmall',
  TryOnWarning.tooLarge: 'experience.tryOnTooLarge',
  TryOnWarning.outOfStock: 'experience.variantUnavailable',
};

const _failures = {
  TryOnFailureKind.tooSmall: ('experience.tryOnTooSmall', 'experience.namedTryOnTooSmall'),
  TryOnFailureKind.tooLarge: ('experience.tryOnTooLarge', 'experience.namedTryOnTooLarge'),
  TryOnFailureKind.bodyMissing: ('experience.bodyMissing', null),
  TryOnFailureKind.variantMissing: ('experience.tryOnVariantMissing', null),
  TryOnFailureKind.inputsUnavailable: ('experience.tryOnInputsUnavailable', null),
  TryOnFailureKind.noSuitableSize: ('experience.noSuitableSize', null),
  TryOnFailureKind.failed: ('experience.tryOnFailed', 'experience.namedTryOnFailed'),
};

/// Renders the default flow's view and sends the shopper's actions back:
/// the Flutter counterpart of the web's `sv-try-on-experience`. It holds no
/// journey state of its own, only what is purely visual (which disclosure
/// is open).
class TryOnFlowView extends StatefulWidget {
  const TryOnFlowView({
    super.key,
    required this.experience,
    this.productName,
    this.onAddToCart,
    this.onDownload,
    this.onError,
    this.fitScore = false,
  });

  final TryOnExperience experience;
  final String? productName;

  /// Shows the fit score on each result, with its intended fit and the fit
  /// callouts on the image. Off by default; the size recommendation and the
  /// fit gate's note work either way.
  final bool fitScore;
  final Future<void> Function(CartRequest request)? onAddToCart;
  final Future<void> Function(Uint8List bytes, String mimeType)? onDownload;
  final void Function(Object error)? onError;

  @override
  State<TryOnFlowView> createState() => _TryOnFlowViewState();
}

class _TryOnFlowViewState extends State<TryOnFlowView>
    with WidgetsBindingObserver
    implements TryOnRendererHost {
  TryOnExperience get _e => widget.experience;
  InteractionToken? _token;
  bool _photoFactsOpen = false, _withdrawalOpen = false, _fitDetailsOpen = false;
  String? _activeCallout;
  Timer? _ticker;
  Size? _resultSize;
  final _photoImages = <MediaId, ImageProvider>{};

  /// The signed URL each restored photo was last shown from, to evict its
  /// decoded image once the API deletes the photo.
  final _photoUrls = <MediaId, String>{};
  Type? _lastScreen;
  String? _lastShown;
  Object? _reportedFailure;

  /// The web's wide layout (40rem and up), from the last layout.
  bool _wide = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _attach();
  }

  void _attach() {
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _token = _e.attachRenderer(
      this,
      foreground: lifecycle == null || lifecycle == AppLifecycleState.resumed,
      canAddToCart: widget.onAddToCart != null,
    );
    _e.addListener(_changed);
  }

  void _detach(TryOnExperience experience) {
    experience.removeListener(_changed);
    final token = _token;
    if (token != null && !experience.isDisposed) experience.detachRenderer(token);
    _token = null;
  }

  @override
  void didUpdateWidget(TryOnFlowView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.experience != widget.experience) {
      _detach(oldWidget.experience);
      _photoImages.clear();
      _photoUrls.clear();
      _attach();
    } else if ((oldWidget.onAddToCart == null) != (widget.onAddToCart == null)) {
      _e.setCartAvailable(widget.onAddToCart != null);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _ticker?.cancel();
    _detach(_e);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The library picker is another activity on Android: the app pauses
    // while it is open, and the flow must keep waiting for its photo.
    if (_e.view.modal is PickerModal) return;
    switch (state) {
      case AppLifecycleState.resumed:
        _guard(() => _e.setForeground(true));
      case AppLifecycleState.paused || AppLifecycleState.hidden:
        _guard(() => _e.setForeground(false));
      default:
        break;
    }
  }

  void _changed() {
    if (!mounted) return;
    final view = _e.view;
    final screen = view.screen.runtimeType;
    final shown = view.journey.shownResult;
    if (screen != _lastScreen || !view.presence.open) {
      _photoFactsOpen = _withdrawalOpen = _fitDetailsOpen = false;
      _activeCallout = null;
    } else if (shown != _lastShown) {
      _fitDetailsOpen = false;
      _activeCallout = null;
    }
    _lastScreen = screen;
    _lastShown = shown;
    final counting =
        view.screen is CameraScreenView &&
        (view.screen as CameraScreenView).camera is CountdownCameraState;
    if (counting && _ticker == null) {
      _ticker = Timer.periodic(const Duration(milliseconds: 150), (_) => setState(() {}));
    } else if (!counting) {
      _ticker?.cancel();
      _ticker = null;
    }
    final failure = _e.failure;
    if (failure != null && !identical(failure, _reportedFailure)) {
      _reportedFailure = failure;
      widget.onError?.call(failure);
    }
    setState(() {});
  }

  // --- TryOnRendererHost ---------------------------------------------------

  @override
  Future<void> addToCart(CartRequest request) async {
    final handler = widget.onAddToCart;
    if (handler == null) throw StateError('No cart handler.');
    await handler(request);
  }

  @override
  Future<void> download(Uint8List bytes, String mimeType) async {
    final handler = widget.onDownload;
    if (handler == null) throw StateError('No download handler.');
    await handler(bytes, mimeType);
  }

  // --- Actions --------------------------------------------------------------

  void _guard(VoidCallback action) {
    try {
      action();
    } catch (error) {
      widget.onError?.call(error);
    }
  }

  void _dispatch(FlowAction action) => _guard(() => _e.dispatchShopper(action));

  void _back() => _dispatch(NavigationFlowAction(NavigationAction.back));
  void _close() => _dispatch(PresenceFlowAction(PresenceAction.close));
  void _beginPhoto(PhotoSource source) =>
      _dispatch(PhotoFlowAction(BeginSourcePhotoAction(source)));
  void _cancelModal() => _dispatch(NavigationFlowAction(NavigationAction.cancelModal));

  void _replacePhoto() {
    if (_e.view.domain.photo?.source == PhotoSource.library_) {
      _beginPhoto(PhotoSource.library_);
    } else {
      _dispatch(PhotoFlowAction(ReplacePhotoAction()));
    }
  }

  ScreenNavigation _navigation(FlowView view) => ScreenNavigation(
    back: view.canGoBack
        ? BackState.available
        : (view.screen is IntroductionScreenView ? BackState.hidden : BackState.disabled),
    onBack: _back,
    onClose: _close,
  );

  // --- Images ---------------------------------------------------------------

  /// The photo of [media], reporting its decode when the flow shows it.
  Widget _photo(FlowView view, MediaId? media, {String altKey = 'photo.previewAlt'}) {
    final scope = TryOnScope.of(context);
    final photo = media == null ? null : _e.photo(media);
    if (photo != null && photo.gone) {
      // Deleted by the API: drop the decoded image too, not just its display.
      final shown = _photoUrls.remove(media);
      if (shown != null) unawaited(scope.imageProvider(shown).evict());
    }
    if (photo == null || photo.gone) return const StagePlaceholder();
    // A restored session's photo is the API's signed URL; a new one on the device, its bytes.
    final url = photo.url;
    if (url != null) _photoUrls[media!] = url;
    final provider = url != null
        ? scope.imageProvider(url)
        : (_photoImages[media!] ??= MemoryImage(photo.original!.bytes));
    final source = view.renderMedia?.source;
    final reports =
        source != null &&
        source.target is SourceImageTarget &&
        (source.target as SourceImageTarget).media == media;
    return FlowImage(
      image: provider,
      loadKey: reports ? (source.asset, source.load) : media,
      semanticLabel: scope.messages.text(altKey),
      onDecoded: reports ? (ready) => _guard(() => _e.imageDecoded(source, ready: ready)) : null,
    );
  }

  List<Widget> _recovery(FlowView view, [List<Widget> content = const []]) => [
    ...content,
    if (view.issue is RejectedIssue)
      TryOnMessage(TryOnScope.text(context, 'experience.actionFailed')),
  ];

  TryOnMessage? _message(String? key, [Map<String, Object> values = const {}]) =>
      key == null ? null : TryOnMessage(TryOnScope.text(context, key, values));

  TryOnMessage? _sourceImageRecovery(FlowView view, MediaId? media) {
    final source = view.renderMedia?.source;
    // A photo the API deleted is no failure: the flow asks for a new one instead.
    if (media != null && _e.photo(media)?.gone == true) return null;
    return source != null &&
            source.target is SourceImageTarget &&
            (source.target as SourceImageTarget).media == media &&
            source.phase == ImagePhase.failed
        ? _message('experience.photoImageFailed')
        : null;
  }

  String? _pickerError(FlowView view) =>
      view.issue is PickerFailedIssue ? 'experience.pickerFailed' : null;

  /// A calm request for a new photo once the shopper's earlier one is gone
  /// (the API deletes it with the session's data): no error, nothing went
  /// wrong. For [media], when that restored photo was deleted while shown;
  /// without, when a restore found no stored photo.
  TryOnMessage? _addPhoto([MediaId? media]) {
    final gone = media == null ? _e.photoGone : _e.photo(media)?.gone == true;
    return gone
        ? TryOnMessage(
            TryOnScope.text(context, 'experience.addPhotoToTryOn'),
            variant: MessageVariant.neutral,
          )
        : null;
  }

  /// Whether a chosen photo is being sent and processed. The screen it was
  /// chosen from stays, its primary button spinning, and the flow moves on
  /// once the photo is processed: there is no processing screen. A photo
  /// that failed still shows on its own screen with its recovery.
  bool _uploadingPhoto(FlowView view) {
    final upload = view.journey.photoUpload;
    return view.journey.step == JourneyStep.photoUpload &&
        upload != null &&
        !upload.showCamera &&
        upload.phase == PhotoUploadPhase.pending;
  }

  /// The fit gate's note on the size row (the web's `fitGateNote`): why the
  /// selected size is refused, and the next size that can be tried on, which
  /// the primary button offers. Picking on the size step reads as a
  /// recommendation; over a shown result, as an inspection of the picked
  /// size. A host's size the gate refused was already left for the next one:
  /// the note says why. With no size left in that direction it says so.
  String? _fitGateNote(FlowView view, TryOnScreenView screen) {
    final selection = screen.selection;
    final presentation = screen.presentation;
    final switched = presentation.gateSwitch;
    final variants = view.domain.product?.variants ?? const <Variant>[];
    final sizeRows = selection.rows.where((r) => r.role == AxisRole.size);
    final formats = [
      for (final f in selection.labelFormats)
        if (f.role == AxisRole.size) f,
    ];
    String sizeOf(String variantId) =>
        sizeLabelText(labelFor(variantId, variants, sizeRows, formats));
    final next = switched?.toVariantId ?? presentation.nextFittingVariantId;
    final note = gateNoteMessage(
      warning: switch (presentation.feedback?.warning) {
        TryOnWarning.tooSmall => GateRefusal.tooSmall,
        TryOnWarning.tooLarge => GateRefusal.tooLarge,
        _ => null,
      },
      switched: switch (switched?.reason) {
        RefusalReason.garmentTooSmall => GateRefusal.tooSmall,
        RefusalReason.garmentTooLarge => GateRefusal.tooLarge,
        null => null,
      },
      requested: sizeOf(switched?.fromVariantId ?? selection.variantId),
      next: next == null ? null : sizeOf(next),
      choosing: presentation.mode == PresentationMode.selection,
    );
    return note == null ? null : TryOnScope.of(context).messages.text(note.key, note.values);
  }

  // --- Screens ----------------------------------------------------------------

  Widget _screen(FlowView view) {
    final upload = view.journey.photoUpload;
    if (view.journey.step == JourneyStep.photoUpload &&
        upload != null &&
        !upload.showCamera &&
        !_uploadingPhoto(view)) {
      return _staged(view, upload.phase);
    }
    return switch (view.screen) {
      IntroductionScreenView(:final consentGiven) => _intro(view, consentGiven),
      final CameraScreenView camera => _camera(view, camera),
      final PhotoRejectedScreenView rejected => _rejected(view, rejected),
      final HeightScreenView height => _height(view, height),
      final TryOnScreenView tryOn => _tryOn(view, tryOn),
      _ => const SizedBox.shrink(),
    };
  }

  Widget _intro(FlowView view, bool consented) {
    final m = TryOnScope.of(context).messages;
    final session = view.domain.session;
    final restoringFailed = session == SessionPhase.restoreFailed;
    String? error = _pickerError(view);
    if (restoringFailed) {
      error = 'experience.sessionRestoreFailed';
    } else if (session == SessionPhase.createFailed) {
      error = 'sessionIntro.createSessionError';
    } else if (view.issue is SessionExpiredIssue) {
      error = 'experience.sessionExpired';
    }
    // An open picker, or the session it creates, is not yet an upload: the
    // picker can still be cancelled, and the photo is only sent once chosen.
    final busy = session == SessionPhase.restoring || _uploadingPhoto(view);
    return IntroScreen(
      navigation: _navigation(view),
      consented: consented,
      consentRequired: session != SessionPhase.ready,
      busy: busy,
      photoFactsOpen: _photoFactsOpen,
      withdrawalOpen: _withdrawalOpen,
      recoveryOnly: restoringFailed,
      recovery: restoringFailed
          ? TryOnButton(
              label: m.text('experience.retrySession'),
              onPressed: () => _dispatch(SessionFlowAction(RetrySessionAction())),
            )
          : null,
      error: error == null ? null : m.text(error),
      consentError: view.issue is ConsentRequiredIssue
          ? m.text('sessionIntro.consentRequired')
          : null,
      recovering: _recovery(view, [if (!restoringFailed) ?_addPhoto()]),
      onConsent: (value) => _dispatch(SessionFlowAction(SetConsentSessionAction(value))),
      onPhotoFacts: (open) => setState(() => _photoFactsOpen = open),
      onWithdrawal: (open) => setState(() => _withdrawalOpen = open),
      onUpload: () => _beginPhoto(PhotoSource.library_),
      onCamera: () => _beginPhoto(PhotoSource.camera),
    );
  }

  Widget _staged(FlowView view, PhotoUploadPhase phase) {
    final staged = view.photoChange?.newPhoto?.photo;
    final busy = phase == PhotoUploadPhase.pending;
    final m = TryOnScope.of(context).messages;
    String? error;
    Widget? primary;
    void choose() => _dispatch(PhotoFlowAction(ReplacePhotoAction()));
    switch (phase) {
      case PhotoUploadPhase.uncertain:
        error = 'experience.photoUncertain';
        primary = TryOnButton(label: m.text('experience.choosePhoto'), onPressed: choose);
      case PhotoUploadPhase.invalidPhoto || PhotoUploadPhase.failed:
        error = phase == PhotoUploadPhase.invalidPhoto
            ? 'experience.photoInvalid'
            : 'experience.photoFailed';
        primary = TryOnButton(label: m.text('experience.choosePhoto'), onPressed: choose);
      case PhotoUploadPhase.retryableFailure:
        error = 'experience.photoFailed';
        primary = TryOnButton(
          label: m.text('experience.retryPhoto'),
          onPressed: () => _dispatch(PhotoFlowAction(RetryPhotoAction())),
        );
      default:
        break;
    }
    return StagedPhotoScreen(
      navigation: _navigation(view),
      photo: _photo(view, staged?.media),
      busy: busy,
      primary: primary,
      recovery: _recovery(view, [?_message(error), ?_sourceImageRecovery(view, staged?.media)]),
    );
  }

  Widget _camera(FlowView view, CameraScreenView screen) {
    final m = TryOnScope.of(context).messages;
    final staged = view.photoChange?.newPhoto;
    if (staged != null) {
      return CaptureScreen(
        navigation: _navigation(view),
        state: CaptureState.uploading,
        photo: _photo(view, staged.photo.media, altKey: 'photo.reviewAlt'),
        recovery: _recovery(view, [?_sourceImageRecovery(view, staged.photo.media)]),
        canChoosePhoto: false,
      );
    }
    final camera = screen.camera;
    var state = CaptureState.permission;
    String? lease;
    var busy = true;
    String? status = view.domain.session == SessionPhase.ready
        ? 'experience.requestingCamera'
        : 'experience.preparingSession';
    var seconds = 0;
    var canStartTimer = false;
    switch (camera) {
      case LiveCameraState(lease: final l, :final preview):
        state = CaptureState.live;
        lease = l;
        busy = false;
        status = null;
        canStartTimer = preview == CameraPreview.ready;
      case CapturingCameraState(lease: final l):
        state = CaptureState.live;
        lease = l;
        status = null;
      case CountdownCameraState(lease: final l, :final deadline):
        state = CaptureState.live;
        lease = l;
        busy = false;
        status = null;
        seconds = ((deadline - monotonicNow()) / 1000).ceil().clamp(1, 99);
      case UnavailableCameraState(:final error):
        busy = false;
        status = null;
        state = switch (error) {
          DeviceException.permissionDenied => CaptureState.denied,
          DeviceException.unavailable => CaptureState.unavailable,
          _ => CaptureState.error,
        };
      default:
        break;
    }
    final device = lease == null ? null : _e.camera(lease);
    var statusMessage = status == null ? null : m.text(status);
    if (view.modal is PickerModal) statusMessage = m.text('experience.choosingPhoto');
    final counting = camera is CountdownCameraState;
    return CaptureScreen(
      navigation: _navigation(view),
      state: state,
      preview: device?.preview(context),
      mirrored: false,
      canSwitch: screen.canSwitch,
      canStartTimer: canStartTimer,
      counting: counting,
      countdownSeconds: seconds,
      busy: busy || view.modal != null,
      canChoosePhoto: view.modal == null && camera is! CapturingCameraState,
      statusMessage: statusMessage,
      onPrimary: () => _dispatch(
        CameraFlowAction(switch (state) {
          CaptureState.live when counting => CancelSelfTimerCameraAction(),
          CaptureState.live => StartSelfTimerCameraAction(monotonicNow()),
          _ => RetryCameraAction(),
        }),
      ),
      onUpload: () => _beginPhoto(PhotoSource.library_),
      onSwitch: () => _dispatch(CameraFlowAction(SwitchCameraAction())),
      recovery: _recovery(view, [
        ?_message(
          view.issue is CaptureFailedIssue ? 'experience.captureFailed' : _pickerError(view),
        ),
      ]),
    );
  }

  Widget _rejected(FlowView view, PhotoRejectedScreenView screen) {
    final m = TryOnScope.of(context).messages;
    return RejectedScreen(
      navigation: _navigation(view),
      photo: _photo(view, screen.photo.media, altKey: 'photo.rejectedAlt'),
      error: m.text(_photoRejectionMessages[screen.reason] ?? 'photoUpload.fallbackError'),
      busy: _uploadingPhoto(view),
      onUpload: () => _beginPhoto(screen.photo.source),
      onGuide: () => _dispatch(PhotoFlowAction(ShowGuidePhotoAction())),
      recovery: _recovery(view, [
        ?_message(_pickerError(view)),
        ?_sourceImageRecovery(view, screen.photo.media),
      ]),
    );
  }

  Widget _height(FlowView view, HeightScreenView screen) {
    final m = TryOnScope.of(context).messages;
    final uploading = _uploadingPhoto(view);
    final saving = view.journey.bodyProgress == BodyProgress.savingHeight;
    final status = uploading
        ? m.text('experience.processingPhoto')
        : (saving ? m.text('experience.savingHeight') : null);
    final issue = view.issue;
    final heightError = issue is SetHeightFailedIssue ? issue.error : null;
    String? error = _pickerError(view);
    if (view.domain.body is MissingBodyState) {
      error = 'experience.bodyMissing';
    } else if (view.heightNeedsChange) {
      error = 'experience.heightUnusable';
    } else if (heightError != null && heightError != BackendException.unusable) {
      error = 'experience.heightFailed';
    }
    final uncertain = switch (view.journey.bodyProgress) {
      BodyProgress.heightUncertain => 'experience.heightUncertain',
      BodyProgress.renderUncertain => 'experience.renderUncertain',
      _ => null,
    };
    return HeightScreen(
      navigation: _navigation(view),
      photo: _photo(view, view.domain.photo?.media, altKey: 'photo.reviewAlt'),
      heightCm: screen.draft,
      busy: uploading,
      confirmDisabled: !view.canConfirmHeight,
      statusMessage: status,
      error: error == null ? null : m.text(error),
      onChanged: (cm) => _dispatch(HeightFlowAction(EditHeightAction(cm))),
      onConfirm: () => _dispatch(HeightFlowAction(ConfirmHeightAction())),
      onUpload: _replacePhoto,
      recovery: _recovery(view, [
        ?_message(uncertain),
        ?_sourceImageRecovery(view, view.domain.photo?.media),
        if (view.domain.photo case final photo?) ?_addPhoto(photo.media),
        if (saving && !uploading)
          Text(
            status!,
            style: TextStyle(fontSize: 14, color: TryOnScope.of(context).tokens.mutedForeground),
          ),
      ]),
    );
  }

  Widget _tryOn(FlowView view, TryOnScreenView screen) {
    final scope = TryOnScope.of(context);
    final m = scope.messages;
    final t = scope.tokens;
    final selection = screen.selection;
    final presentation = screen.presentation;
    final domain = view.domain;
    final variants = domain.product?.variants ?? const <Variant>[];
    final feedback = presentation.feedback;
    final requested = feedback?.variantId == null
        ? null
        : labelFor(feedback!.variantId!, variants, selection.rows, selection.labelFormats);
    final failureKeys = feedback?.failure == null ? null : _failures[feedback!.failure!];
    final failureKey = requested == null || requested.axes.isEmpty
        ? failureKeys?.$1
        : (failureKeys?.$2 ?? failureKeys?.$1);
    final suggested = presentation.suggestedVariantId == null
        ? null
        : labelFor(
            presentation.suggestedVariantId!,
            variants,
            selection.rows.where((r) => feedback?.suggestionAxes.contains(r.key) ?? false),
            selection.labelFormats,
          );
    final savingHeight = view.journey.bodyProgress == BodyProgress.savingHeight;
    final sizeNote = _fitGateNote(view, screen);
    final displayed = presentation.displayed;
    final shownId = displayed is TryOnDisplayedImage ? displayed.tryOnId : null;
    final shown = domain.tryOns.where((r) => r.id == shownId).firstOrNull;
    final image = view.renderMedia?.result;
    String? resultState;
    if (shown != null && view.presence.open) {
      resultState = switch (image?.phase ?? ImagePhase.loading) {
        ImagePhase.ready => 'ready',
        ImagePhase.failed => 'error',
        _ => 'loading',
      };
    }
    final progressText = savingHeight ? m.text('experience.savingHeight') : null;
    final status =
        progressText ??
        (resultState == 'loading' && presentation.progress != TryOnProgress.rendering
            ? m.text('experience.loadingResultImage')
            : null);
    final error = failureKey == null
        ? null
        : m.text(failureKey, requested == null ? const {} : {'variant': requested});
    final phase = presentation.progress == TryOnProgress.rendering
        ? TryOnPhase.generating
        : (error == null ? TryOnPhase.ready : TryOnPhase.error);
    final actions = view.renderMedia;
    final src = image == null ? null : _e.assetSource(image);
    final pickerOverResult =
        !_wide &&
        selection.rows.isNotEmpty &&
        (presentation.mode == PresentationMode.selection ||
            presentation.mode == PresentationMode.editingVariant);
    Widget? result;
    if (shown != null && image != null && src != null) {
      final provider = scope.imageProvider(src);
      result = FlowImage(
        key: ValueKey(src),
        image: provider,
        loadKey: (image.asset, image.load, image.version),
        fit: BoxFit.cover,
        // On a phone the picker opens over the result's lower part: the result
        // aligns to the top, so the person stays in view above it.
        alignment: pickerOverResult ? Alignment.topCenter : Alignment.center,
        semanticLabel: [
          widget.productName ?? m.text('sessionIntro.defaultProductName'),
          m.text('tryOnView.aiGeneratedLabel'),
        ].join(' · '),
        onSize: (size) {
          if (_resultSize != size && mounted) setState(() => _resultSize = size);
        },
        onDecoded: (ready) => _guard(() => _e.imageDecoded(image, ready: ready)),
      );
      // The web's zoomable result: ready, shown, and nothing in flight.
      result = PinchZoom(
        enabled:
            resultState == 'ready' &&
            presentation.progress != TryOnProgress.rendering &&
            view.modal == null,
        image: provider,
        child: result,
      );
    }
    // A fit-gate warning is said by the note on the size row, which names the size to try.
    final warning = feedback?.warning == null || sizeNote != null
        ? null
        : _warnings[feedback!.warning!];
    return TryOnResultScreen(
      navigation: _navigation(view),
      productName: widget.productName,
      selection: selection,
      presentation: presentation,
      product: domain.product,
      tryOns: domain.tryOns,
      prices: _e.prices,
      unavailable: domain.unavailableVariants,
      photo: _photo(view, domain.photo?.media),
      result: result,
      resultImageState: resultState,
      resultAspect: _resultSize == null ? null : _resultSize!.width / _resultSize!.height,
      wide: _wide,
      phase: phase,
      error: error,
      statusMessage: status,
      requestPending: presentation.progress != null,
      busy: view.modal != null || _uploadingPhoto(view),
      cart: actions?.cart,
      downloadVisible: widget.onDownload != null,
      downloadEnabled: actions?.download.available == true && widget.onDownload != null,
      downloadPending: actions?.download.pending == true,
      fit: widget.fitScore && shown != null
          ? fitForResult(shown, presentation.fitRetryable, m.text)
          : null,
      sizeNote: sizeNote,
      fitDetailsOpen: _fitDetailsOpen,
      onFitDetails: (open) => setState(() {
        _fitDetailsOpen = open;
        if (!open) _activeCallout = null;
      }),
      activeCalloutKey: _activeCallout,
      onActiveCallout: (key) => setState(() => _activeCallout = key),
      callbacks: TryOnCallbacks(
        select: (axis, item) =>
            _dispatch(SelectionFlowAction(SelectItemSelectionAction(axis: axis, item: item))),
        showTryOn: (id) => _dispatch(PresentationFlowAction(ShowTryOnPresentationAction(id))),
        showAxisItem: (axis, item) => _dispatch(
          PresentationFlowAction(ShowAxisItemPresentationAction(axis: axis, item: item)),
        ),
        setPicker: (open) =>
            _dispatch(PresentationFlowAction(SetVariantPickerPresentationAction(open))),
        tryOn: (variantId) =>
            _dispatch(PresentationFlowAction(RunPrimaryPresentationAction(variantId))),
        replacePhoto: _replacePhoto,
        addToCart: (tryOnId, variantId) => _dispatch(
          SelectionFlowAction(
            RequestResultCartSelectionAction(tryOnId: tryOnId, variantId: variantId),
          ),
        ),
        download: (tryOnId) => _dispatch(RenderMediaFlowAction(DownloadRenderMediaAction(tryOnId))),
        retryFit: (tryOnId) =>
            _dispatch(PresentationFlowAction(RetryResultFitPresentationAction(tryOnId))),
        selectRecommendation: () =>
            _dispatch(SizeRecommendationFlowAction(SizeRecommendationAction.select)),
      ),
      recovery: _recovery(view, [
        ?_message(warning),
        if (actions?.cart.failed == true) ?_message('experience.cartFailed'),
        if (shown == null) ?_sourceImageRecovery(view, domain.photo?.media),
        if (shown == null) ?_addPhoto(domain.photo?.media),
        if (actions?.download.failed == true) ?_message('experience.downloadFailed'),
        if (resultState == 'error') ?_message('experience.resultImageFailed'),
        if (progressText != null)
          ExcludeSemantics(
            child: Text(progressText, style: TextStyle(fontSize: 14, color: t.mutedForeground)),
          ),
        if (suggested != null && suggested.axes.isNotEmpty)
          Text(
            m.text('experience.suggestedVariant', {'variant': suggested}),
            style: TextStyle(fontSize: 14, color: t.foreground),
          ),
      ]),
      pickerNotes: [
        if (feedback?.noSuitableSize == true) ?_message('experience.noSuitableSize'),
        if (domain.sizeRecommendationPending && !savingHeight)
          Semantics(
            liveRegion: true,
            child: Text(
              m.text('experience.recommendationPending'),
              style: TextStyle(fontSize: 13, color: t.mutedForeground),
            ),
          ),
        if (domain.sizeRecommendationError != null) ?_message('experience.recommendationFailed'),
      ],
    );
  }

  // --- Overlays ---------------------------------------------------------------

  Widget? _modal(FlowView view) {
    if (view.modal is! ChoosePhotoSourceModal) return null;
    final m = TryOnScope.of(context).messages;
    final confirmingRetake =
        view.domain.photo?.source == PhotoSource.camera &&
        (view.screen is HeightScreenView || view.screen is TryOnScreenView);
    if (confirmingRetake) {
      return TryOnDialog(
        title: m.text('photoCapture.retakeTitle'),
        body: m.text('photoCapture.retakeBody'),
        onDismiss: _cancelModal,
        actions: [
          TryOnButton(
            label: m.text('photoCapture.retakeContinue'),
            onPressed: () => _beginPhoto(PhotoSource.camera),
          ),
          TryOnButton(
            label: m.text('photoCapture.retakeCancel'),
            variant: ButtonVariant.ghost,
            onPressed: _cancelModal,
          ),
        ],
      );
    }
    return TryOnDialog(
      title: m.text('experience.choosePhoto'),
      onDismiss: _cancelModal,
      actions: [
        TryOnButton(
          label: m.text('experience.takePhoto'),
          onPressed: () => _beginPhoto(PhotoSource.camera),
        ),
        TryOnButton(
          label: m.text('experience.chooseFromLibrary'),
          variant: ButtonVariant.ghost,
          onPressed: () => _beginPhoto(PhotoSource.library_),
        ),
        TryOnButton(
          label: m.text('experience.cancel'),
          variant: ButtonVariant.ghost,
          onPressed: _cancelModal,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final m = TryOnScope.of(context).messages;
    if (_e.failure != null) {
      return TryOnDialog(
        title: m.text('experience.endedUnexpectedly'),
        onDismiss: _e.close,
        actions: [
          TryOnButton(
            label: m.text('surface.closeSr'),
            variant: ButtonVariant.ghost,
            onPressed: _e.close,
          ),
        ],
      );
    }
    final view = _e.view;
    final modal = _modal(view);
    return LayoutBuilder(
      builder: (context, box) {
        _wide = isWideTryOn(box.maxWidth);
        return Stack(
          fit: StackFit.expand,
          children: [
            ExcludeSemantics(excluding: modal != null, child: _screen(view)),
            ?modal,
          ],
        );
      },
    );
  }
}

/// A centered confirmation over the flow (`sv-dialog` / `sv-alert-dialog`).
class TryOnDialog extends StatelessWidget {
  const TryOnDialog({
    super.key,
    required this.title,
    this.body,
    required this.actions,
    required this.onDismiss,
  });

  final String title;
  final String? body;
  final List<Widget> actions;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    return Stack(
      fit: StackFit.expand,
      children: [
        GestureDetector(
          onTap: onDismiss,
          child: Semantics(
            label: TryOnScope.text(context, 'surface.closeSr'),
            button: true,
            child: ColoredBox(color: t.backdrop),
          ),
        ),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Semantics(
                scopesRoute: true,
                namesRoute: true,
                explicitChildNodes: true,
                label: title,
                child: Material(
                  color: t.background,
                  borderRadius: BorderRadius.circular(TryOnTokens.radiusXl),
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Semantics(
                          header: true,
                          child: Text(
                            title,
                            style: TextStyle(
                              fontSize: 16,
                              height: 1.5,
                              fontWeight: FontWeight.w600,
                              color: t.foreground,
                            ),
                          ),
                        ),
                        if (body != null) ...[
                          const SizedBox(height: 8),
                          Text(
                            body!,
                            style: TextStyle(
                              fontSize: 14,
                              height: 20 / 14,
                              color: t.mutedForeground,
                            ),
                          ),
                        ],
                        const SizedBox(height: 16),
                        for (final (i, a) in actions.indexed) ...[
                          if (i > 0) const SizedBox(height: 4),
                          a,
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
