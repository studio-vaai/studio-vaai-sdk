use std::sync::{Arc, Mutex};

use api::{ApiClient, ApiError, HttpTransport};
use futures_util::future::{BoxFuture, FutureExt, Shared};
use state_machine::{BackendError, Outcome};

use super::outcomes::{classify_authenticated_api_error, failed};
use super::session::{
    ExperienceCredential, experience_credential_should_refresh, refresh_experience_credential,
};

/// Browser cookies and wall-clock timestamps are observations of the host.
#[uniffi::export(with_foreign)]
pub trait ExperienceCredentialHost: Send + Sync {
    fn cookie_generation(&self) -> String;
    fn parse_expiry_ms(&self, value: String) -> f64;
    fn now_ms(&self) -> f64;
    fn credential_refreshed(&self, revision: u64);
}

/// A refresh has its own deadline and survives cancellation of individual jobs.
#[uniffi::export]
pub fn experience_credential_refresh_timeout_ms() -> u32 {
    15_000
}

/// The credential used by one operation. Refreshing the session does not change it.
#[derive(uniffi::Object)]
pub struct ExperienceRequestCredential {
    client: Arc<ApiClient>,
    owner: Arc<()>,
    epoch: u64,
    revision: u64,
    cookie_generation: Option<String>,
}

#[uniffi::export]
impl ExperienceRequestCredential {
    pub fn client(&self) -> Arc<ApiClient> {
        Arc::clone(&self.client)
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }
}

type RefreshFuture = Shared<BoxFuture<'static, Result<ExperienceCredential, ApiError>>>;

struct Refresh {
    ticket: u64,
    request: Arc<ExperienceRequestCredential>,
    future: RefreshFuture,
}

struct Credentials {
    epoch: u64,
    revision: u64,
    refresh_sequence: u64,
    cookie_generation: String,
    bearer: Option<String>,
    expires_at_ms: f64,
    refresh: Option<Refresh>,
}

/// Owns credential state for one experience and coalesces concurrent refreshes.
#[derive(uniffi::Object)]
pub struct ExperienceCredentials {
    client: Arc<ApiClient>,
    owner: Arc<()>,
    host: Arc<dyn ExperienceCredentialHost>,
    state: Mutex<Credentials>,
}

#[uniffi::export]
impl ExperienceCredentials {
    #[uniffi::constructor]
    pub fn new(client: Arc<ApiClient>, host: Arc<dyn ExperienceCredentialHost>) -> Arc<Self> {
        Arc::new(Self {
            client,
            owner: Arc::new(()),
            state: Mutex::new(Credentials {
                epoch: 0,
                revision: 0,
                refresh_sequence: 0,
                cookie_generation: host.cookie_generation(),
                bearer: None,
                expires_at_ms: 0.0,
                refresh: None,
            }),
            host,
        })
    }

    pub fn clear(&self) {
        self.begin_establishment();
    }

    /// Retire old in-flight credentials before establishing a new session.
    pub fn begin_establishment(&self) -> u64 {
        let mut state = self.state.lock().unwrap();
        state.epoch += 1;
        state.bearer = None;
        state.expires_at_ms = 0.0;
        state.refresh = None;
        state.epoch
    }

    pub fn install(
        &self,
        epoch: u64,
        credential: ExperienceCredential,
        cookie_generation: String,
    ) -> bool {
        let (bearer, expiry) = self.read_credential(credential);
        let mut state = self.state.lock().unwrap();
        if state.epoch != epoch {
            return false;
        }
        state.cookie_generation = cookie_generation;
        state.bearer = bearer;
        state.expires_at_ms = expiry;
        true
    }

    pub fn cookie_generation(&self) -> Option<String> {
        let state = self.state.lock().unwrap();
        state
            .bearer
            .is_none()
            .then(|| state.cookie_generation.clone())
    }

    pub fn invalidated_cookie_generation(&self) -> Option<String> {
        let observed = self.host.cookie_generation();
        self.cookie_generation()
            .filter(|generation| *generation != observed)
    }

    pub fn begin_request(
        &self,
        transport: Arc<dyn HttpTransport>,
    ) -> Option<Arc<ExperienceRequestCredential>> {
        let observed = self.host.cookie_generation();
        let state = self.state.lock().unwrap();
        self.request(&state, transport, &observed)
    }

    pub fn request_is_current(&self, request: Arc<ExperienceRequestCredential>) -> bool {
        self.is_current(&request)
    }

