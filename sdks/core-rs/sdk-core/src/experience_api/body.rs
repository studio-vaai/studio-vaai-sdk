use api::{BodyHeightRevision, BodySummary, ListBodiesResponse};
use state_machine::{BodyId, BodyOutcome, HeightCm, Outcome};

pub(super) fn body_from_list(bodies: ListBodiesResponse, body: BodyId) -> Option<BodySummary> {
    let id = String::from(body);
    bodies
        .bodies
        .into_iter()
        .find(|summary| summary.body_id == id)
}

#[uniffi::export]
pub fn experience_height_readback(bodies: ListBodiesResponse, body: BodyId) -> Outcome {
    let summary = body_from_list(bodies, body);
    Outcome::HeightReadback {
        height: summary
            .as_ref()
            .and_then(|body| body.user_provided_height_cm)
            .map(|height| HeightCm(f64::from(height))),
        backend_revision: summary.and_then(|body| body.body_revision_id),
    }
}

#[uniffi::export]
pub fn experience_height_written(saved: Option<BodyHeightRevision>) -> Outcome {
    match saved {
        Some(saved) if !saved.body_revision_id.is_empty() => Outcome::Body {
            outcome: BodyOutcome::HeightSet,
            backend_revision: Some(saved.body_revision_id),
        },
        _ => Outcome::HeightWriteUnconfirmed,
    }
}
