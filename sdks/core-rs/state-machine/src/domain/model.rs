//! What crosses the domain's boundary, as sums over its concerns. Each
//! concern's commands, jobs, outcomes, effects and events live in its own
//! module; the sums here wrap them, beside what every concern shares:
//! completions, the outcomes any operation can have, cancellation,
//! snapshots and receipts. The session's secret never enters. Clocks and
//! identifiers enter as data, never as ambient state.

use super::body::{BodyCommand, BodyEvent, BodyJob, BodyOutcome, BodyState};
use super::photo::{
    MediaEffect, Photo, PhotoCommand, PhotoEvent, PhotoJob, PhotoOutcome, PhotoSource,
};
use super::product::{Product, ProductCommand};
use super::session::{
    SessionCommand, SessionEffect, SessionEvent, SessionJob, SessionOutcome, SessionPhase,
};
use super::size_recommendation::{
    SizeRecommendation, SizeRecommendationCommand, SizeRecommendationEvent, SizeRecommendationJob,
    SizeRecommendationOutcome,
};
use super::try_on::{
    PermanentTryOnFailure, RefusedTryOn, TryOn, TryOnCommand, TryOnEvent, TryOnJob, TryOnOutcome,
    TryOnRequestSnapshot,
};
use crate::error::Disposition;
use crate::ids::*;
use crate::values::HeightCm;

/// One input to the pure domain.
#[derive(Clone, Debug, PartialEq)]
pub enum DomainInput {
    /// A client's command.
    Command(DomainCommand),
    /// An operation's outcome.
    Completion(Completion),
}

/// What a client asks of the domain, by concern.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum DomainCommand {
    /// Of the product shown.
    Product {
        /// What to do.
        command: ProductCommand,
    },
    /// Of the session.
    Session {
        /// What to do.
        command: SessionCommand,
    },
    /// Of the photo a body is created from.
    Photo {
        /// What to do.
        command: PhotoCommand,
    },
    /// Of the body's height.
    Body {
        /// What to do.
        command: BodyCommand,
    },
    /// Of the size recommendation for the product shown.
    SizeRecommendation {
        /// What to do.
        command: SizeRecommendationCommand,
    },
    /// Of try-ons and the requests for them.
    TryOn {
        /// What to do.
        command: TryOnCommand,
    },
}

/// The work an operation hands the host, by concern, with the inputs it
/// captured when it was registered.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Job {
    /// Establishing the session.
    Session {
        /// What to do.
        job: SessionJob,
    },
    /// Processing a photo.
    Photo {
        /// What to do.
        job: PhotoJob,
    },
    /// Writing the body's height.
    Body {
        /// What to do.
        job: BodyJob,
    },
    /// Fetching the size recommendation.
    SizeRecommendation {
        /// What to do.
        job: SizeRecommendationJob,
    },
    /// Creating a try-on.
    TryOn {
        /// What to do.
        job: TryOnJob,
    },
}

/// The outcome of one operation, reported by the host.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct Completion {
    /// The operation the `Start` effect named.
    pub operation: OperationId,
    /// How it ended.
    pub outcome: Outcome,
}

/// How an operation ended: as its concern says, or as any operation can.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Outcome {
    /// A session job's result.
    Session {
        /// How it ended.
        outcome: SessionOutcome,
    },
    /// A photo job's result.
    Photo {
        /// How it ended.
        outcome: PhotoOutcome,
    },
    /// A body job's result.
    Body {
        /// How it ended.
        outcome: BodyOutcome,
        /// Opaque revision returned by the backend for this write.
        #[cfg_attr(feature = "uniffi", uniffi(default))]
        backend_revision: Option<String>,
    },
    /// The height write may have committed, but returned no usable revision.
    HeightWriteUnconfirmed,
    /// What the backend reports for the body after an unconfirmed height write.
    HeightReadback {
        height: Option<HeightCm>,
        backend_revision: Option<String>,
    },
    /// A size recommendation job's result.
    SizeRecommendation {
        /// How it ended.
        outcome: SizeRecommendationOutcome,
    },
    /// A try-on job's result.
    TryOn {
        /// How it ended.
        outcome: TryOnOutcome,
    },
    /// An authoritative terminal failure: the job has ended.
    Failed {
        /// What the backend reported.
        error: BackendError,
    },
    /// The session is definitively invalid or expired (not a network error).
    SessionExpired,
    /// The API rejected the specific credential used for this request.
    CredentialRejected { revision: u64 },
    /// The work may still run remotely; never a terminal failure.
    Unknown,
}

/// Why the backend failed an operation, by the API's problem kinds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum BackendError {
    /// The request was invalid (a 400 problem).
    InvalidRequest,
    /// The body, product, variant, upload or try-on is not in this session
    /// or shop (a 404 problem).
    NotFound,
    /// The body or pinned body revision is no longer accessible.
    BodyNotFound,
    /// The backend cannot do it for these inputs: `body-unusable`,
    /// `height-calibration-failed` or `recommendation-unavailable`.
    Unusable,
    /// The backend failed internally (a 500 problem).
    Internal,
    /// The backend is unavailable (a 503 problem).
    Unavailable,
}

impl From<BodyOutcome> for Outcome {
    fn from(outcome: BodyOutcome) -> Self {
        Self::Body {
            outcome,
            backend_revision: None,
        }
    }
}

