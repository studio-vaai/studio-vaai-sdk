//! Consent and the session, as the flow shows them: the introduction's
//! consent, which the flow keeps and attests when it creates the session,
//! retrying a failed session, and what the session's events do to the
//! flow.

use super::model::*;
use super::navigation::Screen;
use super::presentation::AutoStart;
use super::{DefaultController, Plan, Purpose};
use crate::domain::*;
use crate::error::Rejection;

/// Consent and the session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SessionAction {
    /// Accepts or declines consent on the introduction.
    SetConsent {
        /// Whether the shopper consents; declining drops the new photo and
        /// a session being created. The checkbox is unavailable after session creation.
        accepted: bool,
    },
    /// Restores the stored session again after restoring it failed. A
    /// failed creation needs no action: choosing a photo source creates the
    /// session again.
    Retry,
}

impl DefaultController {
    pub(super) fn session_action(
        &mut self,
        action: SessionAction,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        self.visible()?;
        match action {
            SessionAction::SetConsent { accepted } => {
                if !matches!(self.navigation.screen, Screen::Introduction)
                    || snapshot.session == SessionPhase::Ready
                {
                    return Err(Rejection::ConsentFormInactive);
                }
                if !accepted {
                    self.dismiss_modal(plan);
                    self.end_change(plan, true);
                    if snapshot.session == SessionPhase::Creating {
                        plan.command(Purpose::Other, SessionCommand::Reset);
                    }
                }
                self.consent_given = accepted;
                self.issue
                    .take_if(|issue| matches!(issue, Issue::ConsentRequired));
            }
            SessionAction::Retry => {
                plan.command(Purpose::Other, SessionCommand::Retry);
                self.issue
                    .take_if(|i| matches!(i, Issue::SessionFailed { .. }));
            }
        }
        Ok(())
    }

    pub(super) fn session_event(
        &mut self,
        event: &SessionEvent,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        match event {
            SessionEvent::Ready => {
                if self.photo_change.is_none()
                    && matches!(self.navigation.screen, Screen::Introduction)
                {
                    self.adopt_existing(snapshot);
                }
                self.resume_camera(snapshot, plan)?;
                self.send_photo(snapshot, plan);
                self.policy(snapshot, plan)?;
            }
            SessionEvent::ConsentGranted => {}
            SessionEvent::Failed { error } => {
                self.end_change(plan, true);
                self.dismiss_modal(plan);
                self.enter(Screen::Introduction, plan);
                self.issue = Some(Issue::SessionFailed { error: *error });
            }
            SessionEvent::Expired => {
                self.issue = Some(Issue::SessionExpired);
            }
            SessionEvent::Invalidated => {
                self.dismiss_modal(plan);
                self.end_change(plan, false);
                if snapshot.session == SessionPhase::Disposed {
                    self.presence.disposed = true;
                }
                self.forget_body();
                self.enter(Screen::Introduction, plan);
                self.presentation.auto_start = AutoStart::Disarmed;
                self.consent_given = false;
            }
        }
        Ok(())
    }

    /// Whether the shopper consented: on this flow's introduction, or by
    /// the session there is or is being created, which implies it.
    pub(super) fn consented(&self, snapshot: &DomainSnapshot) -> bool {
        self.consent_given
            || matches!(
                snapshot.session,
                SessionPhase::Creating | SessionPhase::Ready
            )
    }

    /// Creates the session with the consent the shopper gave this flow;
    /// refused without it.
    pub(super) fn create_session(&self, plan: &mut Plan) -> Result<(), Rejection> {
        if !self.consent_given {
            return Err(Rejection::ConsentRequired);
        }
        plan.command(
            Purpose::Other,
            SessionCommand::Create {
                data_processing_consent: DataProcessingConsent::Granted,
            },
        );
        Ok(())
    }
}
