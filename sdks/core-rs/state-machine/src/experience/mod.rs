//! The default try-on experience: the shopper's consent, screens and modals,
//! photo changes, the editable height, the selection and which of its items
//! were chosen, the displayed try-on and the request it follows, the
//! self-timer, how the size recommendation is presented, and auto-start.
//!
//! It proposes domain commands but never owns body validity, the session,
//! operations or try-ons. It is its session's one client; a host's own
//! experience can drive the domain directly instead.
//!
//! Its modules are the parts of a flow's state: [`presence`],
//! [`navigation`], [`session`], [`photo`], [`camera`], [`height`],
//! [`selection`], [`size_recommendation`] and [`presentation`]. Each holds
//! the part's values and state, its actions, the device protocol it speaks,
//! and what its actions and the domain's events do to the flow. [`model`]
//! wraps them into the sums that cross the experience's boundary; the
//! controller here hands each input to its part and projects the view.

pub mod camera;
mod cart;
pub use cart::{CartEvent, CartRequest};
pub mod height;
mod journey;
pub(crate) use journey::JourneyPosition;
pub use journey::{
    BodyProgress, JourneyEntry, JourneyEvent, JourneyStep, JourneyView, PhotoUploadPhase,
    PhotoUploadView, PresentedResult,
};
pub mod model;
pub mod navigation;
pub mod photo;
pub mod presence;
pub mod presentation;
mod render_media;
pub use render_media::{
    ImagePhase, ImageTarget, ImageView, RenderMediaAction, RenderMediaEffect, RenderMediaEvent,
    RenderMediaOutcome, RenderMediaView, ResultActionView, classify_download_failure,
    render_media_timeout_ms,
};
pub mod selection;
pub mod session;
pub mod size_recommendation;

pub use crate::domain::TryOnRequestOrigin;
pub use camera::{
    CameraAction, CameraDevices, CameraEffect, CameraEvent, CameraPreview, CameraState,
};
pub use height::HeightAction;
pub use model::*;
pub use navigation::{Modal, NavigationAction};
pub use photo::{
    NewPhoto, NewPhotoStatus, PhotoAction, PhotoChange, PhotoChangeOrigin, PickerEffect,
    PickerEvent,
};
pub use presence::{Presence, PresenceAction};
pub use presentation::{
    AutoStartPolicy, DisplayedImage, ForegroundTryOn, ForegroundTryOnState, PresentationAction,
    PresentationEvent, PresentationMode, PresentationView, PresentedAxis, PresentedAxisItem,
    PrimaryTryOnAction, TryOnFailureKind, TryOnFeedback, TryOnProgress, TryOnWarning,
};
pub use selection::{
    AxisControl, AxisDisplayOptions, AxisItem, AxisPlacement, AxisRole, HostProduct,
    InitialProductInstallation, ItemDisplay, ItemGlyph, ProductInstallation,
    ProductInstallationStatus, SelectionAction, SelectionEvent, SelectionView, VariantAxis,
    VariantLabelFormat, VariantRow, VariantRowItem,
};
pub use session::SessionAction;
pub use size_recommendation::SizeRecommendationAction;

use crate::domain::*;
use crate::error::Rejection;
use crate::ids::*;
use height::{HeightEntry, sets_height};
use navigation::{Navigation, Screen};
use presentation::{AutoStart, Presentation};
use selection::Selection;

/// The default journey's state, one field per part in the parts' order,
/// but what only one screen keeps, such as the camera and the height input,
/// which that screen holds; the domain's lives in the domain.
#[derive(Clone, Debug)]
pub(crate) struct DefaultController {
    render_media: render_media::RenderMedia,
    camera_devices: Option<CameraDevices>,
    cart: cart::Cart,
    journey: journey::Journey,
    dialog: Option<InteractionToken>,
    /// Background preparation never evicts a kept request.
    request_capacity: usize,
    /// Mints the flow's interaction tokens from its ID.
    tokens: Sequence<InteractionToken>,
    /// Whether the flow is shown and active.
    presence: Presence,
    /// The screen, with what only it keeps, and the modal.
    navigation: Navigation,
    /// Whether the shopper consented on this flow's introduction; a reset
    /// clears it.
    consent_given: bool,
    /// The photo change under way, if any.
    photo_change: Option<PhotoChange>,
    /// The height last confirmed, and a deferred SetHeight failure.
    height: HeightEntry,
    /// The variant the flow tries on.
    selection: Selection,
    product_installation: Option<ProductInstallation>,
    product_active: bool,
    /// The size recommendation the shopper dismissed.
    /// The main image, the followed request, and auto-start.
    presentation: Presentation,
    /// A message for the shopper, until a later step clears it.
    issue: Option<Issue>,
}

