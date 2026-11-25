import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'components.dart';
import 'photo_guide.dart';
import 'scope.dart';
import 'theme.dart';
import 'wordmark.dart';

/// Header navigation for a screen, as the web's `SvScreenNavigation`.
class ScreenNavigation {
  const ScreenNavigation({required this.back, required this.onBack, required this.onClose});
  final BackState back;
  final VoidCallback onBack;
  final VoidCallback onClose;
}

/// Consent, the photo guide and the photo sources (`sv-session-intro-screen`).
class IntroScreen extends StatelessWidget {
  const IntroScreen({
    super.key,
    required this.navigation,
    required this.consented,
    required this.consentRequired,
    required this.busy,
    required this.photoFactsOpen,
    required this.withdrawalOpen,
    required this.onConsent,
    required this.onPhotoFacts,
    required this.onWithdrawal,
    required this.onUpload,
    required this.onCamera,
    this.recoveryOnly = false,
    this.recovery,
    this.error,
    this.consentError,
    this.recovering = const [],
  });

  final ScreenNavigation navigation;
  final bool consented, consentRequired, busy, photoFactsOpen, withdrawalOpen, recoveryOnly;
  final ValueChanged<bool> onConsent, onPhotoFacts, onWithdrawal;
  final VoidCallback onUpload, onCamera;

  /// Replaces the actions when the session must be retried first.
  final Widget? recovery;
  final String? error, consentError;
  final List<Widget> recovering;

  @override
  Widget build(BuildContext context) {
    final m = TryOnScope.of(context).messages;
    final blocked = consentRequired && !consented;
    final errors = [
      if (consentRequired && consentError != null && consentError!.isNotEmpty) consentError!,
      if (error != null && error!.isNotEmpty) error!,
    ];
    final facts = [
      m.text('sessionIntro.photoFacts.onlyForTryOn'),
      m.text('sessionIntro.photoFacts.nobodyElseSees'),
      m.text('sessionIntro.photoFacts.deletedAfter'),
    ];
    // Wide, as the web: "powered by" in the header instead of the subtitle and
    // the guide's corner, and the three steps above the photo facts.
    return LayoutBuilder(
      builder: (context, box) =>
          _screen(context, isWideTryOn(box.maxWidth), blocked, errors, facts),
    );
  }

  Widget _screen(
    BuildContext context,
    bool wide,
    bool blocked,
    List<String> errors,
    List<String> facts,
  ) {
    final scope = TryOnScope.of(context);
    final m = scope.messages;
    final t = scope.tokens;
    final privacy = TryOnDisclosure(
      heading: m.text('sessionIntro.photoFactsTitle'),
      open: photoFactsOpen,
      onToggle: onPhotoFacts,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final fact in facts)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 2, right: 8),
                    child: Icon(Icons.check, size: 16, color: t.positive),
                  ),
                  Expanded(
                    child: Text(
                      fact,
                      style: TextStyle(fontSize: 14, height: 20 / 14, color: t.foreground),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
    return TryOnScreen(
      title: m.text('sessionIntro.sheetTitle'),
      subtitle: wide ? null : m.text('sessionIntro.sheetSubtitle'),
      subtitleTrailing: wide
          ? const Padding(padding: EdgeInsets.only(top: 4), child: TryOnPoweredBy())
          : null,
      back: navigation.back,
      onBack: navigation.onBack,
      onClose: navigation.onClose,
      busy: busy,
      statusMessage: busy ? m.text('sessionIntro.busyUploadSr') : null,
      stage: Stack(
        fit: StackFit.expand,
        children: [
          const Padding(padding: EdgeInsets.only(bottom: 8), child: TryOnPhotoGuide()),
          if (!wide) const Positioned(right: 0, bottom: 0, child: TryOnPoweredBy(stacked: true)),
        ],
      ),
      panel: wide
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Steps([
                  m.text('sessionIntro.steps.uploadPhoto'),
                  m.text('sessionIntro.steps.enterHeight'),
                  m.text('sessionIntro.steps.trySizes'),
                ]),
                const SizedBox(height: 16),
                privacy,
              ],
            )
          : privacy,
      beforeActions: [
        if (consentRequired) ...[
          TryOnCheckbox(
            checked: consented,
            error: consentError != null,
            onChanged: busy ? null : onConsent,
            label: m.text('sessionIntro.consentLegal'),
            below: TryOnDisclosure(
              card: false,
              heading: m.text('sessionIntro.withdrawalDisclosureLabel'),
              open: withdrawalOpen,
              onToggle: onWithdrawal,
              child: TryOnRichText(
                'sessionIntro.withdrawalDisclosureBody',
                style: TryOnText.legal(t),
              ),
            ),
          ),
          TryOnRichText('sessionIntro.legalFooter', style: TryOnText.legal(t)),
        ],
        for (final e in errors) TryOnMessage(e),
        ...recovering,
      ],
      primary: recoveryOnly
          ? recovery
          : _Blocked(
              blocked: blocked,
              child: TryOnButton(
                label: m.text('sessionIntro.primaryCtaPhoto'),
                busy: busy,
                onPressed: busy ? null : onUpload,
              ),
            ),
      secondary: recoveryOnly
          ? null
          : _Blocked(
              blocked: blocked,
              child: TryOnButton(
                label: m.text('sessionIntro.secondaryCtaCamera'),
                variant: ButtonVariant.ghost,
                onPressed: busy ? null : onCamera,
              ),
            ),
    );
  }
}

