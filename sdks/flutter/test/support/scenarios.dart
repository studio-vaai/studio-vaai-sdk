import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/src/ui/pinch_zoom.dart';
import 'package:studio_vaai/testing.dart';

import 'harness.dart';

/// A 422 from `POST /bodies`: the photo does not show the feet.
HttpResponse feetNotVisible(HttpRequest _) => ScriptedApi.json(422, {
  'type': 'about:blank',
  'kind': 'body-validation-failed',
  'title': 'Body validation failed',
  'status': 422,
  'reason': 'feet_not_visible',
});

Map<String, Object> _check(String id, String label, String dimension, String fit) => {
  'pointId': id,
  'label': label,
  'dimension': dimension,
  'garmentMm': 1040,
  'bodyMm': 960,
  'easeMm': 80,
  'easeNorm': 0.1,
  'idealShiftNorm': 0,
  'intentSigmaNorm': 0.3,
  'fit': fit,
  'sentence': '$label: $fit',
};

/// A size recommendation (M, a fit match of 87) and try-ons with fit
/// anchors, so results show their fit score and callouts.
void scriptFit(ScriptedApi api) {
  api.overrides['GET /products/${ScriptedApi.productId}/recommended-size'] = (request) =>
      ScriptedApi.json(200, {
        'bodyRevisionId': Uri.parse(request.url).queryParameters['bodyRevisionId'] ?? 'revision-1',
        'recommendedForeignIds': {'size': 'M'},
        'recommendations': [
          {
            'foreignIds': {'size': 'M'},
            'rank': 1,
            'rationale': 'Chest fits as intended',
            'fit': 'ideal',
            'fitMatch': 87,
            'fitChecks': [
              _check('chest_width', 'Chest', 'chest', 'ideal'),
              _check('sleeve_length', 'Sleeve length', 'sleeve_length', 'runs_loose'),
              _check('total_length', 'Length', 'total_length', 'ideal'),
            ],
          },
          {
            'foreignIds': {'size': 'L'},
            'rank': 2,
            'rationale': 'Roomier than intended',
            'fit': 'runs_loose',
            'fitMatch': 64,
            'fitChecks': [_check('chest_width', 'Chest', 'chest', 'runs_loose')],
          },
        ],
      });
  var count = 0;
  api.overrides['POST /products/${ScriptedApi.productId}/try-on'] = (request) {
    final body = jsonDecode(utf8.decode(request.body!)) as Map<String, Object?>;
    count++;
    return ScriptedApi.json(201, {
      'tryOnId': '0192f0e0-0000-7000-8000-0000000200${count.toString().padLeft(2, '0')}',
      'variantId': body['variantId'],
      'bodyRevisionId': body['bodyRevisionId'],
      'imageUrl': 'https://images.example.test/fit-$count.webp',
      'scene': {'overlayColor': '#ffffff'},
      // The man in the stand-in image: his chest, both cuffs and his hem.
      'fitAnchors': [
        {'dimension': 'chest', 'x': 0.6, 'y': 0.3},
        {'dimension': 'sleeve_length', 'side': 'right', 'x': 0.53, 'y': 0.47},
        {'dimension': 'sleeve_length', 'side': 'left', 'x': 0.86, 'y': 0.47},
        {'dimension': 'total_length', 'x': 0.62, 'y': 0.52},
      ],
      // His outline, as bands: head, torso and arms, shorts, legs.
      'subjectBands': [
        {'top': 0.12, 'bottom': 0.26, 'left': 0.58, 'right': 0.74},
        {'top': 0.26, 'bottom': 0.5, 'left': 0.5, 'right': 0.9},
        {'top': 0.5, 'bottom': 0.72, 'left': 0.53, 'right': 0.86},
        {'top': 0.72, 'bottom': 0.98, 'left': 0.56, 'right': 0.84},
      ],
    });
  };
}

/// One way to a screen state, by tapping as a shopper does.
typedef Scenario = Future<void> Function(WidgetTester tester, Harness h);