impl DefaultController {
    pub(crate) fn new(
        id: FlowId,
        config: FlowConfig,
        request_capacity: usize,
    ) -> Result<Self, Rejection> {
        let HostProduct {
            product,
            axes,
            label_formats,
            variant_id,
            chosen_axes,
        } = config.host_product;
        let selection = Selection::new(
            &product.validated()?,
            axes,
            label_formats,
            variant_id,
            chosen_axes,
        )?;
        Ok(Self {
            request_capacity,
            tokens: Sequence::new(id.0),
            render_media: render_media::RenderMedia::default(),
            camera_devices: None,
            cart: cart::Cart::default(),
            journey: journey::Journey::default(),
            dialog: None,
            presence: Presence {
                open: false,
                foreground: true,
                disposed: false,
            },
            navigation: Navigation {
                screen: Screen::Introduction,
                modal: None,
            },
            consent_given: false,
            photo_change: None,
            height: HeightEntry::default(),
            selection,
            product_installation: None,
            product_active: true,
            presentation: Presentation {
                displayed: DisplayedImage::SourcePhoto,
                mode: PresentationMode::Selection,
                followed_try_on_request: None,
                auto_start: AutoStart::new(config.auto_start),
                preparing: None,
                prepared: Default::default(),
            },
            issue: None,
        })
    }

    pub(crate) fn accept_initial_product(
        &mut self,
        product_id: ProductId,
        initial: InitialProductInstallation,
    ) {
        self.product_active = initial.active;
        self.product_installation = Some(ProductInstallation {
            product_id,
            token: initial.token,
            request: initial.token,
            status: ProductInstallationStatus::Ready,
        });
    }

    /// Starts where an existing body leaves the shopper.
    pub(crate) fn adopt_existing(&mut self, snapshot: &DomainSnapshot) {
        if snapshot.body.identity().is_some() {
            self.navigation.screen = if snapshot.body.acknowledged().is_some() {
                Screen::TryOn
            } else {
                self.height_screen(snapshot)
            };
        }
    }

    /// Hands an action to the part it concerns.
    pub(crate) fn action(
        &mut self,
        action: FlowAction,
        snapshot: &DomainSnapshot,
    ) -> Result<Plan, Rejection> {
        if self.presence.disposed {
            return Err(Rejection::FlowDisposed);
        }
        let mut plan = Plan::default();
        match action {
            FlowAction::RenderMedia { action } => {
                self.render_media_action(action, snapshot, &mut plan)?
            }
            FlowAction::OpenWithEntry { entry } => {
                self.open_with_entry(entry, snapshot, &mut plan)?
            }
            FlowAction::Presence { action } => self.presence_action(action, snapshot, &mut plan)?,
            FlowAction::Navigation { action } => {
                self.navigation_action(action, snapshot, &mut plan)?
            }
            FlowAction::Session { action } => self.session_action(action, snapshot, &mut plan)?,
            FlowAction::Photo { action } => self.photo_action(action, snapshot, &mut plan)?,
            FlowAction::Camera { action } => self.camera_action(action, snapshot, &mut plan)?,
            FlowAction::Height { action } => self.height_action(action, &mut plan)?,
            FlowAction::Selection { action } => {
                self.selection_action(action, snapshot, &mut plan)?
            }
            FlowAction::SizeRecommendation { action } => {
                self.size_recommendation_action(action, snapshot, &mut plan)?
            }
            FlowAction::Presentation { action } => {
                self.presentation_action(action, snapshot, &mut plan)?
            }
        }
        Ok(plan)
    }

    /// Hands a device's report to the part that issued its effect.
    pub(crate) fn device(
        &mut self,
        event: DeviceEvent,
        snapshot: &DomainSnapshot,
    ) -> Result<Plan, Rejection> {
        let mut plan = Plan::default();
        match event {
            DeviceEvent::RenderMedia { event } => self.render_media_event(event, &mut plan)?,
            DeviceEvent::Picker { event } => self.picker_event(event, snapshot, &mut plan)?,
            DeviceEvent::Camera { event } => self.camera_event(event, snapshot, &mut plan)?,
            DeviceEvent::Cart { event } => self.cart_event(event, snapshot, &mut plan)?,
        }
        Ok(plan)
    }

