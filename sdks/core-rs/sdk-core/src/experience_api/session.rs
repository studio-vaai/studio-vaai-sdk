use std::sync::Arc;

use api::{ApiClient, ApiError, ApiProblem, CreateBearerSessionBody, CreateCookieSessionBody};
use state_machine::{BackendError, Outcome};

use super::outcomes::{classify_experience_api_error, failed};

#[uniffi::export(with_foreign)]
pub trait SessionEstablishmentHost: Send + Sync {
    fn is_current(&self) -> bool;
}

#[derive(Clone, uniffi::Enum)]
pub enum ExperienceCredential {
    Cookie { expires_at: String },
    Bearer { expires_at: String, token: String },
}

#[derive(uniffi::Enum)]
pub enum ExperienceEstablishment {
    Established { credential: ExperienceCredential },
    Ended { outcome: Outcome },
}

#[uniffi::export]
pub async fn establish_experience_session(
    client: Arc<ApiClient>,
    host: Arc<dyn SessionEstablishmentHost>,
) -> ExperienceEstablishment {
    use ExperienceEstablishment::{Ended, Established};
    let ended = |outcome| Ended { outcome };
    let prepared = client.prepare_cookie_session().await;
    if !host.is_current() {
        return ended(Outcome::SessionExpired);
    }
    let cookie_challenge = match prepared {
        Ok(prepared) if !prepared.challenge.is_empty() => prepared.challenge,
        Ok(_) => return ended(failed(BackendError::Internal)),
        Err(error) => return ended(classify_experience_api_error(error, false)),
    };
    let created = client
        .create_cookie_session(CreateCookieSessionBody {
            cookie_challenge,
            data_processing_consent: true,
        })
        .await;
    if !host.is_current() {
        return ended(Outcome::Unknown);
    }
    match created {
        Ok(_) => match client.get_session().await {
            Ok(session) if host.is_current() => Established {
                credential: ExperienceCredential::Cookie {
                    expires_at: session.expires_at,
                },
            },
            _ => ended(Outcome::Unknown),
        },
        Err(ApiError::Problem {
            status: 400,
            problem: ApiProblem::CookieSessionUnavailableProblem { .. },
        }) => {
            let bearer = client
                .create_bearer_session(CreateBearerSessionBody {
                    data_processing_consent: true,
                })
                .await;
            if !host.is_current() {
                return ended(Outcome::Unknown);
            }
            match bearer {
                Ok(session) if !session.token.is_empty() => Established {
                    credential: ExperienceCredential::Bearer {
                        expires_at: session.expires_at,
                        token: session.token,
                    },
                },
                Ok(_) => ended(Outcome::Unknown),
                Err(error) => ended(classify_experience_api_error(error, true)),
            }
        }
        Err(error) => ended(classify_experience_api_error(error, true)),
    }
}

#[uniffi::export]
pub fn experience_credential_should_refresh(expires_at_ms: f64, now_ms: f64) -> bool {
    let remaining = expires_at_ms - now_ms;
    remaining > 0.0 && remaining < 300_000.0
}

// Match the generated client's typed transport and problem errors.
#[allow(clippy::result_large_err)]
#[uniffi::export]
pub async fn refresh_experience_credential(
    client: Arc<ApiClient>,
    bearer: bool,
) -> Result<ExperienceCredential, ApiError> {
    if bearer {
        let session = client.refresh_bearer_session().await?;
        Ok(ExperienceCredential::Bearer {
            expires_at: session.expires_at,
            token: session.token,
        })
    } else {
        let session = client.refresh_cookie_session().await?;
        Ok(ExperienceCredential::Cookie {
            expires_at: session.expires_at,
        })
    }
}