/// The intro's numbered steps on wide layouts (the web's `sv-steps`).
class _Steps extends StatelessWidget {
  const _Steps(this.items);
  final List<String> items;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final (i, item) in items.indexed) ...[
            if (i > 0) const SizedBox(height: 10),
            Row(
              children: [
                Container(
                  width: 20,
                  height: 20,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: t.primary, shape: BoxShape.circle),
                  child: Text(
                    '${i + 1}',
                    style: TextStyle(
                      fontSize: 12,
                      height: 1,
                      fontWeight: FontWeight.w500,
                      color: t.primaryForeground,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    item,
                    style: TextStyle(fontSize: 14, height: 1.375, color: t.foreground),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Looks inactive until consent, but stays tappable so the flow can say why
/// (the web's `blocked` buttons).
class _Blocked extends StatelessWidget {
  const _Blocked({required this.blocked, required this.child});
  final bool blocked;
  final Widget child;

  @override
  Widget build(BuildContext context) => Semantics(
    hint: blocked ? TryOnScope.text(context, 'sessionIntro.consentRequired') : null,
    child: child,
  );
}

/// The camera's states, as the web's `sv-photo-capture-screen`.
enum CaptureState { permission, live, uploading, denied, unavailable, error }

/// The live camera with its self-timer (`sv-photo-capture-screen`).
class CaptureScreen extends StatelessWidget {
  const CaptureScreen({
    super.key,
    required this.navigation,
    required this.state,
    this.preview,
    this.mirrored = false,
    this.photo,
    this.canSwitch = false,
    this.canStartTimer = false,
    this.counting = false,
    this.countdownSeconds = 0,
    this.busy = false,
    this.canChoosePhoto = true,
    this.statusMessage,
    this.onPrimary,
    this.onUpload,
    this.onSwitch,
    this.recovery = const [],
  });

  final ScreenNavigation navigation;
  final CaptureState state;
  final Widget? preview;
  final bool mirrored;
  final Widget? photo;
  final bool canSwitch, canStartTimer, counting, busy, canChoosePhoto;
  final int countdownSeconds;
  final String? statusMessage;
  final VoidCallback? onPrimary, onUpload, onSwitch;
  final List<Widget> recovery;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final m = scope.messages;
    final t = scope.tokens;
    final uploading = state == CaptureState.uploading;
    final locked = busy || uploading;
    final live = state == CaptureState.live;
    final String primaryLabel = switch (state) {
      CaptureState.permission => m.text('photoCapture.allowCameraCta'),
      CaptureState.live || CaptureState.uploading =>
        counting
            ? m.text('photoCapture.cancelTimerCta')
            : m.text('photoCapture.selfTimerCta', {'seconds': 10}),
      _ => m.text('photoCapture.retry'),
    };
    final guidance = TryOnMessage(m.text('photoCapture.infoBody'), variant: MessageVariant.neutral);
    Widget stage;
    if (live || uploading) {
      stage = StageFrame(
        color: TryOnTokens.mediaBackground,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (uploading)
              ?photo
            else if (preview != null)
              Semantics(
                image: true,
                label: m.text('photo.cameraPreview'),
                child: FittedBox(
                  fit: BoxFit.cover,
                  clipBehavior: Clip.hardEdge,
                  child: SizedBox(
                    width: 300,
                    height: 400,
                    child: mirrored ? Transform.flip(flipX: true, child: preview) : preview,
                  ),
                ),
              ),
            if (counting && countdownSeconds > 0)
              Center(
                child: Semantics(
                  liveRegion: true,
                  label: m.text('photoCapture.countdownSr', {'seconds': countdownSeconds}),
                  excludeSemantics: true,
                  child: Container(
                    width: 88,
                    height: 88,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      color: TryOnTokens.mediaOverlay,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      '$countdownSeconds',
                      style: const TextStyle(
                        fontSize: 44,
                        fontWeight: FontWeight.w500,
                        color: TryOnTokens.mediaForeground,
                      ),
                    ),
                  ),
                ),
              ),
            if (live && canSwitch && !busy && !counting)
              Positioned(
                top: 12,
                right: 12,
                child: Semantics(
                  button: true,
                  label: m.text('photoCapture.switchCameraSr'),
                  excludeSemantics: true,
                  child: Material(
                    color: TryOnTokens.mediaOverlay,
                    shape: const CircleBorder(),
                    child: IconButton(
                      onPressed: onSwitch,
                      tooltip: m.text('photoCapture.switchCameraSr'),
                      icon: const Icon(
                        Icons.cameraswitch_outlined,
                        color: TryOnTokens.mediaForeground,
                        size: 20,
                      ),
                    ),
                  ),
                ),
              ),
            Positioned(left: 12, right: 12, bottom: 12, child: TryOnGlass(child: guidance)),
          ],
        ),
      );
    } else {
      final permission = state == CaptureState.permission;
      final body = switch (state) {
        CaptureState.denied => m.text('photoCapture.permissionDeniedBodyApp'),
        CaptureState.unavailable => m.text('photoCapture.unavailableBody'),
        CaptureState.permission => statusMessage ?? m.text('photoCapture.permissionPromptBodyApp'),
        _ => m.text('photoCapture.fallbackError'),
      };
      // Permission waits on a dark frame; a failure is a message on the page.
      stage = StageFrame(
        color: permission ? TryOnTokens.mediaBackground : t.background,
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (permission) ...[
                Container(
                  width: 44,
                  height: 44,
                  decoration: const BoxDecoration(
                    color: TryOnTokens.mediaControl,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.camera_alt_outlined,
                    color: TryOnTokens.mediaForeground,
                    size: 22,
                  ),
                ),
                const SizedBox(height: 16),
              ],
              if (state == CaptureState.denied) ...[
                Text(
                  m.text('photoCapture.permissionDeniedTitle'),
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: t.foreground),
                ),
                const SizedBox(height: 8),
              ],
              if (permission)
                Text(
                  body,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 16,
                    height: 1.4,
                    color: TryOnTokens.mediaForeground,
                  ),
                )
              else
                TryOnMessage(body),
            ],
          ),
        ),
      );
    }
    final hidePrimary = state == CaptureState.permission && locked;
    return TryOnScreen(
      title: m.text('photoCapture.title'),
      subtitle: m.text('photoCapture.subtitle'),
      back: navigation.back,
      onBack: navigation.onBack,
      onClose: navigation.onClose,
      busy: locked || counting,
      statusMessage: statusMessage ?? (locked ? m.text('photoCapture.busyAutoCaptureSr') : null),
      stage: stage,
      beforeActions: recovery,
      primary: hidePrimary
          ? null
          : TryOnButton(
              label: primaryLabel,
              busy: locked,
              onPressed: locked || (live && !counting && !canStartTimer) ? null : onPrimary,
            ),
      secondary: TryOnButton(
        label: m.text('photoCapture.uploadFromLibraryCta'),
        variant: ButtonVariant.ghost,
        onPressed: canChoosePhoto && !(locked && !canChoosePhoto) ? onUpload : null,
      ),
    );
  }
}

