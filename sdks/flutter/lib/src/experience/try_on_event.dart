import 'package:flutter/foundation.dart';

import '../generated/state_machine.dart';

/// One of the shopper's journey facts, as the web SDK's `sv-try-on-*` DOM
/// events: the same [type] names and the same [detail] fields, projected
/// from the core's [ExperienceEvent] exactly as the web components project
/// it (`web-components/src/experience/event-projection.ts`), plus the
/// timing facts the experience reports itself (`sv-try-on-operation-slow`,
/// `sv-try-on-operation-deadline`).
///
/// [detail] always holds `productId` and `step` (`intro`, `camera`,
/// `photo-upload`, `photo-rejected`, `height`, `variant-selection`,
/// `try-on`), and the fields of its type, by the web's names.
@immutable
final class TryOnExperienceEvent {
  const TryOnExperienceEvent(this.type, this.detail);

  /// From [toJson]'s shape.
  factory TryOnExperienceEvent.fromJson(Map<String, Object?> json) =>
      TryOnExperienceEvent(json['type']! as String, Map.unmodifiable(json['detail']! as Map));

  /// The web's event name, such as `sv-try-on-requested`.
  final String type;
  final Map<String, Object?> detail;

  String get productId => detail['productId']! as String;
  String get step => detail['step']! as String;

  Map<String, Object?> toJson() => {'type': type, 'detail': detail};

  @override
  String toString() => 'TryOnExperienceEvent($type, $detail)';
}

/// The web's step names, by the core's journey step.
String tryOnStep(JourneyStep step) => switch (step) {
  JourneyStep.intro => 'intro',
  JourneyStep.camera => 'camera',
  JourneyStep.photoUpload => 'photo-upload',
  JourneyStep.photoRejected => 'photo-rejected',
  JourneyStep.height => 'height',
  JourneyStep.variantSelection => 'variant-selection',
  JourneyStep.tryOn => 'try-on',
};

String _backend(BackendException error) => switch (error) {
  BackendException.invalidRequest => 'invalid-request',
  BackendException.notFound => 'not-found',
  BackendException.bodyNotFound => 'body-not-found',
  BackendException.unusable => 'unusable',
  BackendException.internal => 'internal',
  BackendException.unavailable => 'unavailable',
};

String _rejection(PhotoRejection reason) => switch (reason) {
  PhotoRejection.noHumanDetected => 'no-human-detected',
  PhotoRejection.humanOccluded => 'human-occluded',
  PhotoRejection.humanNotStanding => 'human-not-standing',
  PhotoRejection.humanTooSmall => 'human-too-small',
  PhotoRejection.inappropriateClothing => 'inappropriate-clothing',
  PhotoRejection.multiplePeople => 'multiple-people',
  PhotoRejection.feetNotVisible => 'feet-not-visible',
};

String _device(DeviceException error) => switch (error) {
  DeviceException.permissionDenied => 'permission-denied',
  DeviceException.unavailable => 'unavailable',
  DeviceException.interrupted => 'interrupted',
  DeviceException.failed => 'failed',
};

String _source(PhotoSource source) => source == PhotoSource.camera ? 'camera' : 'library';

/// The web's `cartDetail`.
Map<String, Object?> _variant(String variantId, Map<String, String> foreignIds) => {
  'variantId': variantId,
  'foreignIds': Map<String, String>.unmodifiable(foreignIds),
};

