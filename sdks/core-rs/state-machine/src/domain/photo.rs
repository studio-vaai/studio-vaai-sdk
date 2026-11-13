//! The shopper's photos: the committed one a body was created from, and the
//! one being processed to replace it. Bytes stay in the host's media
//! registry; only a photo's `MediaId` crosses into the state machine, and
//! each owner retains and releases its own interest in it.

use super::engine::DomainEngine;
use super::model::{BackendError, DomainEffect, DomainOutput, Job};
use crate::error::Rejection;
use crate::ids::*;
use crate::values::*;

/// A photo in the host's media registry, and where it came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct Photo {
    /// The photo, in the host's media registry.
    pub media: MediaId,
    /// Whether it came from the library or the camera, which decides how
    /// the experience offers to replace it.
    pub source: PhotoSource,
}

/// Where a photo came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PhotoSource {
    /// Picked from the device's photo library.
    Library,
    /// Taken with the camera in the experience.
    Camera,
}

/// Why the backend cannot create a body from a photo, as the API's
/// `BodyValidationCode` says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PhotoRejection {
    /// No person is in the photo.
    NoHumanDetected,
    /// The person is partly hidden.
    HumanOccluded,
    /// The person is not standing.
    HumanNotStanding,
    /// The person is too small in the photo.
    HumanTooSmall,
    /// The person's clothing is inappropriate.
    InappropriateClothing,
}

/// What a client asks of the photos.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PhotoCommand {
    /// Sends a photo to replace the body; the old body stays until the new
    /// one is accepted.
    Process {
        /// The photo to process; the domain retains it, and commits it if
        /// accepted.
        photo: Photo,
    },
    /// Abandons the photo being processed.
    Cancel {
        /// The operation processing it; its eventual completion only
        /// cleans up.
        operation: OperationId,
    },
}

/// What the host does with a photo.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PhotoJob {
    /// Upload and process the photo, holding the adapter's own lease on its
    /// media meanwhile; report `Accepted`, `Rejected` or a failure.
    Process {
        /// The photo to upload.
        photo: Photo,
    },
}

/// How a photo job ended.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PhotoOutcome {
    /// The photo is usable: it becomes the body.
    Accepted {
        /// The new body's identifier; never the current body's.
        body_id: BodyId,
        /// The height estimated from the photo.
        estimated_height: HeightCm,
    },
    /// The photo is unusable, such as not showing the whole body.
    Rejected {
        /// Why the photo is unusable.
        reason: PhotoRejection,
    },
}

/// What the host's media registry does for one owner of a photo: the
/// domain, or a flow. One owner's release never revokes another's interest.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum MediaEffect {
    /// Take the owner's interest in a photo.
    Retain {
        /// The photo the owner now holds an interest in.
        media: MediaId,
    },
    /// Release the owner's interest only, not an adapter's own lease.
    Release {
        /// The photo the owner no longer needs.
        media: MediaId,
    },
}

/// What happened to a photo.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PhotoEvent {
    /// A photo was accepted and is now the body.
    Committed {
        /// The photo operation that was accepted.
        operation: OperationId,
        /// The new body.
        body_id: BodyId,
        /// The committed photo, including its source for storage.
        photo: Photo,
    },
    /// A photo was rejected.
    Rejected {
        /// The photo operation.
        operation: OperationId,
        photo: Photo,
        /// Why the photo is unusable; the old body stays.
        reason: PhotoRejection,
    },
    /// Processing a photo failed.
    Failed {
        /// The photo operation.
        operation: OperationId,
        photo: Photo,
        /// What the backend reported; the photo can be retried.
        error: BackendError,
    },
}

/// The committed photo and the one being processed to replace it.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Photos {
    /// The photo the current body was created from, once one was accepted.
    pub committed: Option<Photo>,
    /// The operation processing a photo to replace it, if any; one at a
    /// time. Its job holds the photo, and `Cancel` takes the operation.
    pub processing: Option<OperationId>,
}

impl Photos {
    pub fn new() -> Self {
        Self {
            committed: None,
            processing: None,
        }
    }

    /// Whether `media` is the committed photo.
    pub fn shows(&self, media: MediaId) -> bool {
        self.committed.is_some_and(|p| p.media == media)
    }

    /// Whether `operation` processes the photo being processed, rather
    /// than one abandoned since.
    pub fn processes(&self, operation: OperationId) -> bool {
        self.processing == Some(operation)
    }

