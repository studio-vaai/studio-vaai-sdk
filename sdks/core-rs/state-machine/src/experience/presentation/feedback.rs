//! Shopper-facing feedback for the picker and foreground request.

use super::{Capability, DefaultController, DomainSnapshot, Issue, refusal};
use crate::{
    AxisKey, BackendError, Inadmissible, RefusalReason, Rejection, TryOnRequestFailure,
    TryOnRequestSnapshot, TryOnRequestStatus, VariantId,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum TryOnFailureKind {
    TooSmall,
    TooLarge,
    BodyMissing,
    VariantMissing,
    InputsUnavailable,
    NoSuitableSize,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum TryOnWarning {
    HeightUncertain,
    RenderUncertain,
    PickerFailed,
    TooSmall,
    TooLarge,
    OutOfStock,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TryOnFeedback {
    pub failure: Option<TryOnFailureKind>,
    pub variant_id: Option<VariantId>,
    pub warning: Option<TryOnWarning>,
    pub no_suitable_size: bool,
    pub suggestion_axes: Vec<AxisKey>,
}

fn failure_kind(
    refusal: Option<RefusalReason>,
    failure: Option<TryOnRequestFailure>,
    blocked_inputs: Option<BackendError>,
) -> Option<TryOnFailureKind> {
    use TryOnFailureKind as Kind;
    if let Some(reason) = refusal {
        return Some(match reason {
            RefusalReason::GarmentTooSmall => Kind::TooSmall,
            RefusalReason::GarmentTooLarge => Kind::TooLarge,
        });
    }
    let backend = match failure {
        Some(TryOnRequestFailure::Backend { error }) => Some(error),
        _ => blocked_inputs,
    };
    match backend {
        Some(BackendError::BodyNotFound) => Some(Kind::BodyMissing),
        Some(BackendError::NotFound) => Some(Kind::VariantMissing),
        Some(BackendError::InvalidRequest | BackendError::Unusable) => {
            Some(Kind::InputsUnavailable)
        }
        Some(_) => Some(Kind::Failed),
        None => match failure {
            Some(TryOnRequestFailure::Inadmissible {
                reason: Inadmissible::NoSuitableSize,
            }) => Some(Kind::NoSuitableSize),
            None
            | Some(TryOnRequestFailure::Inadmissible {
                reason: Inadmissible::VariantUnavailable,
            }) => None,
            Some(_) => Some(Kind::Failed),
        },
    }
}

impl DefaultController {
    pub(super) fn try_on_feedback(
        &self,
        snapshot: &DomainSnapshot,
        followed: Option<&TryOnRequestSnapshot>,
        admission: Capability,
    ) -> TryOnFeedback {
        let (fit_refusal, failure, suggestion_axes) = match followed.map(|request| &request.status)
        {
            Some(TryOnRequestStatus::Refused { try_on }) => (
                Some(try_on.reason),
                None,
                try_on
                    .alternative
                    .iter()
                    .flat_map(|ids| ids.iter().map(|(axis, _)| axis.clone()))
                    .collect(),
            ),
            Some(TryOnRequestStatus::Failed { failure }) => (
                match failure {
                    TryOnRequestFailure::SizeRestricted { reason } => Some(*reason),
                    _ => None,
                },
                Some(*failure),
                Vec::new(),
            ),
            _ => (None, None, Vec::new()),
        };
        let blocked_inputs = match admission {
            Capability::Unavailable {
                reason: Rejection::TryOnInputsUnavailable { error },
            } => Some(error),
            _ => None,
        };
        let failure_kind = failure_kind(fit_refusal, failure, blocked_inputs);
        let no_size = snapshot
            .size_recommendation
            .as_ref()
            .is_some_and(|recommendation| recommendation.no_suitable_size);
        let selection_warning = match refusal(snapshot, self.selection.variant_id) {
            Some(reason) if fit_refusal.is_none() && !no_size => Some(match reason {
                RefusalReason::GarmentTooSmall => TryOnWarning::TooSmall,
                RefusalReason::GarmentTooLarge => TryOnWarning::TooLarge,
            }),
            _ if snapshot
                .unavailable_variants
                .contains(&self.selection.variant_id)
                || matches!(
                    failure,
                    Some(TryOnRequestFailure::Inadmissible {
                        reason: Inadmissible::VariantUnavailable
                    })
                ) =>
            {
                Some(TryOnWarning::OutOfStock)
            }
            _ => None,
        };
        let warning = match self.journey_view(snapshot).body_progress {
            crate::BodyProgress::HeightUncertain => Some(TryOnWarning::HeightUncertain),
            crate::BodyProgress::RenderUncertain => Some(TryOnWarning::RenderUncertain),
            _ if matches!(self.issue, Some(Issue::PickerFailed { .. })) => {
                Some(TryOnWarning::PickerFailed)
            }
            _ => selection_warning,
        };
        TryOnFeedback {
            failure: failure_kind,
            variant_id: followed.map(|request| request.variant_id),
            warning,
            no_suitable_size: no_size && failure_kind != Some(TryOnFailureKind::NoSuitableSize),
            suggestion_axes,
        }
    }
}
