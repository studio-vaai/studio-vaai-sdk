//! The domain engine: applies one input at a time atomically to the domain's
//! state, hands each input to the concern it belongs to, and starts queued
//! work once the state allows it. What each concern's commands and outcomes
//! do is in its own module.

use super::body::{Body, BodyState, HeightStatus};
use super::model::*;
use super::operation::{OperationStatus, Operations};
use super::photo::Photos;
use super::product::Product;
use super::session::{Session, SessionConfig, SessionPhase};
use super::size_recommendation::{SizeRecommendation, SizeRecommendationJob};
use super::try_on::{TryOnJob, TryOnRequests};
use crate::error::{Disposition, Rejection};
use crate::ids::*;

/// The domain's deterministic state, and the engine that changes it.
#[derive(Clone, Debug, PartialEq)]
pub struct DomainEngine {
    /// The operations out with the host.
    pub(super) operations: Operations,
    /// Mints try-on request IDs from the runtime ID.
    pub(super) request_ids: Sequence<TryOnRequestId>,
    /// The product the shopper is shown, once the host set one.
    pub(super) product: Option<Product>,
    pub(super) catalogue_revision: CatalogueRevision,
    /// The backend session.
    pub(super) session: Session,
    pub(super) credential_revision: u64,
    pub(super) cookie_generation: Option<String>,
    pub(super) invalidated_cookie_generations: std::collections::BTreeSet<String>,
    /// The committed photo and the one being processed to replace it.
    pub(super) photos: Photos,
    /// The body created from the committed photo.
    pub(super) body: Body,
    /// The size recommendation for the product and the body's
    /// acknowledged height, once it arrived.
    pub(super) size_recommendation: Option<SizeRecommendation>,
    pub(super) size_recommendation_error: Option<BackendError>,
    /// The try-on requests, with the try-ons they came to.
    pub(super) requests: TryOnRequests,
    pub(super) unavailable_variants: std::collections::BTreeSet<VariantId>,
}

impl DomainEngine {
    pub fn new(config: SessionConfig) -> Result<Self, Rejection> {
        if config.runtime_id.0.is_nil() || !(1..=1024).contains(&config.max_try_on_requests) {
            return Err(Rejection::InvalidConfig);
        }
        let seed = config.runtime_id.0;
        Ok(Self {
            operations: Operations::new(seed),
            request_ids: Sequence::new(seed),
            product: None,
            catalogue_revision: CatalogueRevision::default(),
            session: Session::Uninitialized,
            credential_revision: 0,
            cookie_generation: None,
            invalidated_cookie_generations: Default::default(),
            photos: Photos::new(),
            body: Body::new(),
            size_recommendation: None,
            size_recommendation_error: None,
            requests: TryOnRequests::new(config.max_try_on_requests as usize),
            unavailable_variants: std::collections::BTreeSet::new(),
        })
    }

    /// Applies one input atomically: a rejected input leaves state and
    /// output unchanged, and one that changes nothing is `Ignored`.
    pub fn dispatch(&mut self, input: DomainInput) -> DomainOutput {
        let mut next = self.clone();
        let mut output = DomainOutput::default();
        let result = match input {
            DomainInput::Command(command) => next.command(command, &mut output),
            DomainInput::Completion(completion) => next.complete(completion, &mut output),
        }
        .and_then(|()| next.drive(&mut output));
        let receipt = |disposition| DomainOutput {
            receipt: DomainReceipt {
                disposition,
                ..DomainReceipt::default()
            },
            ..DomainOutput::default()
        };
        match result {
            Err(reason) => receipt(Disposition::Rejected { reason }),
            Ok(())
                if next == *self
                    && output.effects.is_empty()
                    && output.events.is_empty()
                    && output.receipt.operation.is_none()
                    && output.receipt.try_on_request_id.is_none() =>
            {
                receipt(Disposition::Ignored)
            }
            Ok(()) => {
                *self = next;
                output
            }
        }
    }

