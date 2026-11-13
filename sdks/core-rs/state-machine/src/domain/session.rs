//! The shopper's backend session: establishing it, and ending it. Only
//! the shopper's consent creates one, so a session implies it; the domain
//! records no consent of its own. The domain never sees the session's
//! secret: the host keeps it, as a cookie the browser manages or a token in
//! secure storage, and attaches it to every request. A reset cancels the
//! old session's work.

use std::collections::BTreeSet;

use super::engine::DomainEngine;
use super::model::{BackendError, DomainEffect, DomainOutput};
use super::operation::OperationStatus;
use super::photo::{MediaEffect, Photo, PhotoSource};
use crate::error::Rejection;
use crate::ids::*;
use crate::values::HeightCm;

/// How a session's runtime is set up.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SessionConfig {
    /// A new random UUID for every runtime: the runtime mints its
    /// identifiers from it, so a recreated runtime never accepts an older
    /// one's completions.
    pub runtime_id: RuntimeId,
    /// Capacity of each independent request and result history, 1 to 1024.
    pub max_try_on_requests: u32,
}

impl SessionConfig {
    /// A configuration for `runtime_id` with 64 kept try-on requests.
    pub fn new(runtime_id: RuntimeId) -> Self {
        Self {
            runtime_id,
            max_try_on_requests: 64,
        }
    }
}

/// Where the shopper's session stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SessionPhase {
    /// Created, before the stored session is loaded.
    Uninitialized,
    /// No session; one is created with the shopper's consent.
    Absent,
    /// Checking for a restorable session.
    Restoring,
    /// Creating a new session.
    Creating,
    /// Established: photos, SetHeight and try-ons are allowed.
    Ready,
    /// Restoration failed; `Retry` tries again.
    RestoreFailed,
    /// Creating failed; `Create` tries again.
    CreateFailed,
    /// Disposed for good; every command is refused.
    Disposed,
}

/// The shopper's explicit consent to processing their photo and body
/// measurements, as the API's `dataProcessingConsent` attests it. There is
/// only a granted one: no session is created without it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum DataProcessingConsent {
    /// The shopper explicitly consented.
    Granted,
}

/// What a client asks of the session.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SessionCommand {
    /// Loads the stored session; issued once by the runtime.
    Initialize,
    /// Creates a session unless one is ready or being created; also after
    /// a failed creation.
    Create {
        /// The shopper's consent, which the session is created with.
        data_processing_consent: DataProcessingConsent,
    },
    /// Retries a failed restoration.
    Retry,
    /// Discards the session, its photo, body and try-on requests.
    Reset,
    /// A session-authenticated request reported expiry outside a domain job.
    Expire,
    /// A successful refresh replaced the transport credential for this session.
    CredentialRefreshed { revision: u64 },
    /// Authenticated work outside a domain job received an expiry response.
    CredentialRejected { revision: u64 },
    /// The browser observed that this cookie generation was replaced.
    CookieInvalidated { generation: String },
    /// Resets for good: nothing is accepted afterwards.
    Dispose,
}

/// What the host does to establish the session.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SessionJob {
    /// Restore and validate a stored session and its optional body.
    Restore,
    /// Create a session with the shopper's consent, and keep its secret;
    /// report `Ready` or a failure.
    Create {
        /// The consent to send, as the API's `dataProcessingConsent`.
        data_processing_consent: DataProcessingConsent,
    },
}

/// How a session job ended.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SessionOutcome {
    /// No session could be restored.
    Absent,
    /// The session is valid, or was created.
    Ready,
    /// A validated session already had a body. Only a restoration can
    /// report one: a created session has none.
    Restored { body: RestoredBody },
    /// A validated browser cookie session, with the generation seen by the
    /// adapter. Like `Restored`, only a restoration can report a body.
    CookieEstablished {
        generation: String,
        body: Option<RestoredBody>,
    },
}

