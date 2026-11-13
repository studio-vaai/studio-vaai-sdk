//! The height the shopper enters, confirming it, and what the body's events
//! do to the flow.

use super::model::*;
use super::navigation::Screen;
use super::{DefaultController, Plan, Purpose};
use crate::domain::*;
use crate::error::Rejection;
use crate::ids::*;
use crate::values::*;

/// The height input.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum HeightAction {
    /// Changes the height input.
    Edit {
        /// The height in the input, finite and positive; nothing is written
        /// until it is confirmed.
        height: HeightCm,
    },
    /// Confirms the height: SetHeight starts and the try-on screen opens at
    /// once.
    Confirm,
}

/// Height editing and recovery. The domain owns the submitted height
/// while its write is pending.
#[derive(Clone, Debug, Default)]
pub(super) struct HeightEntry {
    /// Heights the backend could not calibrate for this photo.
    pub unusable: Vec<HeightCm>,
    failure: Option<HeightFailure>,
}

#[derive(Clone, Copy, Debug)]
struct HeightFailure {
    height: HeightCm,
    error: BackendError,
    deferred: bool,
}

impl HeightEntry {
    pub fn visible_issue(&self) -> Option<Issue> {
        self.failure
            .filter(|failure| !failure.deferred)
            .map(|failure| Issue::SetHeightFailed {
                error: failure.error,
            })
    }

    /// A failed input can be corrected. Otherwise seed from the body.
    pub fn seed(&self, snapshot: &DomainSnapshot) -> Option<HeightCm> {
        self.failure
            .map(|failure| failure.height)
            .or_else(|| {
                let body = snapshot.body.identity()?;
                Some(match snapshot.body.height() {
                    Some(
                        &HeightStatus::Acknowledged { height, .. }
                        | &HeightStatus::Pending { height, .. }
                        | &HeightStatus::Uncertain { height, .. },
                    ) => height,
                    Some(HeightStatus::Unset) | None => body.estimated_height,
                })
            })
            .map(|height| HeightCm(height.0.round().clamp(140.0, 220.0)))
    }
}

/// Whether `operation` is the body's outstanding SetHeight.
pub(super) fn sets_height(snapshot: &DomainSnapshot, operation: OperationId) -> bool {
    snapshot.body.height().and_then(HeightStatus::outstanding) == Some(operation)
}

impl DefaultController {
    pub(super) fn can_confirm_height(&self, snapshot: &DomainSnapshot) -> bool {
        let Screen::Height { draft: Some(draft) } = self.navigation.screen else {
            return false;
        };
        self.navigation.modal.is_none()
            && !self.height.unusable.contains(&draft)
            // A missing body, or none, takes no height.
            && snapshot.body.height().is_some_and(|status| match status {
                HeightStatus::Pending { height, .. } => *height == draft,
                HeightStatus::Uncertain { .. } => false,
                HeightStatus::Acknowledged { .. } | HeightStatus::Unset => true,
            })
    }

    pub(super) fn height_action(
        &mut self,
        action: HeightAction,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        self.unobstructed()?;
        let Screen::Height { draft } = &mut self.navigation.screen else {
            return Err(Rejection::HeightInputInactive);
        };
        match action {
            HeightAction::Edit { height } => {
                validate_height(height)?;
                if !(140.0..=220.0).contains(&height.0) || height.0.fract() != 0.0 {
                    return Err(Rejection::InvalidHeight);
                }
                *draft = Some(height);
            }
            HeightAction::Confirm => {
                let height = draft.ok_or(Rejection::HeightMissing)?;
                if self.height.unusable.contains(&height) {
                    return Err(Rejection::InvalidHeight);
                }
                plan.command(Purpose::SetHeight, BodyCommand::SetHeight { height });
            }
        }
        Ok(())
    }

    /// The flow's SetHeight was taken: the view moves on now, and dependent
    /// work waits for the write.
    pub(super) fn height_confirmed(
        &mut self,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        if matches!(snapshot.body_target(), Some(BodyTarget::Pending { .. })) {
            self.presentation.open_variant_picker();
        }
        self.enter(Screen::TryOn, plan);
        self.issue = None;
        self.height.failure = None;
        self.policy(snapshot, plan)
    }

    pub(super) fn body_event(
        &mut self,
        event: &BodyEvent,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        match event {
            BodyEvent::HeightSet { .. } => {
                self.height.failure = None;
                self.policy(snapshot, plan)?;
            }
            BodyEvent::SetHeightFailed { height, error, .. } => {
                if *error == BackendError::Unusable && !self.height.unusable.contains(height) {
                    self.height.unusable.push(*height);
                }
                self.presentation.followed_try_on_request = None;
                self.height.failure = Some(HeightFailure {
                    height: *height,
                    error: *error,
                    deferred: true,
                });
                self.apply_deferred_height_error(snapshot, plan);
            }
        }
        Ok(())
    }

    /// Shows a SetHeight failure that waited for the picker or new photo,
    /// once neither is open.
    pub(super) fn apply_deferred_height_error(
        &mut self,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) {
        if self.navigation.modal.is_none()
            && self.photo_change.is_none()
            && matches!(
                self.navigation.screen,
                Screen::Height { .. } | Screen::TryOn
            )
            && let Some(failure) = self
                .height
                .failure
                .as_mut()
                .filter(|failure| failure.deferred)
        {
            failure.deferred = false;
            if !matches!(self.navigation.screen, Screen::Height { .. }) {
                let screen = self.height_screen(snapshot);
                self.enter(screen, plan);
            }
        }
    }
}