    pub fn snapshot(&self) -> DomainSnapshot {
        DomainSnapshot {
            product: self.product.clone(),
            session: self.session.phase(),
            photo: self.photos.committed,
            body: self.body.state.clone(),
            size_recommendation: self
                .size_recommendation
                .as_ref()
                .filter(|recommendation| {
                    self.body.state.acknowledged() == Some(recommendation.key.body_revision)
                })
                .cloned(),
            size_recommendation_pending: self
                .operations
                .iter()
                .any(|operation| matches!(operation.job, Job::SizeRecommendation { .. })),
            size_recommendation_error: matches!(
                self.body.state,
                BodyState::Live {
                    height: HeightStatus::Acknowledged { .. },
                    ..
                } | BodyState::Missing { .. }
            )
            .then_some(self.size_recommendation_error)
            .flatten(),
            try_on_requests: self.requests.views(),
            try_ons: self.requests.results(),
            try_on_refusals: self.requests.refusals(),
            permanent_try_on_failures: self.requests.permanent_failures(),
            unavailable_variants: self.unavailable_variants.iter().copied().collect(),
            uncertain_operations: self
                .operations
                .iter()
                .filter(|operation| operation.status == OperationStatus::Uncertain)
                .map(|operation| operation.id)
                .collect(),
            uncertain_try_on: self.operations.iter().any(|operation| {
                operation.status == OperationStatus::Uncertain
                    && matches!(operation.job, Job::TryOn { .. })
            }),
        }
    }

    fn command(
        &mut self,
        command: DomainCommand,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        if self.session.phase() == SessionPhase::Disposed {
            return Err(Rejection::SessionDisposed);
        }
        match command {
            DomainCommand::Product { command } => self.product_command(command, output),
            DomainCommand::Session { command } => self.session_command(command, output),
            DomainCommand::Photo { command } => self.photo_command(command, output),
            DomainCommand::Body { command } => self.body_command(command, output),
            DomainCommand::SizeRecommendation { command } => {
                self.size_recommendation_command(command, output)
            }
            DomainCommand::TryOn { command } => self.try_on_command(command, output),
        }
    }