/// A body and its source image recovered from a validated shopper session.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RestoredBody {
    pub body_id: BodyId,
    pub media: MediaId,
    /// Where the photo came from. The backend does not record it, so a host
    /// that keeps a body to restore keeps its source with it.
    pub source: PhotoSource,
    pub estimated_height: HeightCm,
    pub height: Option<HeightCm>,
    #[cfg_attr(feature = "uniffi", uniffi(default))]
    pub backend_revision: Option<String>,
}

/// What the host's session storage does; no outcome is reported.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SessionEffect {
    /// Store the established session's secret, replacing any older one.
    Persist,
    /// Forget every stored session secret.
    Clear,
    /// Release local credentials when this runtime goes away, keeping restorable storage.
    Release,
}

/// What happened in the session.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SessionEvent {
    /// A session is established.
    Ready,
    /// A new session was established with the shopper's consent.
    ConsentGranted,
    /// Restoring or creating the session failed.
    Failed {
        /// What the backend reported; the session can be retried.
        error: BackendError,
    },
    /// The session was reset or disposed: its photo, body and try-on
    /// requests are gone.
    Invalidated,
    /// An authenticated operation lost an established session.
    Expired,
}

/// Where establishing the backend session stands. Its `SessionPhase` is
/// what snapshots show.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Session {
    /// Created, before the stored session is loaded.
    Uninitialized,
    /// No session.
    Absent,
    /// Checking for a restorable session.
    Restoring,
    /// Creating a new session.
    Creating,
    /// Established.
    Ready,
    /// Restoration failed.
    RestoreFailed,
    /// Creating failed.
    CreateFailed,
    /// Disposed for good.
    Disposed,
}

impl Session {
    /// Where the session stands.
    pub fn phase(&self) -> SessionPhase {
        match self {
            Self::Uninitialized => SessionPhase::Uninitialized,
            Self::Absent => SessionPhase::Absent,
            Self::Restoring => SessionPhase::Restoring,
            Self::Creating => SessionPhase::Creating,
            Self::Ready => SessionPhase::Ready,
            Self::RestoreFailed => SessionPhase::RestoreFailed,
            Self::CreateFailed => SessionPhase::CreateFailed,
            Self::Disposed => SessionPhase::Disposed,
        }
    }

    /// Refused unless the session is established.
    pub fn ready(&self) -> Result<(), Rejection> {
        match self {
            Self::Ready => Ok(()),
            _ => Err(Rejection::SessionNotReady),
        }
    }
}

impl DomainEngine {
    pub(super) fn session_command(
        &mut self,
        command: SessionCommand,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        match command {
            SessionCommand::Initialize => {
                if self.session.phase() != SessionPhase::Uninitialized {
                    return Ok(());
                }
                self.session = Session::Restoring;
                output.receipt.operation = Some(self.start(SessionJob::Restore, false, output)?);
            }
            SessionCommand::Create {
                data_processing_consent,
            } => {
                match self.session.phase() {
                    SessionPhase::Absent | SessionPhase::CreateFailed => {}
                    SessionPhase::Ready | SessionPhase::Creating => return Ok(()),
                    SessionPhase::RestoreFailed => return Err(Rejection::SessionRestoreFailed),
                    SessionPhase::Disposed => return Err(Rejection::SessionDisposed),
                    SessionPhase::Uninitialized | SessionPhase::Restoring => {
                        return Err(Rejection::SessionRestoring);
                    }
                }
                self.session = Session::Creating;
                let job = SessionJob::Create {
                    data_processing_consent,
                };
                output.receipt.operation = Some(self.start(job, false, output)?);
            }
            SessionCommand::Retry => {
                if self.session != Session::RestoreFailed {
                    return Err(Rejection::NothingToRetry);
                }
                self.session = Session::Restoring;
                output.receipt.operation = Some(self.start(SessionJob::Restore, false, output)?);
            }
            SessionCommand::Reset => self.reset(false, output),
            SessionCommand::Expire => self.expire_session(output),
            SessionCommand::CredentialRefreshed { revision } => {
                if self.session == Session::Ready {
                    self.credential_revision = self.credential_revision.max(revision);
                }
            }
            SessionCommand::CredentialRejected { revision } => {
                if revision == self.credential_revision {
                    self.expire_session(output);
                }
            }
            SessionCommand::CookieInvalidated { generation } => {
                if self.cookie_generation.as_ref() == Some(&generation) {
                    self.expire_session(output);
                } else if matches!(self.session, Session::Restoring | Session::Creating) {
                    self.invalidated_cookie_generations.insert(generation);
                }
            }

            SessionCommand::Dispose => self.reset(true, output),
        }
        Ok(())
    }

