use std::sync::Arc;

use state_machine::{BackendError, BodyId, Outcome, TryOnId, VariantId};

use super::body::body_from_list;
use super::credentials::{ExperienceCredentials, ExperienceRequestCredential};
use super::outcomes::failed;
use super::result::matches_request;

#[derive(uniffi::Enum)]
pub enum ExperienceImageTarget {
    Photo {
        body_id: BodyId,
    },
    Result {
        try_on_id: TryOnId,
        variant: Option<VariantId>,
        body_revision: Option<String>,
    },
}

/// The host applies this budget to the shared request's abort signal.
#[uniffi::export]
pub fn experience_image_renewal_timeout_ms(target: ExperienceImageTarget) -> u32 {
    match target {
        ExperienceImageTarget::Photo { .. } => 20_000,
        ExperienceImageTarget::Result { .. } => 30_000,
    }
}

#[derive(uniffi::Enum)]
pub enum ExperienceImageRenewal {
    Renewed {
        url: String,
        expires_at_ms: Option<f64>,
    },
    Ended {
        outcome: Outcome,
    },
}

/// Read a new URL for an existing asset and verify its identity before returning it.
#[uniffi::export]
pub async fn renew_experience_image(
    credentials: Arc<ExperienceCredentials>,
    request: Arc<ExperienceRequestCredential>,
    target: ExperienceImageTarget,
) -> ExperienceImageRenewal {
    use ExperienceImageRenewal::{Ended, Renewed};
    let ended = |outcome| Ended { outcome };
    let unavailable = || ended(failed(BackendError::Unavailable));
    if !credentials.is_current(&request) {
        return ended(Outcome::SessionExpired);
    }
    let client = request.client();
    let result = match target {
        ExperienceImageTarget::Photo { body_id } => match client.list_bodies().await {
            Ok(bodies) => body_from_list(bodies, body_id).map_or_else(unavailable, |body| {
                let expiry = credentials.parse_expiry_ms(body.source_image_url_expires_at);
                if body.source_image_url.trim().is_empty()
                    || !expiry.is_finite()
                    || expiry <= credentials.now_ms()
                {
                    unavailable()
                } else {
                    Renewed {
                        url: body.source_image_url,
                        expires_at_ms: Some(expiry),
                    }
                }
            }),
            Err(error) => ended(request.classify(error, false)),
        },
        ExperienceImageTarget::Result {
            try_on_id,
            variant: Some(variant),
            body_revision: Some(body_revision),
        } if !body_revision.is_empty() => match client.get_try_on(try_on_id.into()).await {
            Ok(result) if matches_request(&result, Some(try_on_id), variant, &body_revision) => {
                Renewed {
                    url: result.image_url,
                    expires_at_ms: None,
                }
            }
            Ok(_) => unavailable(),
            Err(error) => ended(request.classify(error, false)),
        },
        ExperienceImageTarget::Result { .. } => unavailable(),
    };
    if credentials.is_current(&request) {
        result
    } else {
        ended(Outcome::SessionExpired)
    }
}