    /// Correlates the domain's receipt for a command this experience issued
    /// and the domain took; a refused one is reported instead.
    pub(crate) fn receipt(
        &mut self,
        purpose: Purpose,
        receipt: &DomainReceipt,
        snapshot: &DomainSnapshot,
    ) -> Result<Plan, Rejection> {
        let mut plan = Plan::default();
        match purpose {
            Purpose::ProcessPhoto => {
                if let Some(change) = &mut self.photo_change
                    && let Some(new_photo) = &mut change.new_photo
                    && let Some(operation) = receipt.operation
                {
                    new_photo.status = NewPhotoStatus::Processing { operation };
                }
            }
            Purpose::SetHeight => self.height_confirmed(snapshot, &mut plan)?,
            Purpose::RequestTryOn => {
                self.presentation.followed_try_on_request = receipt.try_on_request_id;
                if let Some(id) = receipt.try_on_request_id
                    && let Some(request) = snapshot.try_on_request(id)
                    && let Some(origin) = request.origin
                {
                    plan.event(PresentationEvent::TryOnRequested {
                        product_id: request.product_id,
                        variant_id: request.variant_id,
                        try_on_request_id: id,
                        origin,
                        foreign_ids: snapshot
                            .product
                            .as_ref()
                            .filter(|product| product.id == request.product_id)
                            .and_then(|product| product.variant(request.variant_id))
                            .map(|variant| variant.foreign_ids.clone())
                            .unwrap_or_default(),
                    });
                }
            }
            Purpose::PrepareCompanion => {
                self.presentation.preparing = receipt.try_on_request_id;
            }
            Purpose::ShowProduct | Purpose::UpdateStock => self.policy(snapshot, &mut plan)?,
            Purpose::Other => {}
        }
        Ok(plan)
    }

    /// Hands a domain event to the part that follows its concern.
    pub(crate) fn domain_event(
        &mut self,
        event: &DomainEvent,
        snapshot: &DomainSnapshot,
    ) -> Result<Plan, Rejection> {
        let mut plan = Plan::default();
        if self.presence.disposed {
            return Ok(plan);
        }
        match event {
            DomainEvent::Session { event } => self.session_event(event, snapshot, &mut plan)?,
            DomainEvent::Photo { event } => self.photo_event(event, snapshot, &mut plan),
            DomainEvent::Body { event } => self.body_event(event, snapshot, &mut plan)?,
            DomainEvent::SizeRecommendation { event } => {
                self.size_recommendation_event(event, snapshot, &mut plan)?
            }
            DomainEvent::TryOn { event } => self.try_on_event(event, snapshot, &mut plan)?,
            // A background companion whose render became uncertain is not
            // worth waiting for: let go of it, so the domain drops the render.
            DomainEvent::OperationUncertain { operation, .. } => {
                if let Some(id) = self.presentation.preparing
                    && snapshot.try_on_request(id).is_some_and(|request| {
                        request.status
                            == (TryOnRequestStatus::Running {
                                operation: *operation,
                            })
                    })
                {
                    self.presentation.preparing = None;
                    plan.command(
                        Purpose::Other,
                        TryOnCommand::DetachRequest {
                            try_on_request_id: id,
                        },
                    );
                }
            }
        }
        Ok(plan)
    }

    /// Whether the flow follows `operation`: the new photo's processing,
    /// the SetHeight, or the followed request's creation.
    fn follows(&self, operation: OperationId, snapshot: &DomainSnapshot) -> bool {
        self.processes_new_photo(operation)
            || sets_height(snapshot, operation)
            || self.follows_try_on(operation, snapshot)
    }

    fn operation_issue(&self, snapshot: &DomainSnapshot) -> Option<Issue> {
        if let Some(NewPhotoStatus::Failed { error }) = self.new_photo().map(|photo| photo.status) {
            return Some(Issue::PhotoFailed { error });
        }
        if let Some(operation) = snapshot
            .uncertain_operations
            .iter()
            .copied()
            .find(|&operation| self.follows(operation, snapshot))
        {
            return Some(Issue::OperationUncertain { operation });
        }
        matches!(self.navigation.screen, Screen::Height { .. })
            .then(|| self.height.visible_issue())
            .flatten()
    }

    /// Shows a refused command as the flow's issue.
    pub(crate) fn report(&mut self, reason: Rejection) {
        self.issue = Some(Issue::Rejected { reason });
    }

    pub(crate) fn clear_rejection(&mut self) {
        self.issue
            .take_if(|issue| matches!(issue, Issue::Rejected { .. }));
    }

    pub(crate) fn report_shopper_rejection(&mut self, reason: Rejection) {
        if self.presence.active() {
            self.report(reason);
        }
    }

    pub(crate) fn is_disposed(&self) -> bool {
        self.presence.disposed
    }