/// A new photo being processed, or failed (the web's staged photo screen).
class StagedPhotoScreen extends StatelessWidget {
  const StagedPhotoScreen({
    super.key,
    required this.navigation,
    required this.photo,
    required this.busy,
    this.primary,
    this.recovery = const [],
  });

  final ScreenNavigation navigation;
  final Widget photo;
  final bool busy;
  final Widget? primary;
  final List<Widget> recovery;

  @override
  Widget build(BuildContext context) {
    final m = TryOnScope.of(context).messages;
    final title = busy ? m.text('experience.processingPhoto') : m.text('experience.choosePhoto');
    return TryOnScreen(
      title: title,
      back: navigation.back,
      onBack: navigation.onBack,
      onClose: navigation.onClose,
      busy: busy,
      statusMessage: busy ? m.text('experience.processingPhoto') : null,
      stage: StageFrame(
        child: Stack(
          fit: StackFit.expand,
          children: [
            photo,
            if (busy)
              const ColoredBox(
                color: Color(0x33FFFFFF),
                child: Center(child: TryOnSpinner()),
              ),
          ],
        ),
      ),
      beforeActions: recovery,
      primary: primary,
    );
  }
}

/// The photo the backend could not use (`sv-photo-upload-rejected-screen`).
class RejectedScreen extends StatelessWidget {
  const RejectedScreen({
    super.key,
    required this.navigation,
    required this.photo,
    required this.error,
    required this.busy,
    required this.onUpload,
    required this.onGuide,
    this.statusMessage,
    this.recovery = const [],
  });

