//! The camera's small interaction machine and its self-timer. Device leases
//! stay the host's.

use super::model::*;
use super::{DefaultController, Plan};
use crate::domain::*;
use crate::error::Rejection;
use crate::ids::*;
use crate::values::*;

/// How long the self-timer counts down.
const SELF_TIMER_MS: u64 = 10_000;

/// What the renderer can do with the leased stream.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum CameraPreview {
    Waiting,
    Ready,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct CameraDevices {
    pub selected: Option<String>,
    pub available: Vec<String>,
}

impl CameraDevices {
    fn next(&self) -> Option<&str> {
        let current = self.selected.as_deref();
        let next = self
            .available
            .iter()
            .skip_while(|id| Some(id.as_str()) != current)
            .nth(1)
            .or_else(|| self.available.first())?;
        (Some(next.as_str()) != current && self.available.len() > 1).then_some(next.as_str())
    }
}

/// The camera, as far as the experience knows: device leases stay the host's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum CameraState {
    /// No camera in use; on the camera screen, it opens as soon as the
    /// flow is active, the session ready and no new photo is pending.
    Dormant,
    /// Waiting for the host to open the camera.
    Acquiring {
        /// The acquisition's token; only `Acquired` with it makes the camera
        /// live.
        token: InteractionToken,
    },
    /// Showing the live stream.
    Live {
        /// The host's lease on the live stream.
        lease: LeaseId,
        preview: CameraPreview,
    },
    /// The self-timer is running.
    Countdown {
        /// The live stream's lease.
        lease: LeaseId,
        /// The self-timer's token.
        token: InteractionToken,
        /// When the timer captures, on the monotonic clock.
        deadline: MonotonicMillis,
    },
    /// Waiting for the captured frame.
    Capturing {
        /// The stream being captured from.
        lease: LeaseId,
        preview: CameraPreview,
        /// The capture's token; only its frame becomes the new photo.
        token: InteractionToken,
    },
    /// The camera cannot be used.
    Unavailable {
        /// Why.
        error: DeviceError,
    },
}

/// The live camera and its self-timer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum CameraAction {
    /// Tries to open the camera again, once it was unavailable.
    Retry,
    /// Switches the live camera between front and back.
    Switch,
    /// Starts the self-timer.
    StartSelfTimer {
        /// The current time on a monotonic clock, never wall-clock time; the
        /// timer captures 10 seconds later.
        now: MonotonicMillis,
    },
    /// Stops the self-timer; the camera stays live.
    CancelSelfTimer,
}

/// What the host's camera does for the flow.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum CameraEffect {
    /// Open the camera.
    Acquire {
        /// The acquisition's token, to report its outcome with.
        token: InteractionToken,
        /// Preferred browser device. Use the default when it is no longer available.
        device_id: Option<String>,
    },
    /// Stop tracking an acquisition and release any stream it obtained.
    CancelAcquire { token: InteractionToken },
    /// Release a camera stream.
    Release {
        /// The stream to release; releasing twice is harmless.
        lease: LeaseId,
    },
    /// Schedule the self-timer.
    ScheduleTimer {
        /// The timer's token, to report `TimerElapsed` with.
        token: InteractionToken,
        /// When to fire, on the monotonic clock `StartSelfTimer` used.
        deadline: MonotonicMillis,
    },
    /// Cancel the self-timer.
    CancelTimer {
        /// The timer to cancel.
        token: InteractionToken,
    },
    /// Capture a frame from the live stream.
    CaptureFrame {
        /// The capture's token, to report its frame with.
        token: InteractionToken,
        /// The live stream to capture from.
        lease: LeaseId,
    },
}

/// How a camera effect ended, or what happened to a live stream.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum CameraEvent {
    /// The camera opened.
    Acquired {
        /// The token of the `Acquire` effect.
        token: InteractionToken,
        /// The host's lease on the live stream; a stale one is released.
        lease: LeaseId,
        /// Omit for native hosts whose acquired stream is already usable.
        #[cfg_attr(feature = "uniffi", uniffi(default))]
        preview: Option<CameraPreview>,
        #[cfg_attr(feature = "uniffi", uniffi(default))]
        devices: Option<CameraDevices>,
    },
    /// Reports playback readiness for the current lease.
    Preview {
        lease: LeaseId,
        preview: CameraPreview,
    },
    /// The camera could not be opened.
    AcquireFailed {
        /// The token of the `Acquire` effect.
        token: InteractionToken,
        /// Why the camera is unavailable.
        error: DeviceError,
    },
    /// A live stream ended, such as when the permission was revoked.
    Lost {
        /// The lease of the stream that was lost.
        lease: LeaseId,
        /// Why it was lost.
        error: DeviceError,
    },
    /// The self-timer fired.
    TimerElapsed {
        /// The token of the `ScheduleTimer` effect.
        token: InteractionToken,
        /// The current time, on the clock the deadline uses; before the
        /// deadline, the timer is scheduled again.
        now: MonotonicMillis,
    },
    /// A frame was captured.
    FrameCaptured {
        /// The token of the `CaptureFrame` effect.
        token: InteractionToken,
        /// The captured photo, registered by the host.
        media: MediaId,
    },
    /// Capturing a frame failed.
    CaptureFailed {
        /// The token of the `CaptureFrame` effect.
        token: InteractionToken,
        /// Why; the camera stays live.
        error: DeviceError,
    },
}

