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

/// The saved body, if the API still has it and still stores its photo (the
/// person cut-out try-ons render from). Without the photo nothing can be shown
/// or tried on, so the host asks for a new photo instead.
fn restorable_body(
    expiry_ms: impl FnOnce(String) -> f64,
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
        source_image_url_expires_at_ms: expiry_ms(summary.source_image_url_expires_at),
    })
}

#[derive(uniffi::Enum)]
pub enum ExperienceSessionRestore {
    Verified { generation: String },
    Ended { outcome: Outcome },
}

/// Verify the stored session before looking up any saved body: the browser's
/// cookie, or a native app's bearer credential that it stored and installed
/// again. Either way the session's own expiry from the API applies.
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
    if !credentials.is_current(&request) {
        return expired();
    }
    let response = request.client().get_session().await;
    if !host.is_current() || !credentials.is_current(&request) {
        return expired();
    }
    match response {
        Ok(session) if request.is_cookie() => credentials
            .restore_cookie(&request, session.expires_at)
            .map_or_else(expired, |generation| Verified { generation }),
        Ok(session) => credentials
            .restore_bearer(&request, session.expires_at)
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
    if !credentials.is_current(&request) {
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
            body: restorable_body(|value| credentials.parse_expiry_ms(value), bodies, body),
        },
        Err(error) => Ended {
            outcome: request.classify(error, false),
        },
    }
}

#[cfg(test)]
mod tests {
    use api::BodySummary;

    use super::*;

    const BODY: &str = "01a20ecd-4596-7558-ad47-b1c3528dd576";

    fn restore(source_image_url: &str) -> Option<RestorableBody> {
        let bodies = ListBodiesResponse {
            bodies: vec![BodySummary {
                body_id: BODY.to_owned(),
                created_at: "2026-11-24T10:00:00Z".to_owned(),
                estimated_height_cm: 172.0,
                source_image_url: source_image_url.to_owned(),
                source_image_url_expires_at: "2026-11-24T10:15:00Z".to_owned(),
                body_revision_id: None,
                user_provided_height_cm: None,
            }],
        };
        restorable_body(
            |_| 1_000.0,
            bodies,
            BodyId::try_from(BODY.to_owned()).unwrap(),
        )
    }

    #[test]
    fn a_stored_cut_out_restores_the_body_with_its_link() {
        let body = restore("https://storage.test/crops/o/c.jxl").expect("restored");
        assert_eq!(body.source_image_url, "https://storage.test/crops/o/c.jxl");
        assert_eq!(body.source_image_url_expires_at_ms, 1_000.0);
    }

    #[test]
    fn without_a_stored_cut_out_the_body_is_not_restored() {
        assert!(restore("").is_none());
        assert!(restore("   ").is_none());
    }
}
