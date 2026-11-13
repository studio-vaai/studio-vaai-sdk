//! What crosses the default experience's boundary, as sums over its parts.
//! Each part's actions, device effects, device events and flow events live
//! in its own module; the sums here wrap them, beside what every part
//! shares: the configuration, the issue shown, and the view. Nothing in the
//! domain uses them.

use super::camera::{CameraAction, CameraEffect, CameraEvent, CameraState};
use super::height::HeightAction;
use super::navigation::{Modal, NavigationAction};
use super::photo::{PhotoAction, PhotoChange, PickerEffect, PickerEvent};
use super::presence::{Presence, PresenceAction};
use super::presentation::{
    AutoStartPolicy, PresentationAction, PresentationEvent, PresentationView,
};
use super::selection::{HostProduct, SelectionAction, SelectionEvent, SelectionView};
use super::session::SessionAction;
use super::size_recommendation::SizeRecommendationAction;
use crate::domain::model::wraps;
use crate::domain::*;
use crate::error::Rejection;
use crate::ids::*;
use crate::values::*;

/// How a default experience starts.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FlowConfig {
    /// The product the flow tries on, as the host shows it; the session
    /// shows it from then on.
    pub host_product: HostProduct,
    /// When the flow starts a try-on by itself, at most once.
    pub auto_start: AutoStartPolicy,
}

/// What the shopper (or the host on their behalf) does in the experience,
/// by the part of the flow it concerns.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum FlowAction {
    RenderMedia {
        action: super::RenderMediaAction,
    },
    /// Opens the flow with the host’s entry metadata.
    OpenWithEntry {
        entry: super::JourneyEntry,
    },
    /// Showing, hiding, suspending or disposing the flow.
    Presence {
        /// What to do.
        action: PresenceAction,
    },
    /// Going back, or closing a modal.
    Navigation {
        /// What to do.
        action: NavigationAction,
    },
    /// Consent and the session.
    Session {
        /// What to do.
        action: SessionAction,
    },
    /// Taking, replacing and sending a photo.
    Photo {
        /// What to do.
        action: PhotoAction,
    },
    /// The live camera and its self-timer.
    Camera {
        /// What to do.
        action: CameraAction,
    },
    /// The height input.
    Height {
        /// What to do.
        action: HeightAction,
    },
    /// The product, the selected variant and the cart.
    Selection {
        /// What to do.
        action: SelectionAction,
    },
    /// How the size recommendation is shown.
    SizeRecommendation {
        /// What to do.
        action: SizeRecommendationAction,
    },
    /// Trying on, and what the main image displays.
    Presentation {
        /// What to do.
        action: PresentationAction,
    },
}

/// Work the host's device adapter performs for the flow, by device.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum DeviceEffect {
    RenderMedia {
        effect: super::RenderMediaEffect,
    },
    /// Add the requested variant to the host cart.
    Cart {
        request: super::CartRequest,
    },
    /// For the photo library picker.
    Picker {
        /// What to do.
        effect: PickerEffect,
    },
    /// For the camera or its self-timer.
    Camera {
        /// What to do.
        effect: CameraEffect,
    },
    /// For the media registry: the flow's own interest in a photo.
    Media {
        /// What to do.
        effect: MediaEffect,
    },
}

/// How a device effect ended, reported through the flow that issued it, by
/// device.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum DeviceEvent {
    RenderMedia {
        event: super::RenderMediaEvent,
    },
    /// The result of a cart request.
    Cart {
        event: super::CartEvent,
    },
    /// From the photo library picker.
    Picker {
        /// What happened.
        event: PickerEvent,
    },
    /// From the camera or its self-timer.
    Camera {
        /// What happened.
        event: CameraEvent,
    },
}

/// Why the device could not do what the flow asked, as the host's adapter
/// classifies it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum DeviceError {
    /// The shopper or the OS denied the permission.
    PermissionDenied,
    /// The device has no such capability, or another app holds it.
    Unavailable,
    /// The OS interrupted it, such as a call or the app going away.
    Interrupted,
    /// Anything else went wrong.
    Failed,
}

/// A device outcome the flow accepted for its current interaction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum DeviceRecoveryEvent {
    PickerCancelled,
    PickerFailed { error: DeviceError },
    CameraAcquireFailed { error: DeviceError },
    CameraLost { error: DeviceError },
    CaptureFailed { error: DeviceError },
}

/// Something that happened in the flow, for the host: analytics, or the
/// storefront, by the part of the flow it happened in.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum FlowEvent {
    /// An accepted shopper-visible journey fact.
    Journey {
        event: super::JourneyEvent,
    },
    /// To the selection.
    Selection {
        /// What happened.
        event: SelectionEvent,
    },
    /// To what the flow displays.
    Presentation {
        /// What happened.
        event: PresentationEvent,
    },
    DeviceRecovery {
        event: DeviceRecoveryEvent,
    },
}

/// A committed flow change: its runtime revision and the view after it.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FlowUpdate {
    /// The runtime revision the change committed; never show an older view
    /// over a newer one.
    pub revision: RuntimeRevision,
    /// The flow after the change.
    pub view: FlowView,
}