    /// Settles an operation. Unknown, retired and duplicate completions are
    /// ignored; an outcome of another concern or job is rejected, and with
    /// it the whole input, so the operation stays.
    fn complete(
        &mut self,
        completion: Completion,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        let Some(op) = self.operations.get(completion.operation).cloned() else {
            return Ok(());
        };
        if op.status == OperationStatus::Queued {
            return Ok(());
        }
        let reported = match completion.outcome {
            Outcome::CredentialRejected { revision } if revision == self.credential_revision => {
                Outcome::SessionExpired
            }
            Outcome::CredentialRejected { .. } => Outcome::Failed {
                error: BackendError::Unavailable,
            },
            outcome => outcome,
        };
        let outcome = match &op.job {
            Job::Body { job } => {
                let Some(outcome) = self.resolve_body_completion(&op, job, reported, output)?
                else {
                    return Ok(());
                };
                outcome
            }
            // An unconfirmed creation is a failed one: the next creation
            // starts a fresh session, and an orphan holds no photo.
            Job::Session {
                job: super::session::SessionJob::Create { .. },
            } if reported == Outcome::Unknown => Outcome::Failed {
                error: BackendError::Unavailable,
            },
            _ => reported,
        };
        if matches!(outcome, Outcome::Unknown) && op.status == OperationStatus::Uncertain {
            return Ok(());
        }
        match outcome {
            Outcome::SessionExpired
                if matches!(
                    op.job,
                    Job::Session {
                        job: super::session::SessionJob::Restore
                    }
                ) =>
            {
                // The stored session is expired for good: forget it, so the
                // next runtime does not restore it again. The shopper had no
                // session in this runtime, so nothing reports an expiry.
                self.operations.remove(op.id);
                self.session = Session::Absent;
                self.invalidated_cookie_generations.clear();
                output
                    .effects
                    .push(super::session::SessionEffect::Clear.into());
                Ok(())
            }
            Outcome::SessionExpired => {
                if self.session.phase() == SessionPhase::Ready {
                    self.expire_session(output);
                } else {
                    self.reset(false, output);
                }
                Ok(())
            }
            Outcome::Unknown => {
                if let Job::Photo { job } = &op.job
                    && !self.photos.processes(op.id)
                {
                    self.operations.remove(op.id);
                    self.photo_failed(op.id, job.clone(), BackendError::Unavailable, output);
                    return Ok(());
                }
                // A render only stays uncertain while a request wants it:
                // one every client let go of is dropped now.
                if let Job::TryOn { .. } = op.job
                    && !self.requests.wanted(op.id)
                {
                    self.drop_render(op.id, output);
                    return Ok(());
                }
                if let Some(stored) = self.operations.get_mut(op.id) {
                    stored.status = OperationStatus::Uncertain;
                }
                if let Job::Body { .. } = op.job {
                    self.body.height_uncertain(op.id);
                }
                let work = match op.job {
                    Job::Photo { .. } => UncertainWork::Photo,
                    Job::Body { .. } => UncertainWork::Height,
                    Job::TryOn { .. } if self.requests.has_foreground_request(op.id) => {
                        UncertainWork::RequestedTryOn
                    }
                    Job::TryOn { .. } => UncertainWork::BackgroundTryOn,
                    _ => UncertainWork::Other,
                };
                output.events.push(DomainEvent::OperationUncertain {
                    operation: op.id,
                    work,
                    product_id: op.product_id,
                });
                Ok(())
            }
            Outcome::Failed { error } => {
                self.operations.remove(op.id);
                match op.job {
                    Job::Session { job } => self.session_failed(job, error, output),
                    Job::Photo { job } => self.photo_failed(op.id, job, error, output),
                    Job::Body { job } => self.body_failed(op.id, job, error, output),
                    Job::SizeRecommendation { job } => {
                        let SizeRecommendationJob::Fetch { body_id, .. } = job;
                        if error == BackendError::BodyNotFound {
                            self.mark_body_missing(body_id, output);
                        }
                        self.size_recommendation_failed(error, output)
                    }
                    Job::TryOn { job } => {
                        let TryOnJob::Create { body_id, key, .. } = job;
                        if error == BackendError::BodyNotFound {
                            self.mark_body_missing(body_id, output);
                        }
                        self.try_on_failed(op.id, key, error, output);
                    }
                }
                Ok(())
            }
            outcome => {
                self.operations.remove(op.id);
                match (op.job, outcome) {
                    (Job::Session { job }, Outcome::Session { outcome }) => {
                        self.session_ended(job, outcome, output)
                    }
                    (Job::Photo { job }, Outcome::Photo { outcome }) => {
                        self.photo_ended(op.id, job, outcome, output)
                    }
                    (
                        Job::Body { job },
                        Outcome::Body {
                            outcome,
                            backend_revision,
                        },
                    ) => self.body_ended(op.id, job, outcome, backend_revision, output),
                    (Job::SizeRecommendation { job }, Outcome::SizeRecommendation { outcome }) => {
                        self.size_recommendation_ended(job, outcome, output)
                    }
                    (Job::TryOn { job }, Outcome::TryOn { outcome }) => {
                        self.try_on_ended(op.id, job, outcome, op.result_fit, output)
                    }
                    _ => Err(Rejection::OutcomeMismatch),
                }
            }
        }
    }

    /// Starts the queued work the state now allows: a pending SetHeight
    /// once no reader of the body is out, otherwise waiting try-on
    /// requests, oldest first.
    fn drive(&mut self, output: &mut DomainOutput) -> Result<(), Rejection> {
        if self.session.phase() != SessionPhase::Ready {
            return Ok(());
        }
        // Writes win: no new reader of the body starts while one waits.
        if self.drive_height(output) {
            return Ok(());
        }
        self.drive_requests(output)
    }

    /// Registers an operation for `job` and, unless it is queued, hands out
    /// its effect.
    pub(super) fn start(
        &mut self,
        job: impl Into<Job>,
        queued: bool,
        output: &mut DomainOutput,
    ) -> Result<OperationId, Rejection> {
        let job = job.into();
        let fit = match &job {
            Job::TryOn {
                job: TryOnJob::Create { key, .. },
            } => self.fit_for_render(key),
            _ => None,
        };
        let operation =
            self.operations
                .register(job, queued, self.product.as_ref().map(|p| p.id))?;
        operation.result_fit = fit;
        if !queued {
            output.effects.push(operation.effect());
        }
        Ok(operation.id)
    }

    /// Retires the operations whose job is `outdated`, cancelling those out
    /// with the host; their late completions find nothing.
    pub(super) fn retire(&mut self, outdated: impl Fn(&Job) -> bool, output: &mut DomainOutput) {
        for operation in self.operations.retire(outdated) {
            output.effects.push(DomainEffect::Cancel { operation });
        }
    }
}
