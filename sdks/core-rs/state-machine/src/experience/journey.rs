//! The effective shopper journey and the facts a renderer can report about it.

use super::{
    DefaultController, DeviceEffect, DeviceRecoveryEvent, DisplayedImage, FlowEvent,
    NewPhotoStatus, PickerEffect, Plan, PresentationMode,
};
use super::{navigation::Screen, presentation::displayed_image};
use crate::{
    BackendError, DomainEffect, DomainEvent, DomainSnapshot, Effect, HeightStatus,
    InteractionToken, Job, MediaId, PhotoJob, PhotoSource, ProductId, Rejection, SessionEvent,
    TryOnId, VariantId,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum JourneyStep {
    Intro,
    Camera,
    PhotoUpload,
    PhotoRejected,
    Height,
    VariantSelection,
    TryOn,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PhotoUploadPhase {
    Pending,
    Uncertain,
    RetryableFailure,
    InvalidPhoto,
    Failed,
}

pub(super) fn can_retry_photo(status: NewPhotoStatus) -> bool {
    matches!(
        status,
        NewPhotoStatus::Failed {
            error: BackendError::Unavailable | BackendError::Internal
        }
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PhotoUploadView {
    pub phase: PhotoUploadPhase,
    pub show_camera: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum BodyProgress {
    Idle,
    SavingHeight,
    HeightUncertain,
    RenderUncertain,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PresentedResult {
    pub try_on_id: TryOnId,
    pub variant_id: VariantId,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct JourneyEntry {
    pub entry: Option<String>,
    pub subentry: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum JourneyEvent {
    Opened {
        entry: JourneyEntry,
    },
    Closed {
        step: Option<JourneyStep>,
        presented: Option<PresentedResult>,
    },
    StepChanged {
        previous: Option<JourneyStep>,
    },
    PhotoSourceStarted {
        source: PhotoSource,
        origin: JourneyStep,
    },
    PhotoSourceCancelled {
        source: PhotoSource,
        origin: JourneyStep,
    },
    PhotoProcessing {
        source: PhotoSource,
    },
    VariantChanged {
        variant_id: VariantId,
        foreign_ids: crate::ForeignIds,
    },
    ImagePresented {
        result: PresentedResult,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct JourneyView {
    pub step: JourneyStep,
    pub last_visible_step: Option<JourneyStep>,
    pub photo_upload: Option<PhotoUploadView>,
    pub body_progress: BodyProgress,
    /// The result unobstructed in the dialog, including while suspended.
    pub shown_result: Option<TryOnId>,
    /// Identifies this display of the selected result in this opening.
    pub display_token: Option<InteractionToken>,
    pub presented: bool,
    pub last_presented: Option<PresentedResult>,
}

#[derive(Clone, Debug, Default)]
pub(super) struct Journey {
    pub(super) opening: Option<JourneyEntry>,
    last_step: Option<JourneyStep>,
    camera_origin: Option<JourneyStep>,
    picker_origin: Option<JourneyStep>,
    pub(super) display: Option<(TryOnId, InteractionToken)>,
    reported: bool,
    last_presented: Option<PresentedResult>,
}

#[derive(Clone, Copy)]
pub(crate) struct JourneyPosition {
    product: Option<ProductId>,
    photo: Option<MediaId>,
    open: bool,
    active: bool,
    camera: bool,
    new_photo: bool,
    variant: Option<VariantId>,
}

impl DefaultController {
    pub(crate) fn journey_position(&self, snapshot: &DomainSnapshot) -> JourneyPosition {
        JourneyPosition {
            product: snapshot.product.as_ref().map(|product| product.id),
            photo: snapshot.photo.map(|photo| photo.media),
            open: self.presence.open,
            active: self.presence.active(),
            camera: matches!(self.navigation.screen, Screen::Camera { .. }),
            new_photo: self.new_photo().is_some(),
            variant: self
                .navigation
                .on_try_on()
                .then_some(self.selection.variant_id),
        }
    }

    pub(super) fn journey_view(&self, snapshot: &DomainSnapshot) -> JourneyView {
        let screen = &self.navigation.screen;
        let photo_upload = self.new_photo().map(|photo| {
            let phase = match photo.status {
                NewPhotoStatus::Processing { operation }
                    if snapshot.uncertain_operations.contains(&operation) =>
                {
                    PhotoUploadPhase::Uncertain
                }
                status if can_retry_photo(status) => PhotoUploadPhase::RetryableFailure,
                NewPhotoStatus::Failed {
                    error: BackendError::InvalidRequest | BackendError::Unusable,
                } => PhotoUploadPhase::InvalidPhoto,
                NewPhotoStatus::Failed { .. } => PhotoUploadPhase::Failed,
                _ => PhotoUploadPhase::Pending,
            };
            PhotoUploadView {
                phase,
                show_camera: phase == PhotoUploadPhase::Pending
                    && matches!(screen, Screen::Camera { .. }),
            }
        });
        let step = if photo_upload.is_some() {
            JourneyStep::PhotoUpload
        } else {
            match screen {
                Screen::Introduction => JourneyStep::Intro,
                Screen::Camera { .. } => JourneyStep::Camera,
                Screen::Height { .. } => JourneyStep::Height,
                Screen::PhotoRejected { .. } => JourneyStep::PhotoRejected,
                Screen::TryOn if self.presentation.mode == PresentationMode::Result => {
                    JourneyStep::TryOn
                }
                Screen::TryOn => JourneyStep::VariantSelection,
            }
        };
        let body_progress = match snapshot.body.height() {
            Some(HeightStatus::Uncertain { .. }) => BodyProgress::HeightUncertain,
            _ if snapshot.uncertain_try_on => BodyProgress::RenderUncertain,
            Some(HeightStatus::Pending { .. }) => BodyProgress::SavingHeight,
            _ => BodyProgress::Idle,
        };
        let shown_result = if self.presence.open
            && !self.presence.disposed
            && self.navigation.modal.is_none()
            && photo_upload.is_none()
        {
            self.selected_result(snapshot)
        } else {
            None
        };
        JourneyView {
            step,
            last_visible_step: self.journey.last_step,
            photo_upload,
            body_progress,
            shown_result,
            display_token: self.journey.display.map(|(_, token)| token),
            presented: self.journey.reported,
            last_presented: self.journey.last_presented,
        }
    }

    /// Records the shopper-visible facts after commands and their follow-up work settle.
    pub(crate) fn observe_journey(
        &mut self,
        before: JourneyPosition,
        snapshot: &DomainSnapshot,
        effects: &mut Vec<Effect>,
        first: usize,
    ) -> Result<(), Rejection> {
        let view = self.journey_view(snapshot);
        let after = self.journey_position(snapshot);
        let displayed = self
            .presence
            .open
            .then(|| self.selected_result(snapshot))
            .flatten();
        if self.journey.display.map(|(id, _)| id) != displayed {
            self.journey.display = match displayed {
                Some(id) => Some((id, self.token()?)),
                None => None,
            };
            self.journey.reported = false;
        }
        self.sync_render_media(self.journey.display, snapshot, effects)?;
        if let Some(media) = after.photo
            && (before.photo != after.photo || (after.active && !before.active))
        {
            effects.push(Effect::DeviceEffect {
                effect: DeviceEffect::RenderMedia {
                    effect: super::RenderMediaEffect::ObserveSource { media },
                },
            });
        }
        let state = &mut self.journey;
        let product = snapshot.product.as_ref();
        if after.product != before.product
            || after.photo != before.photo
            || (after.active && displayed.is_none())
        {
            state.last_presented = None;
        }
        let previous = state.last_step;
        let opening = if after.active {
            state.opening.take()
        } else {
            None
        };
        let opened = opening.is_some();
        let mut first_events = Vec::new();
        if let Some(entry) = opening {
            first_events.push(journey_event(JourneyEvent::Opened { entry }));
        }
        let origin = previous.unwrap_or(JourneyStep::Intro);
        if after.camera && after.active && (!before.camera || opened) {
            state.camera_origin = Some(origin);
            first_events.push(journey_event(JourneyEvent::PhotoSourceStarted {
                source: PhotoSource::Camera,
                origin,
            }));
        }
        let interrupted = effects[first..].iter().any(|effect| {
            matches!(
                effect,
                Effect::DomainEvent {
                    event: DomainEvent::Session {
                        event: SessionEvent::Failed { .. } | SessionEvent::Invalidated
                    }
                }
            )
        });
        if before.camera
            && before.active
            && !interrupted
            && (!after.camera || !after.open)
            && !before.new_photo
            && !after.new_photo
            && let Some(origin) = state.camera_origin.take()
        {
            first_events.push(journey_event(JourneyEvent::PhotoSourceCancelled {
                source: PhotoSource::Camera,
                origin,
            }));
        }
        if !after.camera || interrupted {
            state.camera_origin = None;
        }
        if interrupted {
            state.picker_origin = None;
        }
        for effect in effects.drain(first..) {
            let event = match &effect {
                Effect::DomainEffect {
                    effect:
                        DomainEffect::Start {
                            job:
                                Job::Photo {
                                    job: PhotoJob::Process { photo },
                                },
                            ..
                        },
                } => {
                    match photo.source {
                        PhotoSource::Camera => state.camera_origin = None,
                        PhotoSource::Library => state.picker_origin = None,
                    }
                    Some(JourneyEvent::PhotoProcessing {
                        source: photo.source,
                    })
                }
                Effect::DeviceEffect {
                    effect:
                        DeviceEffect::Picker {
                            effect: PickerEffect::Open { .. },
                        },
                } if !interrupted => {
                    state.picker_origin = Some(origin);
                    Some(JourneyEvent::PhotoSourceStarted {
                        source: PhotoSource::Library,
                        origin,
                    })
                }
                Effect::DeviceEffect {
                    effect:
                        DeviceEffect::Picker {
                            effect: PickerEffect::Dismiss { .. },
                        },
                }
                | Effect::FlowEvent {
                    event:
                        FlowEvent::DeviceRecovery {
                            event: DeviceRecoveryEvent::PickerCancelled,
                        },
                } => state
                    .picker_origin
                    .take()
                    .map(|origin| JourneyEvent::PhotoSourceCancelled {
                        source: PhotoSource::Library,
                        origin,
                    }),
                Effect::FlowEvent {
                    event:
                        FlowEvent::DeviceRecovery {
                            event: DeviceRecoveryEvent::PickerFailed { .. },
                        },
                } => {
                    state.picker_origin = None;
                    None
                }
                _ => None,
            };
            first_events.push(effect);
            first_events.extend(event.map(journey_event));
        }
        effects.extend(first_events);
        if !after.open {
            if before.open {
                effects.push(journey_event(JourneyEvent::Closed {
                    step: previous,
                    presented: state.last_presented,
                }));
            }
            state.opening = None;
            state.last_step = None;
            state.camera_origin = None;
            state.picker_origin = None;
            state.last_presented = None;
        } else if after.active {
            if opened || previous != Some(view.step) {
                effects.push(journey_event(JourneyEvent::StepChanged { previous }));
            }
            state.last_step = Some(view.step);
        }
        if after.variant != before.variant
            && let Some(variant) = after.variant.and_then(|id| product?.variant(id))
        {
            effects.push(journey_event(JourneyEvent::VariantChanged {
                variant_id: variant.id,
                foreign_ids: variant.foreign_ids.clone(),
            }));
        }
        if let Some(super::ImageView {
            target: super::ImageTarget::Result { try_on_id },
            token,
            phase: super::ImagePhase::Ready,
            ..
        }) = self
            .render_media_view(snapshot)
            .and_then(|view| view.result)
        {
            let mut plan = Plan::default();
            self.image_ready(try_on_id, token, snapshot, &mut plan);
            effects.extend(
                plan.events
                    .into_iter()
                    .map(|event| Effect::FlowEvent { event }),
            );
        }
        Ok(())
    }

    pub(super) fn last_presented_result(&self) -> Option<TryOnId> {
        self.journey.last_presented.map(|result| result.try_on_id)
    }

    pub(super) fn image_ready(
        &mut self,
        try_on_id: TryOnId,
        token: InteractionToken,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) {
        if !self.presence.active()
            || self.journey.reported
            || self.journey.display != Some((try_on_id, token))
            || self.journey_view(snapshot).shown_result != Some(try_on_id)
        {
            return;
        }
        if let Some(try_on) = snapshot.try_on(try_on_id) {
            let result = PresentedResult {
                try_on_id,
                variant_id: try_on.key.variant_id,
            };
            self.journey.reported = true;
            self.journey.last_presented = Some(result);
            plan.event(FlowEvent::Journey {
                event: JourneyEvent::ImagePresented { result },
            });
        }
    }
    fn selected_result(&self, snapshot: &DomainSnapshot) -> Option<TryOnId> {
        if !self.navigation.on_try_on() {
            return None;
        }
        match displayed_image(self.presentation.displayed, snapshot) {
            DisplayedImage::TryOn { try_on_id } => Some(try_on_id),
            DisplayedImage::SourcePhoto => None,
        }
    }
}

fn journey_event(event: JourneyEvent) -> Effect {
    Effect::FlowEvent {
        event: FlowEvent::Journey { event },
    }
}