    pub async fn refresh_if_needed(
        &self,
        transport: Arc<dyn HttpTransport>,
        now_ms: f64,
    ) -> Option<Outcome> {
        let observed = self.host.cookie_generation();
        let (ticket, request, pending) = {
            let mut state = self.state.lock().unwrap();
            if state.bearer.is_none() && state.cookie_generation != observed {
                return Some(Outcome::SessionExpired);
            }
            if let Some(refresh) = &state.refresh {
                (
                    refresh.ticket,
                    Arc::clone(&refresh.request),
                    refresh.future.clone(),
                )
            } else {
                if !experience_credential_should_refresh(state.expires_at_ms, now_ms) {
                    return None;
                }
                let request = self.request(&state, transport, &observed)?;
                let bearer = state.bearer.is_some();
                let client = Arc::clone(&request.client);
                let future = refresh_experience_credential(client, bearer)
                    .boxed()
                    .shared();
                state.refresh_sequence += 1;
                let ticket = state.refresh_sequence;
                state.refresh = Some(Refresh {
                    ticket,
                    request: Arc::clone(&request),
                    future: future.clone(),
                });
                (ticket, request, future)
            }
        };
        let refreshed = pending
            .await
            .map(|credential| self.read_credential(credential));
        let observed = self.host.cookie_generation();
        let (revision, outcome) = {
            let mut state = self.state.lock().unwrap();
            if state.epoch != request.epoch {
                return Some(failed(BackendError::Unavailable));
            }
            let owns_refresh = state
                .refresh
                .as_ref()
                .is_some_and(|refresh| refresh.ticket == ticket);
            if owns_refresh {
                state.refresh = None;
            }
            if request
                .cookie_generation
                .as_ref()
                .is_some_and(|generation| *generation != observed)
            {
                return Some(Outcome::SessionExpired);
            }
            match refreshed {
                Ok((bearer, expiry)) if owns_refresh => {
                    state.bearer = bearer;
                    state.expires_at_ms = expiry;
                    state.revision += 1;
                    (Some(state.revision), None)
                }
                Ok(_) => (None, None),
                Err(error) => (None, Some(request.classify(error, false))),
            }
        };
        if let Some(revision) = revision {
            self.host.credential_refreshed(revision);
        }
        outcome
    }
}

impl ExperienceCredentials {
    pub(super) fn parse_expiry_ms(&self, value: String) -> f64 {
        self.host.parse_expiry_ms(value)
    }

    pub(super) fn now_ms(&self) -> f64 {
        self.host.now_ms()
    }

    pub(super) fn restore_cookie(
        &self,
        request: &ExperienceRequestCredential,
        expires_at: String,
    ) -> Option<String> {
        let generation = request.cookie_generation.as_ref()?;
        let expiry = self.parse_expiry_ms(expires_at);
        let observed = self.host.cookie_generation();
        let mut state = self.state.lock().unwrap();
        if !Arc::ptr_eq(&request.owner, &self.owner)
            || state.epoch != request.epoch
            || state.bearer.is_some()
            || state.cookie_generation != *generation
            || *generation != observed
        {
            return None;
        }
        state.expires_at_ms = expiry;
        Some(generation.clone())
    }

    fn request(
        &self,
        state: &Credentials,
        transport: Arc<dyn HttpTransport>,
        observed: &str,
    ) -> Option<Arc<ExperienceRequestCredential>> {
        let cookie_generation = state
            .bearer
            .is_none()
            .then(|| state.cookie_generation.clone());
        if cookie_generation
            .as_deref()
            .is_some_and(|generation| generation != observed)
        {
            return None;
        }
        Some(Arc::new(ExperienceRequestCredential {
            client: self
                .client
                .credential_snapshot(transport, state.bearer.clone()),
            owner: Arc::clone(&self.owner),
            epoch: state.epoch,
            revision: state.revision,
            cookie_generation,
        }))
    }

    fn read_credential(&self, credential: ExperienceCredential) -> (Option<String>, f64) {
        match credential {
            ExperienceCredential::Cookie { expires_at } => {
                (None, self.host.parse_expiry_ms(expires_at))
            }
            ExperienceCredential::Bearer { expires_at, token } => {
                (Some(token), self.host.parse_expiry_ms(expires_at))
            }
        }
    }

    pub(super) fn is_current(&self, request: &ExperienceRequestCredential) -> bool {
        let observed = self.host.cookie_generation();
        let state = self.state.lock().unwrap();
        Arc::ptr_eq(&request.owner, &self.owner)
            && state.epoch == request.epoch
            && request
                .cookie_generation
                .as_ref()
                .is_none_or(|generation| *generation == observed)
    }
}

impl ExperienceRequestCredential {
    pub(super) fn is_cookie(&self) -> bool {
        self.cookie_generation.is_some()
    }

    pub(super) fn classify(&self, error: ApiError, writes: bool) -> Outcome {
        classify_authenticated_api_error(error, writes, self.revision)
    }
}
