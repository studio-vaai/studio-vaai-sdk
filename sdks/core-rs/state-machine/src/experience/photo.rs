//! A change of photo: choosing its source, the library picker, holding the
//! picked or captured photo as the new photo, sending it, cancelling the
//! change, and what the domain's photo events do to the flow. The flow
//! holds its own interest in the new photo.

use super::camera::CameraState;
use super::model::*;
use super::navigation::{Modal, Screen};
use super::{DefaultController, Plan, Purpose};
use crate::domain::*;
use crate::error::Rejection;
use crate::ids::*;
use crate::values::HeightCm;

/// A change of photo, from the shopper leaving for a new photo until it is
/// committed or the change is cancelled.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PhotoChange {
    /// The screen the change started from, which cancelling it returns to.
    pub origin: PhotoChangeOrigin,
    /// Unsubmitted height to restore if the shopper keeps the original photo.
    pub height_draft: Option<HeightCm>,
    /// The new photo, once the shopper picked or took one.
    pub new_photo: Option<NewPhoto>,
}

/// The screen a photo change started from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PhotoChangeOrigin {
    /// The introduction, before the body's first photo.
    Introduction,
    /// The height input.
    Height,
    /// The try-on screen.
    TryOn,
}

/// A new photo: picked or taken, then processed, to become the body's
/// photo, whether there is a body yet or not.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct NewPhoto {
    /// The photo, which the flow retains.
    pub photo: Photo,
    /// Whether it waits or is being processed.
    pub status: NewPhotoStatus,
}

/// Where a new photo stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum NewPhotoStatus {
    /// Staged, waiting for a ready session or foreground.
    Staged,
    /// Processing finished unsuccessfully. Keep the reason with this photo.
    Failed { error: BackendError },
    /// Being processed.
    Processing {
        /// The processing operation.
        operation: OperationId,
    },
}

/// Taking, replacing and sending a photo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PhotoAction {
    /// Starts taking a photo.
    BeginSource {
        /// Where the photo comes from: the library opens a picker, the
        /// camera its own screen.
        source: PhotoSource,
    },
    /// Opens the photo-source chooser.
    Replace,
    /// Sends the staged photo again after a retryable failure.
    Retry,
    /// Returns to the introduction's photo guidance, dropping the new
    /// photo; the photo change goes on.
    ShowGuide,
}

/// What the host's photo library picker does for the flow.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PickerEffect {
    /// Open the picker; on the web, within the shopper's gesture.
    Open {
        /// The picker's token, to report its outcome with.
        token: InteractionToken,
    },
    /// Close the picker.
    Dismiss {
        /// The picker to close.
        token: InteractionToken,
    },
}

/// How the picker ended.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PickerEvent {
    /// The shopper picked a photo.
    Selected {
        /// The token of the `Open` effect.
        token: InteractionToken,
        /// The picked photo, registered by the host.
        media: MediaId,
    },
    /// The shopper closed the picker without a photo.
    Cancelled {
        /// The token of the `Open` effect.
        token: InteractionToken,
    },
    /// The picker failed.
    Failed {
        /// The token of the `Open` effect.
        token: InteractionToken,
        /// Why.
        error: DeviceError,
    },
}

impl NewPhoto {
    /// The operation processing it, while one runs.
    pub(super) fn operation(&self) -> Option<OperationId> {
        match self.status {
            NewPhotoStatus::Processing { operation } => Some(operation),
            NewPhotoStatus::Staged | NewPhotoStatus::Failed { .. } => None,
        }
    }
}

impl DefaultController {
    pub(super) fn photo_action(
        &mut self,
        action: PhotoAction,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        match action {
            PhotoAction::BeginSource { source } => {
                if self.navigation.modal == Some(Modal::ChoosePhotoSource) {
                    self.dismiss_modal(plan);
                }
                self.start_source(source, snapshot, plan)?;
            }
            PhotoAction::Replace => {
                self.unobstructed()?;
                if self.new_photo().is_some() {
                    if self.photo_processing(snapshot) {
                        return Err(Rejection::PhotoProcessing);
                    }
                    self.cancel_change(snapshot, plan)?;
                }
                self.choose_photo_source(snapshot)?;
            }
            PhotoAction::Retry => {
                self.unobstructed()?;
                let new_photo = self.new_photo().ok_or(Rejection::NoNewPhoto)?;
                if new_photo.operation().is_some() {
                    return Err(Rejection::PhotoProcessing);
                }
                if !super::journey::can_retry_photo(new_photo.status) {
                    return Err(Rejection::PhotoRetryUnavailable);
                }
                let photo = new_photo.photo;
                plan.command(Purpose::ProcessPhoto, PhotoCommand::Process { photo });
            }
            PhotoAction::ShowGuide => {
                self.visible()?;
                self.begin_change();
                self.drop_new_photo(plan, true);
                self.dismiss_modal(plan);
                self.enter(Screen::Introduction, plan);
            }
        }
        Ok(())
    }