/// Work the host performs for the domain.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum DomainEffect {
    /// Start an operation: do its job, then report how it ended with a
    /// `Completion` naming the operation.
    Start {
        /// The operation to report with.
        operation: OperationId,
        /// Exactly what to do, with what the backend needs, nothing else.
        job: Job,
    },
    /// Best-effort physical cancellation.
    Cancel {
        /// The operation to cancel; still report its terminal outcome once
        /// known.
        operation: OperationId,
    },
    /// Store or forget the session's secret.
    Session {
        /// What to do.
        effect: SessionEffect,
    },
    /// Persist the accepted body selection for a future session restore.
    PersistBody {
        body_id: BodyId,
        source: PhotoSource,
    },
    /// Take or release the domain's interest in a photo.
    Media {
        /// What to do.
        effect: MediaEffect,
    },
}

/// The work whose remote outcome could not be confirmed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum UncertainWork {
    Photo,
    Height,
    RequestedTryOn,
    BackgroundTryOn,
    Other,
}

/// What happened in the domain, by concern, for the flow and the host.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum DomainEvent {
    /// In the session.
    Session {
        /// What happened.
        event: SessionEvent,
    },
    /// To a photo.
    Photo {
        /// What happened.
        event: PhotoEvent,
    },
    /// To the body's height.
    Body {
        /// What happened.
        event: BodyEvent,
    },
    /// To the size recommendation for the product shown.
    SizeRecommendation {
        /// What happened.
        event: SizeRecommendationEvent,
    },
    /// To a try-on or a request for one.
    TryOn {
        /// What happened.
        event: TryOnEvent,
    },
    /// An operation's outcome became unknown.
    OperationUncertain {
        /// The operation whose outcome is unknown; it stays outstanding
        /// until an authoritative outcome settles it.
        operation: OperationId,
        work: UncertainWork,
        product_id: Option<ProductId>,
    },
}

/// Everything one domain input produced, in order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DomainOutput {
    /// How the input was taken.
    pub receipt: DomainReceipt,
    /// The work the host must start, in order.
    pub effects: Vec<DomainEffect>,
    /// What happened, in order, for the flow and the host.
    pub events: Vec<DomainEvent>,
}

/// How the domain took an input, and what it started for it.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DomainReceipt {
    /// Whether the input applied, was ignored, or was rejected and why.
    pub disposition: Disposition,
    /// The operation the input started or joined, if any.
    pub operation: Option<OperationId>,
    /// The try-on request the input created, if any.
    pub try_on_request_id: Option<TryOnRequestId>,
}

impl Default for DomainReceipt {
    fn default() -> Self {
        Self {
            disposition: Disposition::Applied,
            operation: None,
            try_on_request_id: None,
        }
    }
}

/// What the domain shows its client: one field per concern, in the
/// concerns' order, and no engine internals.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DomainSnapshot {
    /// The product the shopper is shown, once the host set one.
    pub product: Option<Product>,
    /// Where the session stands: loading, absent, ready, failed, disposed, …
    pub session: SessionPhase,
    /// The photo the body was created from, once one was accepted.
    pub photo: Option<Photo>,
    /// The committed body, once a photo was accepted, and where it stands.
    pub body: BodyState,
    /// The size recommendation for the product and the body's acknowledged
    /// height, once it arrived.
    pub size_recommendation: Option<SizeRecommendation>,
    /// Whether the current body's recommendation is being fetched.
    pub size_recommendation_pending: bool,
    /// The latest recommendation fetch for this product and body failed.
    pub size_recommendation_error: Option<BackendError>,
    /// Recent request receipts for the current body, oldest first.
    pub try_on_requests: Vec<TryOnRequestSnapshot>,
    /// Completed try-ons in creation order, independent of request receipts.
    pub try_ons: Vec<TryOn>,
    /// Backend refusals for the current body revision, independent of request history.
    pub try_on_refusals: Vec<RefusedTryOn>,
    /// Terminal input failures for the current body revision, independent of request history.
    pub permanent_try_on_failures: Vec<PermanentTryOnFailure>,
    /// Variants the storefront reports as unavailable.
    pub unavailable_variants: Vec<VariantId>,
    /// A render of this body may still be running remotely. New renders and
    /// height writes wait until it settles or the shopper replaces the body.
    pub uncertain_try_on: bool,
    /// Operations whose result is still unknown, even if the flow moved on.
    pub uncertain_operations: Vec<OperationId>,
}

/// Each concern's enum wraps into its sum, so callers can write
/// `SessionCommand::Reset.into()`.
macro_rules! wraps {
    ($($sum:ident :: $variant:ident { $field:ident : $concern:ty },)*) => {$(
        impl From<$concern> for $sum {
            fn from($field: $concern) -> Self {
                Self::$variant { $field }
            }
        }
    )*};
}
pub(crate) use wraps;

wraps! {
    DomainCommand::Product { command: ProductCommand },
    DomainCommand::Session { command: SessionCommand },
    DomainCommand::Photo { command: PhotoCommand },
    DomainCommand::Body { command: BodyCommand },
    DomainCommand::SizeRecommendation { command: SizeRecommendationCommand },
    DomainCommand::TryOn { command: TryOnCommand },
    Job::Session { job: SessionJob },
    Job::Photo { job: PhotoJob },
    Job::Body { job: BodyJob },
    Job::SizeRecommendation { job: SizeRecommendationJob },
    Job::TryOn { job: TryOnJob },
    Outcome::Session { outcome: SessionOutcome },
    Outcome::Photo { outcome: PhotoOutcome },
    Outcome::SizeRecommendation { outcome: SizeRecommendationOutcome },
    Outcome::TryOn { outcome: TryOnOutcome },
    DomainEffect::Session { effect: SessionEffect },
    DomainEffect::Media { effect: MediaEffect },
    DomainEvent::Session { event: SessionEvent },
    DomainEvent::Photo { event: PhotoEvent },
    DomainEvent::Body { event: BodyEvent },
    DomainEvent::SizeRecommendation { event: SizeRecommendationEvent },
    DomainEvent::TryOn { event: TryOnEvent },
}
