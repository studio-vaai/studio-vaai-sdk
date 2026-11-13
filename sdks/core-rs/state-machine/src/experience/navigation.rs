//! Where the flow is: its screen, with what only that screen keeps, any
//! modal over it, moving between screens, and going back.

use super::camera::CameraState;
use super::photo::{PhotoChangeOrigin, PickerEffect};
use super::{DefaultController, Plan};
use crate::domain::*;
use crate::error::Rejection;
use crate::ids::*;
use crate::values::*;

/// An overlay over the current screen.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Modal {
    /// The photo library picker is open.
    Picker {
        /// The picker's interaction token; only its completion closes it.
        token: InteractionToken,
    },
    /// Lets the shopper choose a source for a different photo.
    ChoosePhotoSource,
}

/// Going back, or closing a modal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum NavigationAction {
    /// Returns to the preceding step in the current journey.
    Back,
    /// Closes the picker or the photo-source chooser.
    CancelModal,
}

/// Where the flow is: its screen and any modal over it.
#[derive(Clone, Debug)]
pub(super) struct Navigation {
    /// The current screen, with what only it keeps.
    pub screen: Screen,
    /// The picker or photo-source chooser over the screen, if any.
    pub modal: Option<Modal>,
}

impl Navigation {
    /// The camera, while the camera screen shows.
    pub fn camera(&mut self) -> Option<&mut CameraState> {
        match &mut self.screen {
            Screen::Camera { camera } => Some(camera),
            _ => None,
        }
    }

    /// Whether the try-on screen shows.
    pub fn on_try_on(&self) -> bool {
        matches!(self.screen, Screen::TryOn)
    }
}

/// A screen, with what only it keeps: leaving it drops that.
#[derive(Clone, Debug)]
pub(super) enum Screen {
    /// Consent and the choice of photo source.
    Introduction,
    /// The live camera.
    Camera {
        /// The camera's state.
        camera: CameraState,
    },
    /// The height input.
    Height {
        /// The height in the input; nothing is written until it is
        /// confirmed.
        draft: Option<HeightCm>,
    },
    /// Variant selection and try-ons.
    TryOn,
    /// The photo the backend rejected, which the flow retains until the
    /// shopper leaves.
    PhotoRejected {
        /// The rejected photo.
        photo: Photo,
        /// Why the backend rejected it.
        reason: PhotoRejection,
    },
}

impl Screen {
    /// The photo change a screen starts, which cancelling returns to; the
    /// camera and a rejected photo are only reached through a change.
    pub fn origin(&self) -> Option<PhotoChangeOrigin> {
        match self {
            Self::Introduction => Some(PhotoChangeOrigin::Introduction),
            Self::Height { .. } => Some(PhotoChangeOrigin::Height),
            Self::TryOn => Some(PhotoChangeOrigin::TryOn),
            Self::Camera { .. } | Self::PhotoRejected { .. } => None,
        }
    }
}

impl DefaultController {
    pub(super) fn can_go_back(&self, snapshot: &DomainSnapshot) -> bool {
        self.presence.active()
            && (self.navigation.modal.is_some()
                || (!self.photo_processing(snapshot)
                    && (self.photo_change.is_some()
                        || !matches!(self.navigation.screen, Screen::Introduction))))
    }

    pub(super) fn photo_processing(&self, snapshot: &DomainSnapshot) -> bool {
        self.new_photo()
            .and_then(|photo| photo.operation())
            .is_some_and(|operation| !snapshot.uncertain_operations.contains(&operation))
    }

    pub(super) fn navigation_action(
        &mut self,
        action: NavigationAction,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        self.visible()?;
        match action {
            NavigationAction::Back if self.navigation.modal.is_none() => {
                if self.photo_processing(snapshot) {
                    return Err(Rejection::PhotoProcessing);
                }
                self.back(snapshot, plan)?
            }
            NavigationAction::Back | NavigationAction::CancelModal => {
                self.dismiss_modal(plan);
                self.modal_closed(snapshot, plan)?;
            }
        }
        Ok(())
    }

    /// Moves to `screen`. The screen left drops what only it kept: its
    /// camera is released, and so is its rejected photo.
    pub(super) fn enter(&mut self, screen: Screen, plan: &mut Plan) {
        if !matches!(screen, Screen::TryOn) {
            self.presentation.dismiss_variant_picker();
        }
        match std::mem::replace(&mut self.navigation.screen, screen) {
            Screen::Camera { mut camera } => camera.stop(&mut plan.effects),
            Screen::PhotoRejected { photo, .. } => {
                plan.effect(MediaEffect::Release { media: photo.media })
            }
            Screen::Introduction | Screen::Height { .. } | Screen::TryOn => {}
        }
    }

    /// The height screen, starting from the height the shopper last
    /// confirmed, else the body's.
    pub(super) fn height_screen(&self, snapshot: &DomainSnapshot) -> Screen {
        Screen::Height {
            draft: self.height.seed(snapshot),
        }
    }

    /// Closes the modal, dismissing an open picker.
    pub(super) fn dismiss_modal(&mut self, plan: &mut Plan) {
        if let Some(Modal::Picker { token }) = self.navigation.modal.take() {
            plan.effect(PickerEffect::Dismiss { token });
        }
    }

    /// What follows a modal closing without a photo: a photo change with
    /// nothing left to cancel ends, a deferred height error shows, and on a
    /// try-on screen free again the policies run.
    pub(super) fn modal_closed(
        &mut self,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        self.settle_change();
        self.apply_deferred_height_error(snapshot, plan);
        self.present_completed_result(snapshot, plan);
        self.resume_camera(snapshot, plan)?;
        self.send_photo(snapshot, plan);
        self.policy(snapshot, plan)
    }

    fn back(&mut self, snapshot: &DomainSnapshot, plan: &mut Plan) -> Result<(), Rejection> {
        if self.photo_change.is_some() {
            return self.cancel_change(snapshot, plan);
        }
        match &self.navigation.screen {
            Screen::TryOn if self.presentation.mode == super::PresentationMode::Result => {
                self.presentation.open_variant_picker();
            }
            Screen::TryOn
                if self.presentation.mode == super::PresentationMode::Selection
                    && self.foreground_pending(snapshot) =>
            {
                self.back_to_selection(snapshot, plan);
            }
            Screen::TryOn => {
                self.detach(snapshot, plan);
                self.enter(self.height_screen(snapshot), plan);
                self.issue = None;
                self.apply_deferred_height_error(snapshot, plan);
            }
            Screen::Height { .. }
                if snapshot
                    .photo
                    .is_some_and(|photo| photo.source == PhotoSource::Camera) =>
            {
                self.choose_photo_source(snapshot)?;
            }
            Screen::Height { .. } => {
                self.enter(Screen::Introduction, plan);
                self.issue = None;
            }
            Screen::Camera { .. } | Screen::PhotoRejected { .. } | Screen::Introduction => {}
        }
        Ok(())
    }
}