    pub(super) fn choose_photo_source(
        &mut self,
        snapshot: &DomainSnapshot,
    ) -> Result<(), Rejection> {
        self.unobstructed()?;
        if !self.consented(snapshot)
            || !matches!(
                self.navigation.screen,
                Screen::Introduction
                    | Screen::Height { .. }
                    | Screen::TryOn
                    | Screen::PhotoRejected { .. }
            )
        {
            return Err(Rejection::PhotoReplacementUnavailable);
        }
        self.navigation.modal = Some(Modal::ChoosePhotoSource);
        Ok(())
    }

    pub(super) fn picker_event(
        &mut self,
        event: PickerEvent,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        match event {
            PickerEvent::Selected { token, media } => {
                if self.presence.open && self.navigation.modal == Some(Modal::Picker { token }) {
                    self.navigation.modal = None;
                    self.stage_photo(media, PhotoSource::Library, snapshot, plan);
                } else {
                    plan.effect(MediaEffect::Release { media });
                }
            }
            PickerEvent::Cancelled { token } => {
                if self.navigation.modal == Some(Modal::Picker { token }) {
                    self.navigation.modal = None;
                    plan.event(DeviceRecoveryEvent::PickerCancelled);
                    self.modal_closed(snapshot, plan)?;
                }
            }
            PickerEvent::Failed { token, error } => {
                if self.navigation.modal == Some(Modal::Picker { token }) {
                    self.navigation.modal = None;
                    self.issue = Some(Issue::PickerFailed { error });
                    plan.event(DeviceRecoveryEvent::PickerFailed { error });
                    self.modal_closed(snapshot, plan)?;
                }
            }
        }
        Ok(())
    }

    pub(super) fn photo_event(
        &mut self,
        event: &PhotoEvent,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) {
        match event {
            PhotoEvent::Committed { .. } => {
                self.end_change(plan, false);
                self.dismiss_modal(plan);
                // A new body: its height screen starts from its estimate.
                self.forget_body();
                let screen = self.height_screen(snapshot);
                self.enter(screen, plan);
            }
            PhotoEvent::Rejected {
                operation, reason, ..
            } => {
                if let Some(change) = &mut self.photo_change
                    && let Some(new_photo) = change
                        .new_photo
                        .take_if(|p| p.operation() == Some(*operation))
                {
                    // The rejected screen holds the photo from now on.
                    let screen = Screen::PhotoRejected {
                        photo: new_photo.photo,
                        reason: *reason,
                    };
                    self.enter(screen, plan);
                    self.issue = None;
                }
            }
            PhotoEvent::Failed {
                operation, error, ..
            } => {
                if let Some(change) = &mut self.photo_change
                    && let Some(new_photo) = &mut change.new_photo
                    && new_photo.operation() == Some(*operation)
                {
                    new_photo.status = NewPhotoStatus::Failed { error: *error };
                }
            }
        }
    }

    /// The new photo, if the shopper picked or took one.
    pub(super) fn new_photo(&self) -> Option<&NewPhoto> {
        self.photo_change.as_ref()?.new_photo.as_ref()
    }

    /// Whether `operation` processes the new photo.
    pub(super) fn processes_new_photo(&self, operation: OperationId) -> bool {
        self.new_photo()
            .is_some_and(|p| p.operation() == Some(operation))
    }

    /// Starts a photo change from the current screen, unless one is under
    /// way.
    pub(super) fn begin_change(&mut self) {
        if self.photo_change.is_none()
            && let Some(origin) = self.navigation.screen.origin()
        {
            let height_draft = match self.navigation.screen {
                Screen::Height { draft } => draft,
                _ => None,
            };
            self.photo_change = Some(PhotoChange {
                origin,
                height_draft,
                new_photo: None,
            });
        }
    }