impl CameraState {
    /// Stops the camera, releasing its stream and any timer.
    pub(super) fn stop(&mut self, effects: &mut Vec<DeviceEffect>) {
        if matches!(self, Self::Unavailable { .. }) {
            return;
        }
        match std::mem::replace(self, Self::Dormant) {
            Self::Live { lease, .. } | Self::Capturing { lease, .. } => {
                effects.push(CameraEffect::Release { lease }.into());
            }
            Self::Countdown { lease, token, .. } => {
                effects.push(CameraEffect::CancelTimer { token }.into());
                effects.push(CameraEffect::Release { lease }.into());
            }
            Self::Acquiring { token } => effects.push(CameraEffect::CancelAcquire { token }.into()),
            Self::Dormant | Self::Unavailable { .. } => {}
        }
    }

    fn lease(self) -> Option<LeaseId> {
        match self {
            Self::Live { lease, .. }
            | Self::Countdown { lease, .. }
            | Self::Capturing { lease, .. } => Some(lease),
            _ => None,
        }
    }

    /// Cancels a running self-timer, keeping the camera live.
    pub(super) fn cancel_timer(&mut self, effects: &mut Vec<DeviceEffect>) {
        if let Self::Countdown { lease, token, .. } = *self {
            effects.push(CameraEffect::CancelTimer { token }.into());
            *self = Self::Live {
                lease,
                preview: CameraPreview::Ready,
            };
        }
    }
}

impl DefaultController {
    pub(super) fn camera_action(
        &mut self,
        action: CameraAction,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        match action {
            CameraAction::Retry | CameraAction::Switch => {
                self.unobstructed()?;
                let Some(camera) = self.navigation.camera().copied() else {
                    return Err(Rejection::CameraUnavailable);
                };
                if snapshot.session != SessionPhase::Ready {
                    return Err(Rejection::CameraUnavailable);
                }
                // Retry follows a failure; Switch turns a live camera.
                match (action, camera) {
                    (CameraAction::Retry, CameraState::Unavailable { .. }) => {}
                    (CameraAction::Retry, _) => return Err(Rejection::NoCameraFailure),
                    (_, CameraState::Live { .. }) if self.can_switch_camera() => {}
                    _ => return Err(Rejection::CameraNotLive),
                }
                self.acquire_camera(action == CameraAction::Switch, plan)?;
            }
            CameraAction::StartSelfTimer { now } => {
                self.unobstructed()?;
                let Some(CameraState::Live {
                    lease,
                    preview: CameraPreview::Ready,
                }) = self.navigation.camera().copied()
                else {
                    return Err(Rejection::CameraNotLive);
                };
                let token = self.token()?;
                let deadline = now.checked_add(SELF_TIMER_MS).ok_or(Rejection::Exhausted)?;
                if let Some(camera) = self.navigation.camera() {
                    *camera = CameraState::Countdown {
                        lease,
                        token,
                        deadline,
                    };
                }
                plan.effect(CameraEffect::ScheduleTimer { token, deadline });
            }
            CameraAction::CancelSelfTimer => {
                self.visible()?;
                if let Some(camera) = self.navigation.camera() {
                    camera.cancel_timer(&mut plan.effects);
                }
            }
        }
        Ok(())
    }

