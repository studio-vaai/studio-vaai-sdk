//! The shopper's body, created from the committed photo, and the height set
//! for it. A SetHeight never overlaps a read of the body: it waits for the
//! jobs reading it, and no new reader starts while it waits.

use super::engine::DomainEngine;
use super::model::{BackendError, DomainEffect, DomainOutput, DomainSnapshot, Job, Outcome};
use super::operation::{Operation, OperationStatus};
use crate::error::Rejection;
use crate::ids::*;
use crate::values::*;

/// What the domain knows of the shopper's body: none yet, one whose height
/// is being set, or one the backend no longer has. Its photo is the
/// committed one in `DomainSnapshot::photo`.
#[derive(Clone, Debug, PartialEq, Default)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum BodyState {
    /// No photo was accepted yet, or the session was reset.
    #[default]
    NoBody,
    /// The committed body, and where its height stands with the backend.
    Live {
        identity: BodyIdentity,
        height: HeightStatus,
    },
    /// The backend answered `BodyNotFound` for the committed body: it was
    /// deleted or expired there. Only a new photo, which brings a new body,
    /// or a reset leaves this state.
    Missing { identity: BodyIdentity },
}

/// What every committed body has, whatever its state.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct BodyIdentity {
    /// The backend's identifier of the body; an accepted replacement photo
    /// always brings a new one.
    pub body_id: BodyId,
    /// The height the backend estimated from the photo; it seeds the
    /// experience's height input.
    pub estimated_height: HeightCm,
}

impl BodyState {
    /// The committed body, live or missing.
    pub fn identity(&self) -> Option<&BodyIdentity> {
        match self {
            Self::NoBody => None,
            Self::Live { identity, .. } | Self::Missing { identity } => Some(identity),
        }
    }

    /// The committed body's identifier, live or missing.
    pub fn body_id(&self) -> Option<BodyId> {
        self.identity().map(|identity| identity.body_id)
    }

    /// Where the live body's height stands; none without a live body.
    pub fn height(&self) -> Option<&HeightStatus> {
        match self {
            Self::Live { height, .. } => Some(height),
            Self::NoBody | Self::Missing { .. } => None,
        }
    }

    /// The live body's acknowledged revision, when it is current.
    pub fn acknowledged(&self) -> Option<BodyRevision> {
        self.height().and_then(HeightStatus::acknowledged)
    }

    /// Whether the backend no longer has the committed body.
    pub fn is_missing(&self) -> bool {
        matches!(self, Self::Missing { .. })
    }
}

/// Where a live body's height stands with the backend.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum HeightStatus {
    /// No height set yet, or the last SetHeight failed.
    Unset,
    /// Acknowledged: try-ons and the size recommendation read this
    /// revision.
    Acknowledged {
        /// The body's current height revision.
        revision: BodyRevision,
        /// The height it was written with; a SetHeight repeating it writes
        /// nothing.
        height: HeightCm,
        /// The backend's opaque revision of this height, when it supplied
        /// one.
        backend_revision: Option<String>,
    },
    /// A SetHeight is queued or running; try-on requests made meanwhile
    /// wait for its revision.
    Pending {
        /// The SetHeight operation.
        operation: OperationId,
        /// The height submitted for this write.
        height: HeightCm,
    },
    /// A SetHeight's outcome is unknown; nothing reads the body until an
    /// authoritative outcome settles it.
    Uncertain {
        /// The SetHeight operation.
        operation: OperationId,
        /// The height submitted for this write.
        height: HeightCm,
    },
}

impl HeightStatus {
    /// The acknowledged revision, when it is current.
    pub fn acknowledged(&self) -> Option<BodyRevision> {
        match self {
            Self::Acknowledged { revision, .. } => Some(*revision),
            _ => None,
        }
    }

    /// The SetHeight still outstanding, pending or uncertain.
    pub fn outstanding(&self) -> Option<OperationId> {
        match self {
            Self::Pending { operation, .. } | Self::Uncertain { operation, .. } => Some(*operation),
            _ => None,
        }
    }
}

/// The body revision a try-on request reads.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum BodyTarget {
    /// An acknowledged revision; it must still be current.
    Acknowledged {
        /// The revision to read.
        revision: BodyRevision,
    },
    /// The revision a pending SetHeight will produce.
    Pending {
        /// The pending SetHeight; the request waits for it and fails if it
        /// fails.
        operation: OperationId,
    },
}

