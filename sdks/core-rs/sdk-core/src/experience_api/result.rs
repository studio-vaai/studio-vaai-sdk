use api::TryOnSuccess;
use state_machine::{
    BackendError, Outcome, ResultFitAnchor, TryOnAsset, TryOnId, TryOnOutcome, VariantId,
};

use super::outcomes::failed;

pub(super) fn matches_request(
    result: &TryOnSuccess,
    id: Option<TryOnId>,
    variant: VariantId,
    revision: &str,
) -> bool {
    let variant = String::from(variant);
    if result.image_url.trim().is_empty()
        || result
            .variant_id
            .as_ref()
            .is_some_and(|reported| reported != &variant)
    {
        return false;
    }
    if let Some(id) = id {
        result.try_on_id == String::from(id)
            && result
                .body_revision_id
                .as_ref()
                .is_none_or(|reported| reported == revision)
    } else {
        result.body_revision_id.as_deref() == Some(revision)
    }
}

#[uniffi::export]
pub fn created_try_on_outcome(
    result: TryOnSuccess,
    variant: VariantId,
    revision: String,
    previous: Option<TryOnAsset>,
) -> Outcome {
    if !matches_request(&result, None, variant, &revision)
        || previous.is_some_and(|previous| {
            previous.key.variant_id != variant
                || previous.backend_revision.as_deref() != Some(revision.as_str())
        })
    {
        return failed(BackendError::Unavailable);
    }
    let Ok(try_on_id) = TryOnId::try_from(result.try_on_id) else {
        return failed(BackendError::Unavailable);
    };
    let fit_anchors = result
        .fit_anchors
        .into_iter()
        .flatten()
        .filter(|anchor| (0.0..=1.0).contains(&anchor.x) && (0.0..=1.0).contains(&anchor.y))
        .map(|anchor| ResultFitAnchor {
            dimension: anchor.dimension,
            side: anchor.side,
            x: anchor.x,
            y: anchor.y,
        })
        .collect();
    TryOnOutcome::CreatedWithAnchors {
        try_on_id,
        image_url: result.image_url.into(),
        fit_anchors,
    }
    .into()
}