    /// A camera report. Off the camera screen every report is stale: a
    /// late stream is released.
    pub(super) fn camera_event(
        &mut self,
        event: CameraEvent,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        let active = self.presence.active();
        let state = self.navigation.camera().copied();
        match event {
            CameraEvent::Acquired {
                token,
                lease,
                preview,
                devices,
            } => {
                if active
                    && self.navigation.modal.is_none()
                    && state == Some(CameraState::Acquiring { token })
                    && let Some(camera) = self.navigation.camera()
                {
                    *camera = CameraState::Live {
                        lease,
                        preview: preview.unwrap_or(CameraPreview::Ready),
                    };
                    self.camera_devices = devices;
                } else {
                    plan.effect(CameraEffect::Release { lease });
                }
            }
            CameraEvent::Preview { lease, preview } => {
                if state.and_then(CameraState::lease) != Some(lease) {
                    return Ok(());
                }
                if preview == CameraPreview::Failed {
                    return self.camera_event(
                        CameraEvent::Lost {
                            lease,
                            error: DeviceError::Failed,
                        },
                        snapshot,
                        plan,
                    );
                }
                if let Some(camera) = self.navigation.camera() {
                    if preview == CameraPreview::Waiting {
                        camera.cancel_timer(&mut plan.effects);
                    }
                    match camera {
                        CameraState::Live {
                            preview: current, ..
                        }
                        | CameraState::Capturing {
                            preview: current, ..
                        } => *current = preview,
                        _ => {}
                    }
                }
            }
            CameraEvent::AcquireFailed { token, error } => {
                if state == Some(CameraState::Acquiring { token })
                    && let Some(camera) = self.navigation.camera()
                {
                    *camera = CameraState::Unavailable { error };
                    plan.event(DeviceRecoveryEvent::CameraAcquireFailed { error });
                }
            }
            CameraEvent::Lost { lease, error } => {
                if state.and_then(CameraState::lease) == Some(lease)
                    && let Some(camera) = self.navigation.camera()
                {
                    camera.stop(&mut plan.effects);
                    *camera = CameraState::Unavailable { error };
                    plan.event(DeviceRecoveryEvent::CameraLost { error });
                }
            }
            CameraEvent::TimerElapsed { token, now } => {
                if let Some(CameraState::Countdown {
                    token: expected,
                    deadline,
                    ..
                }) = state
                    && token == expected
                    && active
                    && self.navigation.modal.is_none()
                {
                    if now >= deadline {
                        self.capture(plan)?;
                    } else {
                        // Early: wait for the real deadline.
                        plan.effect(CameraEffect::ScheduleTimer { token, deadline });
                    }
                }
            }
            CameraEvent::FrameCaptured { token, media } => {
                let capturing = matches!(
                    state,
                    Some(CameraState::Capturing { token: expected, .. }) if expected == token
                );
                if active && capturing && self.navigation.modal.is_none() {
                    self.stage_photo(media, PhotoSource::Camera, snapshot, plan);
                } else {
                    plan.effect(MediaEffect::Release { media });
                }
            }
            CameraEvent::CaptureFailed { token, error } => {
                if let Some(CameraState::Capturing {
                    lease,
                    token: expected,
                    preview,
                }) = state
                    && token == expected
                    && let Some(camera) = self.navigation.camera()
                {
                    *camera = CameraState::Live { lease, preview };
                    self.issue = Some(Issue::CaptureFailed { error });
                    plan.event(DeviceRecoveryEvent::CaptureFailed { error });
                }
            }
        }
        Ok(())
    }

    /// Opens the camera the camera screen waits for: one not in use, while
    /// the flow is active, the session ready, and no new photo waits or is
    /// processed. Every step that can end such a wait asks.
    pub(super) fn resume_camera(
        &mut self,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        if self.presence.active()
            && self.navigation.modal.is_none()
            && snapshot.session == SessionPhase::Ready
            && self.new_photo().is_none()
            && self.navigation.camera().copied() == Some(CameraState::Dormant)
        {
            self.acquire_camera(false, plan)?;
        }
        Ok(())
    }

    pub(super) fn can_switch_camera(&self) -> bool {
        self.camera_devices
            .as_ref()
            .and_then(CameraDevices::next)
            .is_some()
    }

    /// Opens the camera, releasing any stream it had.
    fn acquire_camera(&mut self, switch_camera: bool, plan: &mut Plan) -> Result<(), Rejection> {
        let device_id = self.camera_devices.as_ref().and_then(|devices| {
            if switch_camera {
                devices.next().map(str::to_owned)
            } else {
                devices.selected.clone()
            }
        });
        let token = self.token()?;
        let camera = self
            .navigation
            .camera()
            .ok_or(Rejection::CameraUnavailable)?;
        camera.stop(&mut plan.effects);
        *camera = CameraState::Acquiring { token };
        plan.effect(CameraEffect::Acquire { token, device_id });
        Ok(())
    }

    fn capture(&mut self, plan: &mut Plan) -> Result<(), Rejection> {
        let lease = match self.navigation.camera().copied() {
            Some(CameraState::Countdown { lease, .. }) => lease,
            _ => return Err(Rejection::CameraNotLive),
        };
        let token = self.token()?;
        if let Some(camera) = self.navigation.camera() {
            *camera = CameraState::Capturing {
                lease,
                token,
                preview: CameraPreview::Ready,
            };
        }
        plan.effect(CameraEffect::CaptureFrame { token, lease });
        Ok(())
    }
}