/// Ticks the consent checkbox by its label.
Future<void> giveConsent(WidgetTester tester, Harness h) async {
  final label = text(h.m('sessionIntro.consentLegal'));
  await tester.ensureVisible(label);
  await tester.tap(label);
  await tester.pump();
}

/// Every state the goldens and the comparison sheet show, by name.
final Map<String, Scenario> scenarios = {
  'intro': (tester, h) async {},
  'intro-validation': (tester, h) async {
    await tapPrimary(tester); // "Upload a photo" (wide, a step reads the same)
    await settleFor(tester, text(h.m('sessionIntro.consentRequired')));
  },
  'camera-live': (tester, h) async {
    await giveConsent(tester, h);
    await tapText(tester, h.m('sessionIntro.secondaryCtaCamera'));
    await settleView(
      tester,
      h,
      (v) =>
          v.screen is CameraScreenView && (v.screen as CameraScreenView).camera is LiveCameraState,
    );
  },
  'camera-countdown': (tester, h) async {
    await scenarios['camera-live']!(tester, h);
    await tapText(tester, h.m('photoCapture.selfTimerCta', {'seconds': 10}));
    await tester.pump(const Duration(milliseconds: 2200));
    await tester.pump();
  },
  'camera-denied': (tester, h) async {
    h.devices.cameraFailure = DeviceException.permissionDenied;
    await giveConsent(tester, h);
    await tapText(tester, h.m('sessionIntro.secondaryCtaCamera'));
    await settleFor(tester, text(h.m('photoCapture.permissionDeniedTitle')));
  },
  // A chosen photo being sent and processed: the intro stays, its "Upload a
  // photo" spinning, with no processing screen.
  'photo-uploading': (tester, h) async {
    h.gate.hold('POST /bodies');
    await giveConsent(tester, h);
    await tapPrimary(tester); // "Upload a photo" (wide, a step reads the same)
    await settleView(
      tester,
      h,
      (v) => v.journey.photoUpload?.phase == PhotoUploadPhase.pending && v.modal == null,
    );
  },
  'photo-rejected': (tester, h) async {
    h.api.overrides['POST /bodies'] = feetNotVisible;
    await giveConsent(tester, h);
    await tapPrimary(tester); // "Upload a photo" (wide, a step reads the same)
    await settleFor(tester, text(h.m('photoUpload.title')));
  },
  'height': (tester, h) async {
    await giveConsent(tester, h);
    await tapPrimary(tester); // "Upload a photo" (wide, a step reads the same)
    await settleView(tester, h, (v) => v.screen is HeightScreenView);
  },
  'selection': (tester, h) async {
    await scenarios['height']!(tester, h);
    await tapText(tester, h.m('heightSetting.confirm'));
    await settleFor(tester, text(h.m('sizeAndStyleSelection.variantSubtitle')));
  },
  // The shopper picks a size the fit gate refuses: the note on the size row
  // names the next size that fits, and the button offers it.
  'selection-gated': (tester, h) async {
    h.api.fitGate['M'] = 'too_small';
    await scenarios['selection']!(tester, h);
    await settleView(
      tester,
      h,
      (v) => (v.screen as TryOnScreenView).selection.recommendedVariantId != null,
    );
    await tapText(tester, 'M');
    await settleView(
      tester,
      h,
      (v) =>
          (v.screen as TryOnScreenView).presentation.primaryAction
              is TryNextFittingPrimaryTryOnAction,
    );
  },
  // A result, then the picker on an untried size: the tried size checked.
  'result-tried': (tester, h) async {
    await scenarios['selection']!(tester, h);
    await tapPrimary(tester);
    await settleFor(tester, textContaining(h.m('tryOnView.aiGeneratedLabel')));
    await settleView(tester, h, (v) => v.journey.presented);
    await tapPrimary(tester);
    await settleFor(tester, text('L'));
    await tapText(tester, 'L');
    await settleView(
      tester,
      h,
      (v) => (v.screen as TryOnScreenView).selection.variantId == ScriptedApi.variantL,
    );
  },
  'generating': (tester, h) async {
    await scenarios['selection']!(tester, h);
    h.gate.hold('POST /products/${ScriptedApi.productId}/try-on');
    await tapPrimary(tester);
    await settleView(
      tester,
      h,
      (v) =>
          v.screen is TryOnScreenView &&
          (v.screen as TryOnScreenView).presentation.progress == TryOnProgress.rendering,
    );
  },
  // A result with its fit score (the size recommendation and fit anchors
  // scripted), as the web's Result preview.
  'result': (tester, h) async {
    scriptFit(h.api);
    await scenarios['selection']!(tester, h);
    await settleView(
      tester,
      h,
      (v) => (v.screen as TryOnScreenView).selection.recommendedVariantId != null,
    );
    await tapPrimary(tester);
    await settleFor(tester, textContaining(h.m('tryOnView.aiGeneratedLabel')));
    await settleView(
      tester,
      h,
      (v) => v.journey.presented && v.renderMedia?.cart.available == true,
    );
    await settleFor(tester, find.textContaining('%'));
  },
  // The fit details open: the big percentage and the callouts on the image.
  'result-fit': (tester, h) async {
    await scenarios['result']!(tester, h);
    await tester.tap(find.textContaining('%'));
    await tester.pump(const Duration(milliseconds: 400));
  },
  // One callout pinned.
  'result-fit-pinned': (tester, h) async {
    await scenarios['result-fit']!(tester, h);
    await tester.tap(find.bySemanticsLabel(RegExp('^Chest|^Brust')).first);
    await tester.pump(const Duration(milliseconds: 400));
  },
  // The result before its fit: the recommendation still loading.
  'result-fit-loading': (tester, h) async {
    scriptFit(h.api);
    h.gate.hold('GET /products/${ScriptedApi.productId}/recommended-size');
    await scenarios['selection']!(tester, h);
    await tapPrimary(tester);
    await settleFor(tester, textContaining(h.m('tryOnView.aiGeneratedLabel')));
    await settleView(tester, h, (v) => v.journey.presented);
  },
  // No recommendation for this body: the fit score is unavailable.
  'result-fit-unavailable': (tester, h) async {
    await scenarios['selection']!(tester, h);
    await tapPrimary(tester);
    await settleFor(tester, textContaining(h.m('tryOnView.aiGeneratedLabel')));
    await settleFor(tester, text(h.m('tryOnView.fitScoreUnavailable')));
  },
  'result-picker': (tester, h) async {
    await scenarios['result']!(tester, h);
    await tapPrimary(tester);
    await settleFor(
      tester,
      text(
        h.m('tryOnView.pickerHeading', {'hasResult': 'yes', 'hasSize': 'yes', 'hasColor': 'no'}),
      ),
    );
  },
  'retake-dialog': (tester, h) async {
    await scenarios['camera-live']!(tester, h);
    await tapText(tester, h.m('photoCapture.selfTimerCta', {'seconds': 10}));
    await tester.pump(const Duration(seconds: 11));
    await settleView(tester, h, (v) => v.screen is HeightScreenView);
    await tapText(tester, h.m('heightSetting.useOtherImage'));
    await settleFor(tester, text(h.m('photoCapture.retakeTitle')));
  },
};

/// Taps the screen's primary action, whatever its label.
/// Two fingers spread over the result: lifted, at about 2.2×. Release them
/// with [TestGesture.up].
Future<(TestGesture, TestGesture)> pinchResult(WidgetTester tester) async {
  final center = tester.getCenter(find.byType(PinchZoom));
  final one = await tester.startGesture(center, pointer: 100);
  final two = await tester.startGesture(center + const Offset(40, 40), pointer: 101);
  await one.moveTo(center - const Offset(60, 60));
  await two.moveTo(center + const Offset(60, 60));
  await tester.pump();
  await one.moveTo(center - const Offset(110, 110));
  await two.moveTo(center + const Offset(110, 110));
  await tester.pump();
  return (one, two);
}

Future<void> tapPrimary(WidgetTester tester) async {
  final finder = find.byKey(const ValueKey('try-on-primary'));
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pump();
}