/// The web's projection of one core fact (`experienceEvent`); `null` for
/// facts the web does not publish (a cancelled picker, background work).
TryOnExperienceEvent? tryOnExperienceEventOf(ExperienceEvent event, [FlowView? view]) {
  final context = {'productId': event.productId, 'step': tryOnStep(event.step)};
  TryOnExperienceEvent of(String type, [Map<String, Object?> detail = const {}]) =>
      TryOnExperienceEvent(type, Map.unmodifiable({...context, ...detail}));
  Map<String, Object?> recommendation() {
    final product = view?.domain.product;
    final screen = view?.screen;
    if (screen is! TryOnScreenView || product == null || product.id != event.productId) return {};
    final id = screen.selection.recommendedVariantId;
    for (final variant in product.variants) {
      if (variant.id == id) return {'recommendedForeignIds': variant.foreignIds};
    }
    return {'recommendedForeignIds': <String, String>{}};
  }

  switch (event.fact) {
    case JourneyExperienceFact(event: final journey):
      switch (journey) {
        case OpenedJourneyEvent(:final entry):
          return of('sv-try-on-opened', {
            if (entry.entry != null) 'entry': entry.entry,
            if (entry.subentry != null) 'subentry': entry.subentry,
          });
        case ClosedJourneyEvent(:final presented):
          return of('sv-try-on-closed', {
            if (presented != null)
              'displayed': {'tryOnId': presented.tryOnId, 'variantId': presented.variantId},
          });
        case StepChangedJourneyEvent(:final previous):
          return of('sv-try-on-step-changed', {
            if (previous != null) 'previousStep': tryOnStep(previous),
          });
        case PhotoSourceStartedJourneyEvent(:final source, :final origin):
          return of('sv-try-on-photo-source-started', {
            'source': _source(source),
            'originStep': tryOnStep(origin),
          });
        case PhotoSourceCancelledJourneyEvent(:final source, :final origin):
          return of('sv-try-on-photo-source-cancelled', {
            'source': _source(source),
            'originStep': tryOnStep(origin),
          });
        case PhotoProcessingJourneyEvent(:final source):
          return of('sv-try-on-photo-processing', {'source': _source(source)});
        case VariantChangedJourneyEvent(:final variantId, :final foreignIds):
          return of('sv-try-on-variant-changed', _variant(variantId, foreignIds));
        case ImagePresentedJourneyEvent(:final result):
          final product = view?.domain.product;
          final actual = product?.id == event.productId
              ? product?.variants.where((v) => v.id == result.variantId).firstOrNull
              : null;
          return of('sv-try-on-presented', {
            if (actual != null) 'foreignIds': actual.foreignIds,
            'tryOnId': result.tryOnId,
            'variantId': result.variantId,
          });
      }
      return null;
    case ConsentGrantedExperienceFact():
      return of('sv-try-on-consent-granted');
    case SessionFailedExperienceFact(:final error):
      return of('sv-try-on-session-failed', {'reason': _backend(error)});
    case PhotoExperienceFact(event: final photo):
      switch (photo) {
        case CommittedPhotoEvent(photo: final p):
          return of('sv-try-on-photo-accepted', {'source': _source(p.source)});
        case RejectedPhotoEvent(photo: final p, :final reason):
          return of('sv-try-on-photo-rejected', {
            'source': _source(p.source),
            'reason': _rejection(reason),
          });
        case FailedPhotoEvent(photo: final p, :final error):
          return of('sv-try-on-photo-failed', {
            'source': _source(p.source),
            'reason': _backend(error),
          });
      }
      return null;
    case HeightExperienceFact(event: final body):
      return switch (body) {
        HeightSetBodyEvent() => of('sv-try-on-height-confirmed'),
        SetHeightFailedBodyEvent(:final error) => of('sv-try-on-height-failed', {
          'reason': _backend(error),
        }),
        _ => null,
      };
    case OperationUncertainExperienceFact(:final work):
      final name = switch (work) {
        UncertainWork.photo => 'photo',
        UncertainWork.height => 'height',
        UncertainWork.requestedTryOn => 'try-on',
        UncertainWork.backgroundTryOn || UncertainWork.other => null,
      };
      return name == null ? null : of('sv-try-on-operation-uncertain', {'work': name});
    case DeviceRecoveryExperienceFact(event: final device):
      return switch (device) {
        PickerCancelledDeviceRecoveryEvent() => null,
        PickerFailedDeviceRecoveryEvent(:final error) => of('sv-try-on-picker-failed', {
          'reason': _device(error),
        }),
        CaptureFailedDeviceRecoveryEvent(:final error) => of('sv-try-on-capture-failed', {
          'reason': _device(error),
        }),
        CameraAcquireFailedDeviceRecoveryEvent(:final error) => of('sv-try-on-camera-failed', {
          'phase': 'acquire',
          'reason': _device(error),
        }),
        CameraLostDeviceRecoveryEvent(:final error) => of('sv-try-on-camera-failed', {
          'phase': 'stream',
          'reason': _device(error),
        }),
        _ => null,
      };
    case TryOnRequestedExperienceFact(
      :final requestId,
      :final variantId,
      :final origin,
      :final foreignIds,
    ):
      return of('sv-try-on-requested', {
        ...recommendation(),
        'requestId': requestId,
        ..._variant(variantId, foreignIds),
        'origin': origin == TryOnRequestOrigin.shopper ? 'shopper' : 'automatic',
      });
    case TryOnRenderedExperienceFact(:final variantId, :final tryOnId):
      return of('sv-try-on-rendered', {'variantId': variantId, 'tryOnId': tryOnId});
    case TryOnResolvedExperienceFact(:final requestId, :final variantId, :final tryOnId):
      return of('sv-try-on-request-resolved', {
        'requestId': requestId,
        'variantId': variantId,
        'tryOnId': tryOnId,
      });
    case TryOnRefusedExperienceFact(:final requestId, :final variantId, :final reason):
      return of('sv-try-on-refused', {
        'requestId': requestId,
        'variantId': variantId,
        'reason': reason == RefusalReason.garmentTooSmall
            ? 'garment-too-small'
            : 'garment-too-large',
      });
    case TryOnFailedExperienceFact(:final requestId, :final variantId, :final failure):
      return of('sv-try-on-failed', {
        'requestId': requestId,
        'variantId': variantId,
        'reason': switch (failure) {
          BackendTryOnRequestFailure(:final error) ||
          SetHeightFailedTryOnRequestFailure(:final error) => _backend(error),
          _ => 'inadmissible',
        },
      });
    case TryOnDetachedExperienceFact(:final requestId, :final variantId, :final stage):
      return of('sv-try-on-detached', {
        'requestId': requestId,
        'variantId': variantId,
        'stage': stage.name,
      });
    case AddToCartRequestedExperienceFact(:final request):
      return of('sv-try-on-add-to-cart-requested', {
        ...recommendation(),
        'productId': request.productId,
        ..._variant(request.variantId, request.foreignIds),
      });
    default:
      return null;
  }
}
