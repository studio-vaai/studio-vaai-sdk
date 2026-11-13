use std::sync::Arc;

use api::{CreateTryOnBody, SetBodyHeightBody, TryOnSuccess};
use state_machine::{
    BackendError, BodyJob, Job, Outcome, SizeRecommendationJob, TryOnId, TryOnJob, TryOnSession,
};

use super::body::{experience_height_readback, experience_height_written};
use super::credentials::{ExperienceCredentials, ExperienceRequestCredential};
use super::outcomes::failed;
use super::recommendation::recommendation_outcome;
use super::result::created_try_on_outcome;

/// The host applies this operation budget to its transport and device work.
#[uniffi::export]
pub fn experience_job_timeout_ms(job: Job) -> u32 {
    match job {
        Job::TryOn { .. } => 120_000,
        Job::Photo { .. } => 90_000,
        _ => 30_000,
    }
}

#[derive(uniffi::Record)]
pub struct ExperienceJobResult {
    pub outcome: Outcome,
    /// Publish this response only if the flow accepts the result.
    pub result: Option<TryOnSuccess>,
}

/// Run the API work for a body or product job. Session and photo jobs have
/// dedicated entry points because they require host storage and image bytes.
#[uniffi::export]
pub async fn run_experience_job(
    credentials: Arc<ExperienceCredentials>,
    request: Arc<ExperienceRequestCredential>,
    job: Job,
    session: Arc<TryOnSession>,
) -> ExperienceJobResult {
    let ended = |outcome| ExperienceJobResult {
        outcome,
        result: None,
    };
    if !credentials.is_current(&request) {
        return ended(Outcome::SessionExpired);
    }
    let client = request.client();
    let result = match job {
        Job::Body {
            job:
                BodyJob::SetHeight {
                    body_id,
                    product_id,
                    height,
                },
        } => {
            let response = client
                .set_body_height(
                    body_id.into(),
                    SetBodyHeightBody {
                        height_cm: height.0 as f32,
                        product_id: product_id.map(Into::into),
                        return_revision: Some(true),
                    },
                )
                .await;
            ended(match response {
                Ok(saved) => experience_height_written(saved),
                Err(error) => match request.classify(error, true) {
                    Outcome::Unknown => Outcome::HeightWriteUnconfirmed,
                    outcome => outcome,
                },
            })
        }
        Job::Body {
            job: BodyJob::ReadHeight { body_id, .. },
        } => ended(match client.list_bodies().await {
            Ok(bodies) => experience_height_readback(bodies, body_id),
            Err(error) => request.classify(error, false),
        }),
        Job::SizeRecommendation {
            job:
                SizeRecommendationJob::Fetch {
                    body_id,
                    product,
                    backend_revision,
                    ..
                },
        } => {
            let Some(revision) = backend_revision.filter(|revision| !revision.is_empty()) else {
                return ended(failed(BackendError::Unavailable));
            };
            ended(
                match client
                    .get_recommended_size(product.id.into(), body_id.into(), Some(revision.clone()))
                    .await
                {
                    Ok(recommendation) => recommendation_outcome(product, recommendation, revision),
                    Err(error) => request.classify(error, false),
                },
            )
        }
        Job::TryOn {
            job:
                TryOnJob::Create {
                    body_id,
                    product_id,
                    key,
                    backend_revision,
                    ..
                },
        } => {
            let Some(revision) = backend_revision.filter(|revision| !revision.is_empty()) else {
                return ended(failed(BackendError::Unavailable));
            };
            match client
                .create_try_on(
                    product_id.into(),
                    body_id.into(),
                    CreateTryOnBody {
                        variant_id: key.variant_id.into(),
                        body_revision_id: Some(revision.clone()),
                    },
                )
                .await
            {
                Ok(mut result) => {
                    let Ok(id) = TryOnId::try_from(result.try_on_id.clone()) else {
                        return ended(failed(BackendError::Unavailable));
                    };
                    let Ok(existing) = session.try_on_asset(id) else {
                        return ended(failed(BackendError::Internal));
                    };
                    let outcome =
                        created_try_on_outcome(result.clone(), key.variant_id, revision, existing);
                    result.variant_id = Some(key.variant_id.into());
                    ExperienceJobResult {
                        result: matches!(outcome, Outcome::TryOn { .. }).then_some(result),
                        outcome,
                    }
                }
                Err(error) => ended(request.classify(error, true)),
            }
        }
        _ => ended(failed(BackendError::InvalidRequest)),
    };
    if credentials.is_current(&request) {
        result
    } else {
        ended(Outcome::SessionExpired)
    }
}