/// What a client asks of the body.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum BodyCommand {
    /// Writes the shopper's height, once no try-on or size recommendation
    /// reads the body.
    SetHeight {
        /// The shopper's height, finite and positive.
        height: HeightCm,
    },
}

/// What the host does to the body.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum BodyJob {
    /// One write of the body's height; report `HeightSet` or a failure.
    SetHeight {
        /// The body whose height to write.
        body_id: BodyId,
        /// The product shown when the shopper confirmed the height, if any.
        product_id: Option<ProductId>,
        /// The height to write.
        height: HeightCm,
    },
    /// Read the body after an unconfirmed write. The expected height belongs
    /// to the pending operation; the adapter reports the actual saved values.
    ReadHeight { body_id: BodyId, height: HeightCm },
}

impl BodyJob {
    fn height(&self) -> HeightCm {
        match *self {
            Self::SetHeight { height, .. } | Self::ReadHeight { height, .. } => height,
        }
    }
}

/// How a body job ended.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum BodyOutcome {
    /// The height was written.
    HeightSet,
}

/// What happened to the body's height.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum BodyEvent {
    /// The height was acknowledged.
    HeightSet {
        /// The SetHeight operation.
        operation: OperationId,
        /// The body's new acknowledged revision.
        revision: BodyRevision,
    },
    /// Writing the height failed.
    SetHeightFailed {
        /// The SetHeight operation.
        operation: OperationId,
        /// The height submitted with this operation.
        height: HeightCm,
        /// What the backend reported; requests waiting for it failed too.
        error: BackendError,
    },
}

/// The committed body and the height revisions acknowledged.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Body {
    /// The last height revision acknowledged, for any body.
    pub last_revision: BodyRevision,
    /// The committed body, if any, and where it stands.
    pub state: BodyState,
}

/// A body whose height is acknowledged: what its readers capture.
pub(super) struct ReadyBody<'a> {
    pub body_id: BodyId,
    pub revision: BodyRevision,
    pub backend_revision: &'a Option<String>,
}

impl Body {
    pub fn new() -> Self {
        Self {
            last_revision: BodyRevision(0),
            state: BodyState::NoBody,
        }
    }

    /// The live body's height status; none without a live body.
    pub fn height_status(&self) -> Option<&HeightStatus> {
        self.state.height()
    }