    /// Opens the photo source within the photo change: the library's
    /// picker, or the camera's screen, whose camera waits for the session
    /// if it is not ready yet. Creates the session if there is none.
    pub(super) fn start_source(
        &mut self,
        source: PhotoSource,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        self.unobstructed()?;
        if !self.consented(snapshot) {
            self.issue = Some(Issue::ConsentRequired);
            return Ok(());
        }
        if !matches!(
            snapshot.session,
            SessionPhase::Ready | SessionPhase::Creating
        ) {
            self.create_session(plan)?;
        }
        self.issue = None;
        self.begin_change();
        match source {
            PhotoSource::Library => {
                if let Some(camera) = self.navigation.camera() {
                    camera.stop(&mut plan.effects);
                }
                let token = self.token()?;
                self.navigation.modal = Some(Modal::Picker { token });
                plan.effect(PickerEffect::Open { token });
            }
            PhotoSource::Camera => {
                let camera = Screen::Camera {
                    camera: CameraState::Dormant,
                };
                self.enter(camera, plan);
                self.resume_camera(snapshot, plan)?;
            }
        }
        Ok(())
    }

    /// Holds a picked or captured photo as the photo change's new photo
    /// and, once the session is ready, sends it for processing.
    pub(super) fn stage_photo(
        &mut self,
        media: MediaId,
        source: PhotoSource,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) {
        self.drop_new_photo(plan, true);
        let Some(change) = &mut self.photo_change else {
            // A source is only opened within a change: without one, the
            // photo is stale.
            plan.effect(MediaEffect::Release { media });
            return;
        };
        change.new_photo = Some(NewPhoto {
            photo: Photo { media, source },
            status: NewPhotoStatus::Staged,
        });
        plan.effect(MediaEffect::Retain { media });
        if let Some(camera) = self.navigation.camera() {
            camera.stop(&mut plan.effects);
        }
        self.issue = None;
        if source == PhotoSource::Library
            && matches!(
                self.navigation.screen,
                Screen::Camera { .. } | Screen::PhotoRejected { .. }
            )
        {
            self.enter(Screen::Introduction, plan);
        }
        self.send_photo(snapshot, plan);
    }

    /// Sends the staged new photo for processing, once the session is
    /// ready.
    pub(super) fn send_photo(&self, snapshot: &DomainSnapshot, plan: &mut Plan) {
        if (self.presence.foreground || !self.presence.open)
            && snapshot.session == SessionPhase::Ready
            && self.navigation.modal.is_none()
            && let Some(new_photo) = self.new_photo()
            && new_photo.status == NewPhotoStatus::Staged
        {
            plan.command(
                Purpose::ProcessPhoto,
                PhotoCommand::Process {
                    photo: new_photo.photo,
                },
            );
        }
    }

    /// Cancels the photo change: drops the new photo, cancelling its
    /// processing, and returns to the screen the change started from, where
    /// the policies run again.
    pub(super) fn cancel_change(
        &mut self,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        let change = self.photo_change.as_ref().ok_or(Rejection::NoPhotoChange)?;
        let (origin, height_draft) = (change.origin, change.height_draft);
        self.end_change(plan, true);
        self.dismiss_modal(plan);
        let screen = match origin {
            PhotoChangeOrigin::Introduction => Screen::Introduction,
            PhotoChangeOrigin::Height => Screen::Height {
                draft: height_draft,
            },
            PhotoChangeOrigin::TryOn => Screen::TryOn,
        };
        self.enter(screen, plan);
        self.issue = None;
        self.apply_deferred_height_error(snapshot, plan);
        self.present_completed_result(snapshot, plan);
        self.policy(snapshot, plan)
    }

    /// Ends a photo change with nothing left to cancel: no new photo and no
    /// modal, back on the screen it started from.
    pub(super) fn settle_change(&mut self) {
        if self.navigation.modal.is_none()
            && let Some(change) = &self.photo_change
            && change.new_photo.is_none()
            && self.navigation.screen.origin() == Some(change.origin)
        {
            self.photo_change = None;
        }
    }

    /// Ends the photo change, dropping its new photo, and cancelling its
    /// processing if `cancel`.
    pub(super) fn end_change(&mut self, plan: &mut Plan, cancel: bool) {
        self.drop_new_photo(plan, cancel);
        self.photo_change = None;
    }

    /// Drops the new photo and the flow's interest in it, cancelling its
    /// processing if `cancel`; the photo change goes on.
    pub(super) fn drop_new_photo(&mut self, plan: &mut Plan, cancel: bool) {
        if let Some(new_photo) = self.photo_change.as_mut().and_then(|c| c.new_photo.take()) {
            if cancel && let Some(operation) = new_photo.operation() {
                plan.command(Purpose::Other, PhotoCommand::Cancel { operation });
            }
            plan.effect(MediaEffect::Release {
                media: new_photo.photo.media,
            });
        }
    }
}
