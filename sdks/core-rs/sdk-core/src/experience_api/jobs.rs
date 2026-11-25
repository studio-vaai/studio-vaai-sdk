use std::sync::Arc;

use api::{ApiError, CreateTryOnBody, SetBodyHeightBody, TryOnSuccess};
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
            // One key per creation attempt, the same for the shopper's retry
            // of it: the backend answers a repeat with the try-on the key
            // already names, so a lost response is never rendered or billed
            // twice.
            let Ok(idempotency_key) = session.try_on_create_key(body_id, &revision, key.variant_id)
            else {
                return ended(failed(BackendError::Internal));
            };
            let response = client
                .create_try_on(
                    product_id.into(),
                    Some(idempotency_key.clone()),
                    body_id.into(),
                    CreateTryOnBody {
                        variant_id: key.variant_id.into(),
                        body_revision_id: Some(revision.clone()),
                    },
                )
                .await;
            // Bookkeeping only: a failure to record leaves the next retry a
            // new attempt, as before keys existed.
            let _ = match &response {
                Err(error) if may_have_created(error) => {
                    session.keep_try_on_create(body_id, &revision, key.variant_id, &idempotency_key)
                }
                _ => session.settle_try_on_create(body_id, &revision, key.variant_id),
            };
            match response {
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
                Err(error) => ended(try_on_create_failure(request.classify(error, true))),
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

/// Whether the backend may have created (and billed) the try-on although
/// the request failed: its response was lost or undecodable (a 2xx it could
/// not read, a network failure, 408, 502, 504), or the backend failed or was
/// unavailable (5xx, 429), possibly after creating it. A retry of that
/// attempt then sends the same idempotency key. Only an answer that the
/// request was refused as it stands (any other 4xx) settles the attempt.
fn may_have_created(error: &ApiError) -> bool {
    let status = match error {
        ApiError::InvalidRequest { .. } => return false,
        ApiError::NotSent { .. } | ApiError::Transport { .. } => return true,
        ApiError::Problem { status, .. }
        | ApiError::Decode { status, .. }
        | ApiError::UnexpectedStatus { status, .. } => *status,
    };
    !(400..=499).contains(&status) || matches!(status, 408 | 429)
}

/// A try-on creation whose response was lost failed for the shopper: they
/// keep their photo and can try again. The retry sends the attempt's
/// idempotency key, so the backend answers with the try-on it may already
/// have made instead of making and billing a second one.
fn try_on_create_failure(outcome: Outcome) -> Outcome {
    match outcome {
        Outcome::Unknown => failed(BackendError::Unavailable),
        outcome => outcome,
    }
}

#[cfg(test)]
mod tests {
    use super::super::outcomes::classify_experience_api_error;
    use super::*;

    fn create_failure(error: ApiError) -> Outcome {
        try_on_create_failure(classify_experience_api_error(error, true))
    }

    #[test]
    fn a_lost_try_on_response_is_a_failure_the_shopper_can_retry() {
        let unavailable = Outcome::Failed {
            error: BackendError::Unavailable,
        };
        assert_eq!(
            create_failure(ApiError::Transport {
                reason: "Failed to fetch".to_owned()
            }),
            unavailable
        );
        for status in [408, 502, 504] {
            assert_eq!(
                create_failure(ApiError::UnexpectedStatus {
                    status,
                    body: String::new()
                }),
                unavailable,
                "{status}"
            );
        }
    }

    #[test]
    fn an_undecodable_success_is_a_failure_the_shopper_can_retry() {
        // The backend made (and billed) the try-on; only its answer was lost.
        let unreadable = ApiError::Decode {
            status: 201,
            reason: "missing field `imageUrl`".to_owned(),
        };
        assert!(may_have_created(&unreadable));
        assert_eq!(
            create_failure(unreadable),
            Outcome::Failed {
                error: BackendError::Unavailable
            }
        );
    }

    #[test]
    fn a_retry_reuses_the_key_wherever_the_try_on_may_exist() {
        let status = |status| ApiError::UnexpectedStatus {
            status,
            body: String::new(),
        };
        // Lost or undecodable responses, gateway timeouts and server failures:
        // the try-on may exist, so the retry sends the same key.
        for error in [
            ApiError::Transport {
                reason: "Failed to fetch".to_owned(),
            },
            ApiError::NotSent {
                reason: "deadline".to_owned(),
            },
            ApiError::Decode {
                status: 200,
                reason: "unexpected end of input".to_owned(),
            },
            status(408),
            status(429),
            status(500),
            status(502),
            status(503),
            status(504),
        ] {
            assert!(may_have_created(&error), "{error:?}");
        }
        // Refused as sent: the next request is a new attempt with a new key.
        for code in [400, 401, 403, 404, 409, 422] {
            assert!(!may_have_created(&status(code)), "{code}");
        }
        assert!(!may_have_created(&ApiError::InvalidRequest {
            reason: "bad".to_owned()
        }));
    }

    #[test]
    fn other_try_on_failures_keep_their_meaning() {
        assert_eq!(
            create_failure(ApiError::UnexpectedStatus {
                status: 404,
                body: String::new()
            }),
            Outcome::Failed {
                error: BackendError::NotFound
            }
        );
        assert_eq!(
            create_failure(ApiError::UnexpectedStatus {
                status: 500,
                body: String::new()
            }),
            Outcome::Failed {
                error: BackendError::Internal
            }
        );
    }
}