    pub(crate) fn view(&self, snapshot: &DomainSnapshot) -> FlowView {
        let screen = match &self.navigation.screen {
            Screen::Introduction => ScreenView::Introduction {
                consent_given: self.consented(snapshot),
            },
            Screen::Camera { camera } => ScreenView::Camera {
                camera: *camera,
                can_switch: matches!(camera, CameraState::Live { .. }) && self.can_switch_camera(),
            },
            Screen::Height { draft } => ScreenView::Height { draft: *draft },
            Screen::TryOn => ScreenView::TryOn {
                selection: self.selection.view(snapshot),
                presentation: Box::new(self.presentation_view(snapshot)),
            },
            Screen::PhotoRejected { photo, reason } => ScreenView::PhotoRejected {
                photo: *photo,
                reason: *reason,
            },
        };
        FlowView {
            journey: self.journey_view(snapshot),
            renderer: self.renderer_token(),
            render_media: self.render_media_view(snapshot),
            product_installation: self.product_installation,
            ready_installation: self
                .product_installation
                .filter(|installation| {
                    self.product_available()
                        && snapshot
                            .product
                            .as_ref()
                            .is_some_and(|product| product.id == installation.product_id)
                })
                .map(|installation| installation.token),
            product_active: self.product_active,
            domain: snapshot.clone(),
            presence: self.presence,
            screen,
            modal: self.navigation.modal.clone(),
            photo_change: self.photo_change.clone(),
            issue: self
                .operation_issue(snapshot)
                .or_else(|| self.issue.clone())
                .or_else(|| self.cart_issue(snapshot))
                .or_else(|| self.download_issue())
                .or_else(|| self.request_issue(snapshot)),
            can_go_back: self.can_go_back(snapshot),
            can_confirm_height: self.can_confirm_height(snapshot),
            height_needs_change: matches!(
                self.navigation.screen,
                Screen::Height { draft: Some(height) } if self.height.unusable.contains(&height)
            ),
            can_retry_size_recommendation: self.try_on_screen_free().is_ok()
                && size_recommendation::can_retry(snapshot),
        }
    }

    /// Size recommendation seeding and auto-start, whenever the try-on
    /// screen is up and free.
    fn policy(&mut self, snapshot: &DomainSnapshot, plan: &mut Plan) -> Result<(), Rejection> {
        if self.try_on_screen_free().is_err() {
            return Ok(());
        }
        let Some(product) = &snapshot.product else {
            return Ok(());
        };
        self.recommend(product, snapshot, plan);
        self.auto_start(snapshot, plan)?;
        plan.prepare_companions = true;
        Ok(())
    }

    /// Forgets what the flow kept of the body, for a new one or none: the
    /// height confirmed, a deferred height error, the displayed try-on, the
    /// followed request, and the issue.
    fn forget_body(&mut self) {
        self.height = HeightEntry::default();
        self.presentation.displayed = DisplayedImage::SourcePhoto;
        self.presentation.mode = PresentationMode::Selection;
        self.presentation.followed_try_on_request = None;
        self.presentation.preparing = None;
        self.presentation.prepared.clear();
        self.issue = None;
    }

    /// A new device interaction's token.
    fn token(&mut self) -> Result<InteractionToken, Rejection> {
        self.tokens.next()
    }

    fn visible(&self) -> Result<(), Rejection> {
        if self.presence.active() {
            Ok(())
        } else {
            Err(Rejection::NotVisible)
        }
    }

    fn unobstructed(&self) -> Result<(), Rejection> {
        self.visible()?;
        if self.navigation.modal.is_some() {
            Err(Rejection::ModalOpen)
        } else {
            Ok(())
        }
    }
}

/// What one experience step asks of the domain and the device.
#[derive(Clone, Debug, Default)]
pub(crate) struct Plan {
    /// The domain commands to dispatch, in order.
    pub commands: Vec<PlannedCommand>,
    /// The device work for the host, in order.
    pub effects: Vec<DeviceEffect>,
    /// What happened in the flow, such as a try-on presented.
    pub events: Vec<FlowEvent>,
    /// Recheck background style work once the current facts and commands settle.
    pub prepare_companions: bool,
}

impl Plan {
    fn command(&mut self, purpose: Purpose, command: impl Into<DomainCommand>) {
        self.commands.push(PlannedCommand {
            purpose,
            command: command.into(),
        });
    }

    fn effect(&mut self, effect: impl Into<DeviceEffect>) {
        self.effects.push(effect.into());
    }

    fn event(&mut self, event: impl Into<FlowEvent>) {
        self.events.push(event.into());
    }
}

/// A domain command the experience proposes.
#[derive(Clone, Debug)]
pub(crate) struct PlannedCommand {
    /// Why the command was issued, which decides how its receipt is read.
    pub purpose: Purpose,
    /// The command for the domain.
    pub command: DomainCommand,
}

/// Why the experience issued a domain command, so it can read the receipt.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Purpose {
    /// Nothing to correlate.
    Other,
    /// Processing the new photo: the receipt names its operation.
    ProcessPhoto,
    /// Confirming the height: the view moves on to the try-on screen.
    SetHeight,
    /// The shopper's try-on: the receipt names the request to follow.
    RequestTryOn,
    /// A background toolbar companion; its receipt never changes the foreground.
    PrepareCompanion,
    /// Showing the flow's product: the size recommendation and auto-start
    /// policies run again.
    ShowProduct,
    UpdateStock,
}