  final ScreenNavigation navigation;
  final Widget photo;
  final String error;
  final bool busy;
  final VoidCallback onUpload, onGuide;
  final String? statusMessage;
  final List<Widget> recovery;

  @override
  Widget build(BuildContext context) {
    final m = TryOnScope.of(context).messages;
    return TryOnScreen(
      title: m.text('photoUpload.title'),
      titleIcon: Icons.error_outline,
      back: navigation.back,
      onBack: navigation.onBack,
      onClose: navigation.onClose,
      busy: busy,
      statusMessage: statusMessage ?? (busy ? m.text('photoUpload.busyRetryUploadSr') : null),
      stage: StageFrame(child: photo),
      beforeActions: [...recovery, if (error.isNotEmpty) TryOnMessage(error)],
      primary: TryOnButton(
        label: m.text('photoUpload.primaryRetry'),
        busy: busy,
        onPressed: busy ? null : onUpload,
      ),
      secondary: TryOnButton(
        label: m.text('photoUpload.guideLink'),
        variant: ButtonVariant.ghost,
        onPressed: busy ? null : onGuide,
      ),
    );
  }
}

const minHeightCm = 140, maxHeightCm = 220;

/// The height input (`sv-height-setting-screen` with `sv-height-input`).
class HeightScreen extends StatelessWidget {
  const HeightScreen({
    super.key,
    required this.navigation,
    required this.photo,
    required this.heightCm,
    required this.busy,
    required this.confirmDisabled,
    required this.onChanged,
    required this.onConfirm,
    required this.onUpload,
    this.statusMessage,
    this.error,
    this.recovery = const [],
  });

  final ScreenNavigation navigation;
  final Widget photo;
  final double? heightCm;
  final bool busy, confirmDisabled;
  final ValueChanged<double> onChanged;
  final VoidCallback onConfirm, onUpload;
  final String? statusMessage, error;
  final List<Widget> recovery;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final m = scope.messages;
    final t = scope.tokens;
    final label = m.text('heightSetting.heightPickerLabel');
    return TryOnScreen(
      title: m.text('heightSetting.title'),
      subtitle: m.text('heightSetting.subtitle'),
      back: navigation.back,
      onBack: navigation.onBack,
      onClose: navigation.onClose,
      busy: busy,
      statusMessage: statusMessage ?? (busy ? m.text('heightSetting.busySaveSr') : null),
      stage: StageFrame(child: photo),
      panel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 13, height: 1.25, color: t.foreground)),
          const SizedBox(height: 6),
          if (heightCm != null)
            HeightInput(
              value: heightCm!.round(),
              label: label,
              disabled: busy,
              onChanged: onChanged,
            ),
        ],
      ),
      beforeActions: [...recovery, if (error != null && error!.isNotEmpty) TryOnMessage(error!)],
      primary: TryOnButton(
        label: m.text('heightSetting.confirm'),
        busy: busy,
        onPressed: busy || confirmDisabled || heightCm == null ? null : onConfirm,
      ),
      secondary: TryOnButton(
        label: m.text('heightSetting.useOtherImage'),
        variant: ButtonVariant.ghost,
        onPressed: busy ? null : onUpload,
      ),
    );
  }
}