    /// The committed body with its acknowledged height, refused without a
    /// body or an acknowledged height.
    pub fn ready(&self) -> Result<ReadyBody<'_>, Rejection> {
        match &self.state {
            BodyState::NoBody => Err(Rejection::NoPhoto),
            BodyState::Live {
                identity,
                height:
                    HeightStatus::Acknowledged {
                        revision,
                        backend_revision,
                        ..
                    },
            } => Ok(ReadyBody {
                body_id: identity.body_id,
                revision: *revision,
                backend_revision,
            }),
            BodyState::Live { .. } | BodyState::Missing { .. } => {
                Err(Rejection::HeightNotAcknowledged)
            }
        }
    }

    /// Commits the body created from an accepted photo.
    pub fn commit(&mut self, body_id: BodyId, estimated_height: HeightCm) -> Result<(), Rejection> {
        if self.state.body_id() == Some(body_id) {
            return Err(Rejection::BodyIdentityReused);
        }
        self.state = BodyState::Live {
            identity: BodyIdentity {
                body_id,
                estimated_height,
            },
            height: HeightStatus::Unset,
        };
        Ok(())
    }

    pub fn restore(
        &mut self,
        body_id: BodyId,
        estimated_height: HeightCm,
        height: Option<HeightCm>,
        backend_revision: Option<String>,
    ) -> Result<(), Rejection> {
        validate_height(estimated_height)?;
        if let Some(height) = height {
            validate_height(height)?;
            let revision = self.last_revision.next().ok_or(Rejection::Exhausted)?;
            self.commit(body_id, estimated_height)?;
            self.last_revision = revision;
            self.set_status(HeightStatus::Acknowledged {
                revision,
                height,
                backend_revision,
            });
        } else {
            self.commit(body_id, estimated_height)?;
        }
        Ok(())
    }

    /// Moves a live body's height on; a missing body or none has no height.
    fn set_status(&mut self, status: HeightStatus) {
        if let BodyState::Live { height, .. } = &mut self.state {
            *height = status;
        }
    }

    /// A SetHeight is queued: requests made meanwhile wait for its revision.
    pub fn await_height(&mut self, operation: OperationId, height: HeightCm) {
        self.set_status(HeightStatus::Pending { operation, height });
    }

    /// The outstanding SetHeight `operation` succeeded; returns the body's
    /// new revision.
    pub fn acknowledge_height(
        &mut self,
        operation: OperationId,
        height: HeightCm,
        backend_revision: Option<String>,
    ) -> Result<BodyRevision, Rejection> {
        let revision = self.last_revision.next().ok_or(Rejection::Exhausted)?;
        if self.height_status().and_then(HeightStatus::outstanding) != Some(operation) {
            return Err(Rejection::SetHeightMismatch);
        }
        self.set_status(HeightStatus::Acknowledged {
            revision,
            height,
            backend_revision,
        });
        self.last_revision = revision;
        Ok(revision)
    }

    /// The outstanding SetHeight failed. That does not make an older
    /// revision usable.
    pub fn height_failed(&mut self, error: BackendError) {
        if error == BackendError::BodyNotFound {
            self.mark_missing();
        } else {
            self.set_status(HeightStatus::Unset);
        }
    }

    /// The backend no longer has the committed body.
    pub fn mark_missing(&mut self) {
        if let Some(identity) = self.state.identity().copied() {
            self.state = BodyState::Missing { identity };
        }
    }

    /// The outcome of SetHeight `operation` is unknown. Only that write,
    /// while still pending, becomes uncertain.
    pub fn height_uncertain(&mut self, operation: OperationId) {
        if let Some(&HeightStatus::Pending {
            operation: pending,
            height,
        }) = self.height_status()
            && pending == operation
        {
            self.set_status(HeightStatus::Uncertain { operation, height });
        }
    }

    /// Forgets the body, for a reset.
    pub fn end(&mut self) {
        self.state = BodyState::NoBody;
    }
}

impl DomainSnapshot {
    /// The body revision a new try-on request can read now, if any.
    pub fn body_target(&self) -> Option<BodyTarget> {
        match self.body.height()? {
            HeightStatus::Acknowledged { revision, .. } => Some(BodyTarget::Acknowledged {
                revision: *revision,
            }),
            HeightStatus::Pending { operation, .. } => Some(BodyTarget::Pending {
                operation: *operation,
            }),
            HeightStatus::Unset | HeightStatus::Uncertain { .. } => None,
        }
    }
}

impl Job {
    /// Whether the job reads the committed body, so a SetHeight waits for
    /// it.
    pub(super) fn reads_body(&self) -> bool {
        matches!(self, Job::SizeRecommendation { .. } | Job::TryOn { .. })
    }
}

/// Refused unless `height` is finite and positive.
pub(crate) fn validate_height(height: HeightCm) -> Result<(), Rejection> {
    if height.is_valid() {
        Ok(())
    } else {
        Err(Rejection::InvalidHeight)
    }
}

impl DomainEngine {
    pub(super) fn body_command(
        &mut self,
        command: BodyCommand,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        let BodyCommand::SetHeight { height } = command;
        self.session.ready()?;
        validate_height(height)?;
        let (identity, status) = match &self.body.state {
            BodyState::NoBody => return Err(Rejection::NoPhoto),
            BodyState::Missing { .. } => {
                return Err(Rejection::TryOnInputsUnavailable {
                    error: BackendError::BodyNotFound,
                });
            }
            BodyState::Live { identity, height } => (*identity, height.clone()),
        };
        if let Some(operation) = status.outstanding() {
            if let Some(op) = self.operations.get(operation)
                && let Job::Body { job } = &op.job
                && job.height() == height
                && op.status != OperationStatus::Uncertain
            {
                output.receipt.operation = Some(operation);
                return Ok(());
            }
            return Err(Rejection::HeightWritePending);
        }
        if let HeightStatus::Acknowledged {
            height: acknowledged,
            ..
        } = status
            && acknowledged == height
        {
            return Ok(());
        }
        let job = BodyJob::SetHeight {
            body_id: identity.body_id,
            product_id: self.product.as_ref().map(|product| product.id),
            height,
        };
        let operation = self.start(job, true, output)?;
        self.body.await_height(operation, height);
        output.receipt.operation = Some(operation);
        Ok(())
    }

