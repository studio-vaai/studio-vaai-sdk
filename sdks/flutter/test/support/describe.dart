import 'package:studio_vaai/studio_vaai.dart';

/// A one-line summary of a flow view, for test failure messages.
String describe(FlowView v) {
  final s = v.screen;
  final screen = switch (s) {
    IntroductionScreenView(:final consentGiven) => 'intro(consent=$consentGiven)',
    CameraScreenView(:final camera) => 'camera(${camera.runtimeType})',
    HeightScreenView(:final draft) => 'height($draft)',
    TryOnScreenView(:final presentation) =>
      'tryOn(${presentation.mode.name}, ${presentation.displayed.runtimeType}, progress=${presentation.progress})',
    PhotoRejectedScreenView(:final reason) => 'rejected($reason)',
    _ => '?',
  };
  return '$screen step=${v.journey.step.name} upload=${v.journey.photoUpload?.phase.name} '
      'modal=${v.modal?.runtimeType} issue=${v.issue?.runtimeType} session=${v.domain.session.name} '
      'open=${v.presence.open} back=${v.canGoBack} '
      'result=${v.renderMedia?.result?.phase.name}/${v.renderMedia?.result?.asset} '
      'cart=${v.renderMedia?.cart.available}/${v.renderMedia?.cart.pending}/${v.renderMedia?.cart.failed}';
}
