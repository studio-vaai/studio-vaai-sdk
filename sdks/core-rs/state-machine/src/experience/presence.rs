//! Whether the flow is shown, in the foreground and alive: opening,
//! closing, suspending, resuming and disposing it.

use super::navigation::Screen;
use super::presentation::AutoStart;
use super::{DefaultController, Plan};
use crate::domain::*;
use crate::error::Rejection;

/// Whether the flow is shown and active.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct Presence {
    /// Whether the experience is shown.
    pub open: bool,
    /// Whether the app is in the foreground rather than suspended.
    pub foreground: bool,
    /// Whether the flow was disposed; it then only releases late device
    /// completions.
    pub disposed: bool,
}

impl Presence {
    /// Whether the flow is shown, in the foreground and not disposed.
    pub fn active(&self) -> bool {
        self.open && self.foreground && !self.disposed
    }
}

/// Showing, hiding, suspending or disposing the flow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PresenceAction {
    /// Shows the experience.
    Open,
    /// Hides it and releases the camera; the new photo and try-ons the
    /// shopper asked for continue.
    Close,
    /// The app went to the background: releases the camera, keeps the
    /// screen and the new photo.
    Suspend,
    /// The app came back: reopens the camera on its screen.
    Resume,
    /// Ends the flow for good, cancelling its request if it still waits.
    Dispose,
}

impl DefaultController {
    pub(super) fn open_with_entry(
        &mut self,
        entry: super::JourneyEntry,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        if self.presence.open {
            return Ok(());
        }
        if !self.product_available() {
            return Err(Rejection::NoProductShown);
        }
        self.journey.opening = Some(entry);
        self.dialog = Some(self.token()?);
        self.presence.open = true;
        self.resume_camera(snapshot, plan)?;
        self.send_photo(snapshot, plan);
        self.apply_deferred_height_error(snapshot, plan);
        self.present_completed_result(snapshot, plan);
        self.policy(snapshot, plan)
    }

    pub(super) fn presence_action(
        &mut self,
        action: PresenceAction,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        match action {
            PresenceAction::Open => {
                self.open_with_entry(super::JourneyEntry::default(), snapshot, plan)?
            }
            PresenceAction::Close | PresenceAction::Suspend | PresenceAction::Dispose => {
                if action == PresenceAction::Close && !self.presence.open {
                    return Ok(());
                }
                let closing = matches!(action, PresenceAction::Close | PresenceAction::Dispose);
                let disposing = action == PresenceAction::Dispose;
                if let Some(camera) = self.navigation.camera() {
                    camera.stop(&mut plan.effects);
                }
                // The native picker may take the tab into the background.
                // Keep its token until selection, cancellation, or explicit close.
                if closing {
                    self.dismiss_modal(plan);
                    self.settle_change();
                    self.apply_deferred_height_error(snapshot, plan);
                    self.present_completed_result(snapshot, plan);
                }
                if closing && self.presence.open {
                    self.presentation.auto_start = AutoStart::Disarmed;
                }
                if closing {
                    self.presence.open = false;
                    self.dialog = None;
                    self.cart.failed = None;
                    self.presentation.dismiss_variant_picker();
                } else {
                    self.presence.foreground = false;
                }
                // Close keeps the new photo and a try-on the shopper asked
                // for; disposing cancels the followed request if it still
                // waits, the only one the flow can have waiting, drops the
                // photo change and leaves the screen, releasing what it
                // held.
                if disposing {
                    self.detach(snapshot, plan);
                    self.end_change(plan, true);
                    self.enter(Screen::Introduction, plan);
                    self.presence.disposed = true;
                }
            }
            PresenceAction::Resume => {
                self.presence.foreground = true;
                self.apply_deferred_height_error(snapshot, plan);
                self.resume_camera(snapshot, plan)?;
                self.send_photo(snapshot, plan);
                self.present_completed_result(snapshot, plan);
                self.policy(snapshot, plan)?;
            }
        }
        Ok(())
    }
}
