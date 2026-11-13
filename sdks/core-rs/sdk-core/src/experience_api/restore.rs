use std::sync::Arc;

use api::ListBodiesResponse;
use state_machine::{BodyId, HeightCm, Outcome};

use super::body::body_from_list;
use super::credentials::{ExperienceCredentials, ExperienceRequestCredential};
use super::session::SessionEstablishmentHost;

#[derive(uniffi::Record)]
pub struct RestorableBody {
    pub body_id: BodyId,
    pub estimated_height: HeightCm,
    pub height: Option<HeightCm>,
    pub backend_revision: Option<String>,
    pub source_image_url: String,
    pub source_image_url_expires_at_ms: f64,
}

fn restorable_body(
    credentials: &ExperienceCredentials,
    bodies: ListBodiesResponse,
    body: BodyId,
) -> Option<RestorableBody> {
    let summary = body_from_list(bodies, body)?;
    let estimated_height = HeightCm(f64::from(summary.estimated_height_cm));
    if !estimated_height.is_valid() || summary.source_image_url.trim().is_empty() {
        return None;
    }
    let revision = summary
        .body_revision_id
        .filter(|revision| !revision.is_empty());
    let height = summary
        .user_provided_height_cm
        .map(|height| HeightCm(f64::from(height)))
        .filter(|height| height.is_valid() && revision.is_some());
    let backend_revision = height.and(revision);
    Some(RestorableBody {
        body_id: body,
        estimated_height,
        height,
        backend_revision,
        source_image_url: summary.source_image_url,
        // An expired URL can still be restored; the flow will request a renewal.
        source_image_url_expires_at_ms: credentials
            .parse_expiry_ms(summary.source_image_url_expires_at),
    })
}

#[derive(uniffi::Enum)]
pub enum ExperienceSessionRestore {
    Verified { generation: String },
    Ended { outcome: Outcome },
}

/// Verify the cookie before looking up any saved body.
#[uniffi::export]
pub async fn restore_experience_session(
    credentials: Arc<ExperienceCredentials>,
    request: Arc<ExperienceRequestCredential>,
    host: Arc<dyn SessionEstablishmentHost>,
) -> ExperienceSessionRestore {
    use ExperienceSessionRestore::{Ended, Verified};
    let expired = || Ended {
        outcome: Outcome::SessionExpired,
    };
    if !request.is_cookie() || !credentials.is_current(&request) {
        return expired();
    }
    let response = request.client().get_session().await;
    if !host.is_current() || !credentials.is_current(&request) {
        return expired();
    }
    match response {
        Ok(session) => credentials
            .restore_cookie(&request, session.expires_at)
            .map_or_else(expired, |generation| Verified { generation }),
        Err(error) => Ended {
            outcome: request.classify(error, false),
        },
    }
}

#[derive(uniffi::Enum)]
pub enum ExperienceBodyRestore {
    Ready { body: Option<RestorableBody> },
    Ended { outcome: Outcome },
}

/// Look up only the committed body supplied by the host. The host can repeat
/// this read if the saved selection changes while the same cookie is active.
#[uniffi::export]
pub async fn restore_experience_body(
    credentials: Arc<ExperienceCredentials>,
    request: Arc<ExperienceRequestCredential>,
    saved_body_id: String,
) -> ExperienceBodyRestore {
    use ExperienceBodyRestore::{Ended, Ready};
    let expired = || Ended {
        outcome: Outcome::SessionExpired,
    };
    if !request.is_cookie() || !credentials.is_current(&request) {
        return expired();
    }
    // Persisted host data can outlive a version of the SDK or be malformed.
    let Ok(body) = BodyId::try_from(saved_body_id) else {
        return Ready { body: None };
    };
    let response = request.client().list_bodies().await;
    if !credentials.is_current(&request) {
        return expired();
    }
    match response {
        Ok(bodies) => Ready {
            body: restorable_body(&credentials, bodies, body),
        },
        Err(error) => Ended {
            outcome: request.classify(error, false),
        },
    }
}