    /// Turns transport facts into an authoritative height result or continues
    /// the same pending operation with a read. The adapter never repeats the write.
    pub(super) fn resolve_body_completion(
        &mut self,
        operation: &Operation,
        job: &BodyJob,
        outcome: Outcome,
        output: &mut DomainOutput,
    ) -> Result<Option<Outcome>, Rejection> {
        let result = match (job, outcome) {
            (
                BodyJob::SetHeight {
                    body_id, height, ..
                },
                Outcome::HeightWriteUnconfirmed,
            ) if operation.status == OperationStatus::Running => {
                if let Some(stored) = self.operations.get_mut(operation.id) {
                    stored.job = BodyJob::ReadHeight {
                        body_id: *body_id,
                        height: *height,
                    }
                    .into();
                    output.effects.push(stored.effect());
                }
                return Ok(None);
            }
            (
                BodyJob::ReadHeight {
                    height: expected, ..
                },
                Outcome::HeightReadback {
                    height,
                    backend_revision,
                },
            ) => match backend_revision.filter(|revision| !revision.is_empty()) {
                Some(revision) if height == Some(*expected) => Outcome::Body {
                    outcome: BodyOutcome::HeightSet,
                    backend_revision: Some(revision),
                },
                _ => Outcome::Unknown,
            },
            // A failed read does not establish that the write failed.
            (BodyJob::ReadHeight { .. }, Outcome::Failed { .. }) => Outcome::Unknown,
            (BodyJob::ReadHeight { .. }, Outcome::Body { .. })
            | (_, Outcome::HeightWriteUnconfirmed | Outcome::HeightReadback { .. }) => {
                return Err(Rejection::OutcomeMismatch);
            }
            (_, outcome) => outcome,
        };
        Ok(Some(result))
    }

    pub(super) fn body_ended(
        &mut self,
        operation: OperationId,
        job: BodyJob,
        outcome: BodyOutcome,
        backend_revision: Option<String>,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        let BodyOutcome::HeightSet = outcome;
        let height = job.height();
        let revision = self
            .body
            .acknowledge_height(operation, height, backend_revision)?;
        self.size_recommendation = None;
        self.size_recommendation_error = None;
        self.requests.clear_terminal_outcomes();
        self.requests.retarget(operation, revision);
        output.events.push(
            BodyEvent::HeightSet {
                operation,
                revision,
            }
            .into(),
        );
        Ok(())
    }

    pub(super) fn body_failed(
        &mut self,
        operation: OperationId,
        job: BodyJob,
        error: BackendError,
        output: &mut DomainOutput,
    ) {
        self.body.height_failed(error);
        self.requests
            .fail_waiting_on(operation, error, &mut output.events);
        output.events.push(
            BodyEvent::SetHeightFailed {
                operation,
                height: job.height(),
                error,
            }
            .into(),
        );
    }

    pub(super) fn mark_body_missing(&mut self, body_id: BodyId, output: &mut DomainOutput) {
        if self.body.state.body_id() != Some(body_id) {
            return;
        }
        let error = BackendError::BodyNotFound;
        if let Some(operation) = self
            .body
            .height_status()
            .and_then(HeightStatus::outstanding)
            && let Some(work) = self.operations.remove(operation)
            && let Job::Body { job } = work.job
        {
            if work.status != OperationStatus::Queued {
                output.effects.push(DomainEffect::Cancel { operation });
            }
            self.body_failed(operation, job, error, output);
        } else {
            self.body.mark_missing();
        }
    }

    /// Starts a queued SetHeight once no reader of the body is out. Returns
    /// whether a SetHeight is outstanding, so no new reader starts.
    pub(super) fn drive_height(&mut self, output: &mut DomainOutput) -> bool {
        let Some(set_height) = self
            .body
            .height_status()
            .and_then(HeightStatus::outstanding)
        else {
            return false;
        };
        let reading = self
            .operations
            .iter()
            .any(|o| o.job.reads_body() && o.status != OperationStatus::Queued);
        if !reading
            && let Some(op) = self.operations.get_mut(set_height)
            && op.status == OperationStatus::Queued
        {
            output.effects.push(op.effect());
            op.status = OperationStatus::Running;
        }
        true
    }
}