    pub(super) fn session_ended(
        &mut self,
        job: SessionJob,
        outcome: SessionOutcome,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        let outcome = match outcome {
            SessionOutcome::CookieEstablished { generation, body } => {
                if self.invalidated_cookie_generations.contains(&generation) {
                    self.reset(false, output);
                    return Ok(());
                }
                self.cookie_generation = Some(generation);
                match body {
                    Some(body) => SessionOutcome::Restored { body },
                    None => SessionOutcome::Ready,
                }
            }
            outcome => outcome,
        };
        self.invalidated_cookie_generations.clear();
        let granted_consent = matches!(job, SessionJob::Create { .. });
        match (job, outcome) {
            (SessionJob::Restore, SessionOutcome::Absent) => {
                self.session = Session::Absent;
            }
            (SessionJob::Restore | SessionJob::Create { .. }, SessionOutcome::Ready) => {
                self.session = Session::Ready;
                output.effects.push(SessionEffect::Persist.into());
                output.events.push(SessionEvent::Ready.into());
                if granted_consent {
                    output.events.push(SessionEvent::ConsentGranted.into());
                }
            }
            (SessionJob::Restore, SessionOutcome::Restored { body }) => {
                self.body.restore(
                    body.body_id,
                    body.estimated_height,
                    body.height,
                    body.backend_revision,
                )?;
                self.photos.commit(Photo {
                    media: body.media,
                    source: body.source,
                });
                self.session = Session::Ready;
                output
                    .effects
                    .push(MediaEffect::Retain { media: body.media }.into());
                output.effects.push(SessionEffect::Persist.into());
                output.events.push(SessionEvent::Ready.into());
            }
            _ => return Err(Rejection::OutcomeMismatch),
        }
        Ok(())
    }

    pub(super) fn session_failed(
        &mut self,
        job: SessionJob,
        error: BackendError,
        output: &mut DomainOutput,
    ) {
        self.session = match job {
            SessionJob::Restore => Session::RestoreFailed,
            SessionJob::Create { .. } => Session::CreateFailed,
        };
        output.events.push(SessionEvent::Failed { error }.into());
    }

    pub(super) fn expire_session(&mut self, output: &mut DomainOutput) {
        if self.session.phase() == SessionPhase::Ready {
            self.reset(false, output);
            output.events.push(SessionEvent::Expired.into());
        }
    }

    /// Ends the session, for a reset or for good: every operation is retired
    /// and every photo released, and a new session begins.
    pub(super) fn reset(&mut self, disposed: bool, output: &mut DomainOutput) {
        self.cookie_generation = None;
        self.invalidated_cookie_generations.clear();
        self.session = if disposed {
            Session::Disposed
        } else {
            Session::Absent
        };
        self.body.end();
        let mut media = BTreeSet::from_iter(self.photos.end().map(|p| p.media));
        for op in self.operations.take_all() {
            if op.status != OperationStatus::Queued {
                output
                    .effects
                    .push(DomainEffect::Cancel { operation: op.id });
            }
            media.extend(op.job.media());
        }
        for media in media {
            output.effects.push(MediaEffect::Release { media }.into());
        }
        self.requests.clear();
        self.size_recommendation = None;
        self.size_recommendation_error = None;
        let effect = if disposed {
            SessionEffect::Release
        } else {
            SessionEffect::Clear
        };
        output.effects.push(effect.into());
        output.events.push(SessionEvent::Invalidated.into());
    }
}