    /// Commits an accepted photo; returns the replaced one.
    pub fn commit(&mut self, photo: Photo) -> Option<Photo> {
        self.processing = None;
        self.committed.replace(photo)
    }

    /// Forgets the committed photo and the one being processed, for a
    /// reset; returns the committed one.
    pub fn end(&mut self) -> Option<Photo> {
        self.processing = None;
        self.committed.take()
    }
}

impl Job {
    /// The photo the job holds, if it processes one.
    pub(super) fn media(&self) -> Option<MediaId> {
        match self {
            Job::Photo {
                job: PhotoJob::Process { photo },
            } => Some(photo.media),
            _ => None,
        }
    }
}

impl DomainEngine {
    pub(super) fn photo_command(
        &mut self,
        command: PhotoCommand,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        match command {
            PhotoCommand::Process { photo } => {
                self.session.ready()?;
                if self.photos.processing.is_some() {
                    return Err(Rejection::PhotoProcessing);
                }
                output
                    .effects
                    .push(MediaEffect::Retain { media: photo.media }.into());
                let operation = self.start(PhotoJob::Process { photo }, false, output)?;
                self.photos.processing = Some(operation);
                output.receipt.operation = Some(operation);
            }
            PhotoCommand::Cancel { operation } => {
                if !self.photos.processes(operation) {
                    return Ok(());
                }
                // Its media stays retained until an authoritative terminal
                // completion, which then only cleans up.
                self.photos.processing = None;
                if let Some(op) = self.operations.get(operation) {
                    output.effects.push(DomainEffect::Cancel { operation });
                    if op.status == super::operation::OperationStatus::Uncertain
                        && let Job::Photo { job } = &op.job
                    {
                        let job = job.clone();
                        self.operations.remove(operation);
                        self.photo_failed(operation, job, BackendError::Unavailable, output);
                    }
                }
            }
        }
        Ok(())
    }

    pub(super) fn photo_ended(
        &mut self,
        operation: OperationId,
        job: PhotoJob,
        outcome: PhotoOutcome,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        let PhotoJob::Process { photo } = job;
        if !self.photos.processes(operation) {
            self.release_if_unused(photo.media, output);
            return Ok(());
        }
        match outcome {
            PhotoOutcome::Accepted {
                body_id,
                estimated_height,
            } => {
                super::body::validate_height(estimated_height)?;
                // The new body outdates everything that read or wrote the
                // old one.
                self.retire(
                    |job| job.reads_body() || matches!(job, Job::Body { .. }),
                    output,
                );
                self.body.commit(body_id, estimated_height)?;
                let replaced = self.photos.commit(photo);
                self.size_recommendation = None;
                self.size_recommendation_error = None;
                self.requests.clear();
                if let Some(replaced) = replaced {
                    self.release_if_unused(replaced.media, output);
                }
                output.effects.push(DomainEffect::PersistBody {
                    body_id,
                    source: photo.source,
                });
                output.events.push(
                    PhotoEvent::Committed {
                        operation,
                        body_id,
                        photo,
                    }
                    .into(),
                );
            }
            PhotoOutcome::Rejected { reason } => {
                self.photos.processing = None;
                self.release_if_unused(photo.media, output);
                output.events.push(
                    PhotoEvent::Rejected {
                        operation,
                        photo,
                        reason,
                    }
                    .into(),
                );
            }
        }
        Ok(())
    }

    pub(super) fn photo_failed(
        &mut self,
        operation: OperationId,
        job: PhotoJob,
        error: BackendError,
        output: &mut DomainOutput,
    ) {
        let PhotoJob::Process { photo } = job;
        let processing = self.photos.processes(operation);
        if processing {
            self.photos.processing = None;
        }
        self.release_if_unused(photo.media, output);
        if processing {
            output.events.push(
                PhotoEvent::Failed {
                    operation,
                    photo,
                    error,
                }
                .into(),
            );
        }
    }

    /// Releases the domain's interest in a photo nothing holds any more.
    fn release_if_unused(&self, media: MediaId, output: &mut DomainOutput) {
        if !self.photos.shows(media)
            && !self.operations.iter().any(|o| o.job.media() == Some(media))
        {
            output.effects.push(MediaEffect::Release { media }.into());
        }
    }
}