/// Everything a renderer of the default experience needs: the domain's
/// state, the flow's presence, the screen it shows with exactly that
/// screen's data, any modal over it, the photo change, whose new photo any
/// screen may show being processed, and the issue. The flow names the
/// domain's try-ons and requests by ID, as the domain's snapshot holds
/// them.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FlowView {
    pub journey: super::JourneyView,
    pub renderer: Option<InteractionToken>,
    pub render_media: Option<super::RenderMediaView>,
    pub product_active: bool,
    pub product_installation: Option<super::ProductInstallation>,
    pub ready_installation: Option<InteractionToken>,
    /// The domain's state the view was made from, at the same revision.
    pub domain: DomainSnapshot,
    /// Whether the flow is shown, in the foreground and alive.
    pub presence: Presence,
    /// The screen the flow shows, with its data.
    pub screen: ScreenView,
    /// The overlay, if any.
    pub modal: Option<Modal>,
    /// The photo change under way, if any.
    pub photo_change: Option<PhotoChange>,
    /// What went wrong, for the shopper, until a later step clears it.
    pub issue: Option<Issue>,
    /// Whether Back has a destination and can be used now.
    pub can_go_back: bool,
    /// Whether the height screen can continue with its current input.
    pub can_confirm_height: bool,
    /// Whether another size recommendation fetch can help for the current inputs.
    pub can_retry_size_recommendation: bool,
    /// The current height draft is the value the backend could not calibrate.
    pub height_needs_change: bool,
}

/// A screen of the flow, with what it shows.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ScreenView {
    /// Consent and the choice of photo source.
    Introduction {
        /// Whether the shopper consented: on this flow, or by the session
        /// there is or is being created, which implies it.
        consent_given: bool,
    },
    /// The live camera.
    Camera {
        /// The camera's state.
        camera: CameraState,
        can_switch: bool,
    },
    /// The height input.
    Height {
        /// The height in the input; until confirmed, it may differ from
        /// the acknowledged one.
        draft: Option<HeightCm>,
    },
    /// Variant selection and try-ons.
    TryOn {
        /// The selected variant, and the product's axes as rows.
        selection: SelectionView,
        /// The main image, the followed request, the carousel, and whether
        /// a try-on can start.
        presentation: Box<PresentationView>,
    },
    /// The photo the backend rejected.
    PhotoRejected {
        /// The rejected photo.
        photo: Photo,
        /// Why the backend cannot create a body from it.
        reason: PhotoRejection,
    },
}

/// What the flow tells the shopper went wrong, until a later step clears
/// it.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Issue {
    /// A photo source was requested before consent was given.
    ConsentRequired,
    /// The requested item would select a variant the storefront cannot sell.
    StockUnavailable {
        axis: AxisKey,
        item: ForeignId,
        variant_id: VariantId,
    },
    /// The domain refused a command the flow issued.
    Rejected {
        /// Why.
        reason: Rejection,
    },
    /// An operation the flow follows has an unknown outcome; the issue
    /// goes once the flow no longer follows it.
    OperationUncertain {
        /// The operation: the new photo's processing, the SetHeight, or the
        /// followed request's creation.
        operation: OperationId,
    },
    /// The established session expired during this flow.
    SessionExpired,
    /// Restoring or creating the session failed.
    SessionFailed {
        /// What the backend reported.
        error: BackendError,
    },
    /// The photo library picker failed.
    PickerFailed {
        /// Why.
        error: DeviceError,
    },
    /// Processing the photo failed.
    PhotoFailed {
        /// What the backend reported.
        error: BackendError,
    },
    /// Capturing a frame failed.
    CaptureFailed {
        /// Why.
        error: DeviceError,
    },
    /// Writing the height failed.
    SetHeightFailed {
        /// What the backend reported.
        error: BackendError,
    },
    /// The size recommendation could not be fetched.
    SizeRecommendationFailed {
        /// What the backend reported.
        error: BackendError,
    },
    /// The storefront could not add the shown result.
    CartFailed {
        try_on_id: TryOnId,
    },
    DownloadFailed {
        try_on_id: TryOnId,
    },
    /// The backend refused the try-on the flow follows.
    TryOnRefused {
        /// Why.
        reason: RefusalReason,
    },
    /// The try-on the flow follows failed.
    TryOnFailed {
        /// Why.
        failure: TryOnRequestFailure,
    },
}

/// Whether an action would be accepted now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Capability {
    /// It would.
    Available,
    /// It would be refused.
    Unavailable {
        /// Why.
        reason: Rejection,
    },
}

wraps! {
    FlowAction::Presence { action: PresenceAction },
    FlowAction::Navigation { action: NavigationAction },
    FlowAction::Session { action: SessionAction },
    FlowAction::Photo { action: PhotoAction },
    FlowAction::Camera { action: CameraAction },
    FlowAction::Height { action: HeightAction },
    FlowAction::Selection { action: SelectionAction },
    FlowAction::SizeRecommendation { action: SizeRecommendationAction },
    FlowAction::Presentation { action: PresentationAction },
    DeviceEvent::Picker { event: PickerEvent },
    DeviceEvent::Camera { event: CameraEvent },
    DeviceEffect::Picker { effect: PickerEffect },
    DeviceEffect::Camera { effect: CameraEffect },
    DeviceEffect::Media { effect: MediaEffect },
    FlowEvent::Selection { event: SelectionEvent },
    FlowEvent::Presentation { event: PresentationEvent },
    FlowEvent::DeviceRecovery { event: DeviceRecoveryEvent },
}