/// A height field in whole centimetres, 140 to 220, with steppers. A typed
/// value outside the range is corrected to the nearest bound, with a note.
class HeightInput extends StatefulWidget {
  const HeightInput({
    super.key,
    required this.value,
    required this.label,
    required this.onChanged,
    this.disabled = false,
  });

  final int value;
  final String label;
  final ValueChanged<double> onChanged;
  final bool disabled;

  @override
  State<HeightInput> createState() => _HeightInputState();
}

class _HeightInputState extends State<HeightInput> {
  late final _controller = TextEditingController(text: '${widget.value}');
  final _focus = FocusNode();
  int? _corrected, _committed;

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      if (!_focus.hasFocus) _commit();
    });
  }

  @override
  void didUpdateWidget(HeightInput oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_focus.hasFocus && _controller.text != '${widget.value}') {
      _controller.text = '${widget.value}';
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _commit() {
    final typed = int.tryParse(_controller.text.trim());
    if (typed == null) {
      _controller.text = '${widget.value}';
      return;
    }
    // Already committed (focus left after submitting): keep the note.
    if (typed == widget.value || typed == _committed) return;
    final clamped = typed.clamp(minHeightCm, maxHeightCm);
    setState(() => _corrected = clamped != typed ? clamped : null);
    _controller.text = '$clamped';
    _committed = clamped;
    if (clamped != widget.value) widget.onChanged(clamped.toDouble());
  }

  void _step(int delta) {
    final next = (widget.value + delta).clamp(minHeightCm, maxHeightCm);
    setState(() => _corrected = null);
    _controller.text = '$next';
    if (next != widget.value) widget.onChanged(next.toDouble());
  }

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final t = scope.tokens;
    final m = scope.messages;
    final note = _corrected == null
        ? null
        : m.text('heightInput.corrected', {
            'value': _corrected!,
            'min': minHeightCm,
            'max': maxHeightCm,
          });
    Widget stepper(IconData icon, int delta, bool enabled) => SizedBox(
      width: 40,
      height: 24,
      child: IconButton(
        padding: EdgeInsets.zero,
        iconSize: 16,
        onPressed: enabled && !widget.disabled ? () => _step(delta) : null,
        icon: Icon(icon, color: t.foreground),
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          label: widget.label,
          value: '${widget.value} cm',
          increasedValue: '${(widget.value + 1).clamp(minHeightCm, maxHeightCm)} cm',
          decreasedValue: '${(widget.value - 1).clamp(minHeightCm, maxHeightCm)} cm',
          onIncrease: widget.disabled ? null : () => _step(1),
          onDecrease: widget.disabled ? null : () => _step(-1),
          child: Container(
            decoration: BoxDecoration(
              color: t.background,
              borderRadius: BorderRadius.circular(TryOnTokens.radiusMd),
              border: Border.all(color: t.input),
            ),
            child: Row(
              children: [
                const SizedBox(width: 14),
                Expanded(
                  child: TextField(
                    controller: _controller,
                    focusNode: _focus,
                    enabled: !widget.disabled,
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(3),
                    ],
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _commit(),
                    style: TextStyle(fontSize: 16, height: 1.5, color: t.foreground),
                    decoration: InputDecoration(
                      border: InputBorder.none,
                      isDense: true,
                      suffixText: 'cm',
                      suffixStyle: TextStyle(fontSize: 16, color: t.mutedForeground),
                      contentPadding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
                ExcludeSemantics(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      stepper(Icons.keyboard_arrow_up, 1, widget.value < maxHeightCm),
                      stepper(Icons.keyboard_arrow_down, -1, widget.value > minHeightCm),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        if (note != null) ...[
          const SizedBox(height: 6),
          Semantics(
            liveRegion: true,
            child: Text(
              note,
              style: TextStyle(fontSize: 12, height: 16 / 12, color: t.mutedForeground),
            ),
          ),
        ],
      ],
    );
  }
}
