//! What the flow presents: trying the selection on, the request it follows,
//! the try-on or photo its main image displays and paging through them,
//! starting a try-on by itself, what try-on events do to the flow, and
//! which variants the backend refused to try on.

use super::model::*;
use super::{DefaultController, Plan, Purpose};
use crate::domain::*;
use crate::error::Rejection;
use crate::ids::*;
use crate::{AxisKey, ForeignId};

mod axes;
mod feedback;
mod fit;
mod tried;
pub use axes::{PresentedAxis, PresentedAxisItem};
pub use feedback::{TryOnFailureKind, TryOnFeedback, TryOnWarning};
pub use fit::{ResultFitCallout, result_fit_callouts};
pub use tried::tried_picker_items;

/// What the flow presents, as the view shows it.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PresentationView {
    /// What the main image shows; a try-on no request keeps any more falls
    /// back to the source photo.
    pub displayed: DisplayedImage,
    /// The foreground work and any actionable failure.
    pub foreground: Option<ForegroundTryOn>,
    /// The variant that may retry the original request.
    pub retry_variant_id: Option<VariantId>,
    /// Whether the shopper is choosing a variant or viewing a result.
    pub mode: PresentationMode,
    /// Whether the shown result has a pending add-to-cart request.
    #[cfg_attr(feature = "uniffi", uniffi(default = false))]
    pub cart_pending: bool,
    /// What the current foreground request is waiting for.
    #[cfg_attr(feature = "uniffi", uniffi(default))]
    pub progress: Option<TryOnProgress>,
    /// Whether the displayed result can retry its fit assessment.
    #[cfg_attr(feature = "uniffi", uniffi(default = false))]
    pub fit_retryable: bool,
    /// An eligible alternative for the followed request's refusal.
    pub suggested_variant_id: Option<VariantId>,
    /// The carousel: product results matching the displayed toolbar items,
    /// in creation order, earlier body revisions included. Other toolbar
    /// choices are reached through `axis_rows`.
    pub try_ons: Vec<TryOnId>,
    /// Toolbar axes, projected against the displayed result rather than the next selection.
    pub axis_rows: Vec<PresentedAxis>,
    /// Items tried with the currently acknowledged height and picker selection.
    #[cfg_attr(feature = "uniffi", uniffi(default))]
    pub tried_items: Option<std::collections::HashMap<AxisKey, Vec<ForeignId>>>,
    /// Whether `RequestTryOn` would be accepted now, and why not.
    pub can_request_try_on: Capability,
    #[cfg_attr(feature = "uniffi", uniffi(default))]
    pub primary_action: Option<PrimaryTryOnAction>,
    #[cfg_attr(feature = "uniffi", uniffi(default))]
    pub feedback: Option<TryOnFeedback>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum TryOnProgress {
    WaitingForHeight,
    Queued,
    Rendering,
}

/// The picker’s next action for its current draft.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PrimaryTryOnAction {
    Try { variant_id: VariantId },
    Retry { variant_id: VariantId },
    AlreadyWearing,
    Unavailable { reason: Rejection },
}

/// The shopper's current activity on the try-on screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PresentationMode {
    /// The picker is the main view, with the source photo or an earlier result.
    Selection,
    /// The shopper is viewing a result.
    Result,
    /// The picker is open over a result and can be dismissed.
    EditingVariant,
}

/// The variant and state of the request the shopper initiated or auto-start followed.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ForegroundTryOn {
    pub variant_id: VariantId,
    pub state: ForegroundTryOnState,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ForegroundTryOnState {
    Waiting,
    Rendering,
    Uncertain,
    Refused { try_on: RefusedTryOn },
    Failed { failure: TryOnRequestFailure },
}

/// What the experience's main image shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum DisplayedImage {
    /// The shopper's own photo.
    SourcePhoto,
    /// A try-on, which a request in the domain's snapshot holds.
    TryOn {
        /// The try-on shown.
        try_on_id: TryOnId,
    },
}

/// When the experience starts a try-on by itself once the body is ready.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum AutoStartPolicy {
    /// Only when the shopper asks.
    Never,
    /// When the host or shopper chose the item on every axis.
    ExplicitPreselection,
}

/// Trying on, and what the main image displays.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PresentationAction {
    /// Runs the picker action only if it still applies to this variant.
    RunPrimary { variant_id: VariantId },
    /// Tries on the selected variant.
    RequestTryOn,
    /// Retries the failed foreground request with its original variant and body revision.
    RetryTryOn,
    /// Opens or dismisses the picker while viewing a result.
    SetVariantPicker { open: bool },
    /// Reports that the selected result decoded in the mounted renderer.
    ImageReady {
        try_on_id: TryOnId,
        token: InteractionToken,
    },
    /// Retries the fit assessment for the result currently displayed.
    RetryResultFit { try_on_id: TryOnId },
    /// Displays a try-on.
    ShowTryOn {
        /// The try-on to display; it must be of the flow's product.
        try_on_id: TryOnId,
    },
    /// Shows an item of a result-toolbar axis, preserving every other item
    /// and the displayed body revision. Reuses a companion immediately or
    /// follows its request without changing the next selection.
    ShowAxisItem {
        /// The toolbar axis.
        axis: crate::values::AxisKey,
        /// Its item.
        item: crate::values::ForeignId,
    },
}

/// What happened to what the flow displays.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PresentationEvent {
    /// The flow admitted a request, including requests fulfilled from history.
    TryOnRequested {
        product_id: ProductId,
        variant_id: VariantId,
        try_on_request_id: TryOnRequestId,
        origin: TryOnRequestOrigin,
        foreign_ids: crate::ForeignIds,
    },
    /// The flow selected the image to render.
    TryOnSelected {
        /// The selected result.
        try_on_id: TryOnId,
    },
}

/// What the flow presents: the main image, the try-on request it follows,
/// and whether it may still start one by itself.
#[derive(Clone, Debug)]
pub(super) struct Presentation {
    /// What the main image shows.
    pub displayed: DisplayedImage,
    pub mode: PresentationMode,
    /// The foreground try-on request the flow follows; its try-on is
    /// displayed when it resolves.
    pub followed_try_on_request: Option<TryOnRequestId>,
    /// Whether the flow may still start a try-on by itself.
    pub auto_start: AutoStart,
    /// Background companion work is serialized and never drives the hero.
    pub preparing: Option<TryOnRequestId>,
    /// At most once automatically per companion key; explicit requests may retry.
    pub prepared: std::collections::BTreeSet<TryOnKey>,
}

impl Presentation {
    pub(super) fn open_variant_picker(&mut self) {
        if self.mode == PresentationMode::Result {
            self.mode = PresentationMode::EditingVariant;
        }
    }

    pub(super) fn dismiss_variant_picker(&mut self) {
        if self.mode == PresentationMode::EditingVariant {
            self.mode = PresentationMode::Result;
        }
    }
}

/// Whether the flow may still start a try-on by itself, once.
#[derive(Clone, Copy, Debug)]
pub(super) enum AutoStart {
    /// It may start on an explicit selection.
    Armed,
    /// It started one, or an explicit choice or a missing size disarmed
    /// it.
    Disarmed,
}

impl AutoStart {
    pub fn new(policy: AutoStartPolicy) -> Self {
        match policy {
            AutoStartPolicy::Never => Self::Disarmed,
            AutoStartPolicy::ExplicitPreselection => Self::Armed,
        }
    }
}

/// What the main image shows, as the view reports it: a try-on no request
/// keeps any more falls back to the source photo.
pub(super) fn displayed_image(
    displayed: DisplayedImage,
    snapshot: &DomainSnapshot,
) -> DisplayedImage {
    match displayed {
        DisplayedImage::TryOn { try_on_id }
            if snapshot.try_on(try_on_id).is_none_or(|result| {
                snapshot
                    .product
                    .as_ref()
                    .and_then(|p| p.variant(result.key.variant_id))
                    .is_none()
            }) =>
        {
            DisplayedImage::SourcePhoto
        }
        displayed => displayed,
    }
}

/// Why the backend refused to try `variant_id` on the body revision a
/// try-on would read now, if it did; unknown while a SetHeight is pending.
pub(super) fn refusal(snapshot: &DomainSnapshot, variant_id: VariantId) -> Option<RefusalReason> {
    let BodyTarget::Acknowledged { revision } = snapshot.body_target()? else {
        return None;
    };
    snapshot.refusal(&TryOnKey {
        body_revision: revision,
        variant_id,
    })
}

/// The try-ons of the product shown, in the order they were created,
/// earlier heights included.
fn product_try_ons(snapshot: &DomainSnapshot) -> impl Iterator<Item = &TryOn> {
    let product = snapshot.product.as_ref();
    snapshot
        .try_ons()
        .into_iter()
        .filter(move |t| product.is_some_and(|p| p.variant(t.key.variant_id).is_some()))
}

impl DefaultController {
    pub(super) fn presentation_action(
        &mut self,
        action: PresentationAction,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        match action {
            PresentationAction::RunPrimary { variant_id } => {
                let admission = self.try_on_admission(snapshot);
                let next =
                    self.primary_try_on_action(snapshot, &admission, self.retry_variant(snapshot));
                let action = match next {
                    PrimaryTryOnAction::Try {
                        variant_id: selected,
                    } if selected == variant_id => PresentationAction::RequestTryOn,
                    PrimaryTryOnAction::Retry {
                        variant_id: selected,
                    } if selected == variant_id => PresentationAction::RetryTryOn,
                    PrimaryTryOnAction::Unavailable { reason } => return Err(reason),
                    _ => return Err(Rejection::TryOnUnavailable),
                };
                self.presentation_action(action, snapshot, plan)?;
            }
            PresentationAction::RequestTryOn => {
                self.presentation.auto_start = AutoStart::Disarmed;
                self.request(TryOnRequestOrigin::Shopper, snapshot, plan)?;
            }
            PresentationAction::RetryTryOn => {
                let (variant_id, target) = self
                    .try_on_retry(snapshot)
                    .ok_or(Rejection::TryOnUnavailable)?;
                self.try_on_screen_free()?;
                self.admit_target(snapshot, variant_id, &target)?;
                self.submit(
                    variant_id,
                    target,
                    TryOnRequestOrigin::Shopper,
                    snapshot,
                    plan,
                );
            }
            PresentationAction::SetVariantPicker { open } => {
                self.try_on_screen()?;
                if open {
                    self.presentation.open_variant_picker();
                } else {
                    self.presentation.dismiss_variant_picker();
                }
            }
            PresentationAction::RetryResultFit { try_on_id } => {
                if !self.can_retry_result_fit(try_on_id, snapshot) {
                    return Err(Rejection::SizeRecommendationUnavailable);
                }
                self.retry_recommendation(plan);
            }
            PresentationAction::ImageReady { try_on_id, token } => {
                if !self.media_renderer_enabled() {
                    self.image_ready(try_on_id, token, snapshot, plan);
                }
            }
            PresentationAction::ShowTryOn { try_on_id } => {
                self.try_on_screen()?;
                self.show(try_on_id, snapshot, plan)?;
            }
            PresentationAction::ShowAxisItem { axis, item } => {
                self.show_axis_item(&axis, &item, snapshot, plan)?;
            }
        }
        Ok(())
    }

    pub(super) fn try_on_event(
        &mut self,
        event: &TryOnEvent,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        let followed = |id: &TryOnRequestId| self.presentation.followed_try_on_request == Some(*id);
        match event {
            // A newly refused size is seeded no more.
            TryOnEvent::Refused { .. } => self.policy(snapshot, plan)?,
            TryOnEvent::RequestResolved {
                try_on_request_id, ..
            } if followed(try_on_request_id) => {
                self.present_completed_result(snapshot, plan);
            }
            TryOnEvent::RequestRefused {
                try_on_request_id, ..
            }
            | TryOnEvent::RequestFailed {
                try_on_request_id, ..
            } if followed(try_on_request_id) && self.navigation.on_try_on() => {
                self.presentation.open_variant_picker();
            }
            _ => {}
        }
        plan.prepare_companions = true;
        Ok(())
    }

    pub(super) fn present_completed_result(&mut self, snapshot: &DomainSnapshot, plan: &mut Plan) {
        if self.navigation.on_try_on()
            && self.navigation.modal.is_none()
            && self.new_photo().is_none()
            && let Some(request) = self.followed_request(snapshot)
            && let TryOnRequestStatus::Resolved { try_on_id } = request.status
        {
            self.presentation.followed_try_on_request = None;
            if snapshot.try_on(try_on_id).is_some() {
                self.presentation.displayed = DisplayedImage::TryOn { try_on_id };
                self.presentation.mode = PresentationMode::Result;
                self.clear_try_on_issue();
                plan.event(PresentationEvent::TryOnSelected { try_on_id });
            }
        }
    }

    fn followed_request<'a>(
        &self,
        snapshot: &'a DomainSnapshot,
    ) -> Option<&'a TryOnRequestSnapshot> {
        snapshot.try_on_request(self.presentation.followed_try_on_request?)
    }

    pub(super) fn foreground_pending(&self, snapshot: &DomainSnapshot) -> bool {
        self.followed_request(snapshot)
            .is_some_and(|request| request.status.is_open())
    }

    pub(super) fn foreground_rendering(&self, snapshot: &DomainSnapshot) -> bool {
        self.followed_request(snapshot).is_some_and(|request| {
            matches!(request.status, TryOnRequestStatus::Running { operation } if !snapshot.uncertain_operations.contains(&operation))
        })
    }

    pub(super) fn clear_try_on_issue(&mut self) {
        self.cart.failed = None;
    }

    pub(super) fn request_issue(&self, snapshot: &DomainSnapshot) -> Option<Issue> {
        if !self.navigation.on_try_on() {
            return None;
        }
        match self
            .followed_request(snapshot)
            .map(|request| &request.status)
        {
            Some(TryOnRequestStatus::Refused { try_on }) => Some(Issue::TryOnRefused {
                reason: try_on.reason,
            }),
            Some(TryOnRequestStatus::Failed { failure }) => {
                Some(Issue::TryOnFailed { failure: *failure })
            }
            _ => snapshot
                .size_recommendation_error
                .map(|error| Issue::SizeRecommendationFailed { error }),
        }
    }

    pub(super) fn try_on_retry(
        &self,
        snapshot: &DomainSnapshot,
    ) -> Option<(VariantId, BodyTarget)> {
        let request = self.followed_request(snapshot)?;
        if matches!(
            request.status,
            TryOnRequestStatus::Failed {
                failure: TryOnRequestFailure::Backend {
                    error: BackendError::Unavailable | BackendError::Internal
                },
            }
        ) {
            Some((request.variant_id, request.target.clone()))
        } else {
            None
        }
    }

    fn retry_variant(&self, snapshot: &DomainSnapshot) -> Option<VariantId> {
        let (variant_id, target) = self.try_on_retry(snapshot)?;
        (self.try_on_screen_free().is_ok()
            && self.admit_target(snapshot, variant_id, &target).is_ok())
        .then_some(variant_id)
    }

    fn primary_try_on_action(
        &self,
        snapshot: &DomainSnapshot,
        admission: &Result<BodyTarget, Rejection>,
        retry: Option<VariantId>,
    ) -> PrimaryTryOnAction {
        let variant_id = self.selection.variant_id;
        if self.presentation.mode != PresentationMode::Selection
            && let DisplayedImage::TryOn { try_on_id } = self.presentation.displayed
            && let Some(result) = snapshot.try_on(try_on_id)
            && result.key.variant_id == variant_id
            && matches!(snapshot.body_target(), Some(BodyTarget::Acknowledged { revision }) if revision == result.key.body_revision)
        {
            PrimaryTryOnAction::AlreadyWearing
        } else if let Err(reason) = admission {
            PrimaryTryOnAction::Unavailable { reason: *reason }
        } else if retry == Some(variant_id) {
            PrimaryTryOnAction::Retry { variant_id }
        } else {
            PrimaryTryOnAction::Try { variant_id }
        }
    }

    /// What the view shows of the presentation.
    pub(super) fn presentation_view(&self, snapshot: &DomainSnapshot) -> PresentationView {
        let admission = self.try_on_admission(snapshot);
        let followed = self.followed_request(snapshot);
        let retry_variant_id = self.retry_variant(snapshot);
        let primary_action = self.primary_try_on_action(snapshot, &admission, retry_variant_id);
        let capability = match admission {
            Ok(_) => Capability::Available,
            Err(reason) => Capability::Unavailable { reason },
        };
        let suggested = followed.and_then(|request| {
            let TryOnRequestStatus::Refused { try_on } = &request.status else {
                return None;
            };
            let alternative = try_on
                .alternative
                .as_ref()
                .filter(|ids| ids.iter().next().is_some())?;
            let product = snapshot.product.as_ref()?;
            let candidates = product.variants.iter().filter(|variant| {
                alternative
                    .iter()
                    .all(|(axis, item)| variant.foreign_ids.get(axis) == Some(item))
                    && self
                        .admit_target(snapshot, variant.id, &request.target)
                        .is_ok()
            });
            // A size suggestion may omit color or style. Keep those values
            // from the refused request, even if the draft has since changed.
            self.selection.closest(
                product,
                request.variant_id,
                candidates,
                &Default::default(),
                false,
            )
        });
        let displayed = displayed_image(self.presentation.displayed, snapshot);
        let fit_retryable = match displayed {
            DisplayedImage::TryOn { try_on_id } => self.can_retry_result_fit(try_on_id, snapshot),
            DisplayedImage::SourcePhoto => false,
        };
        PresentationView {
            displayed,
            foreground: followed.and_then(|request| {
                let state = match &request.status {
                    TryOnRequestStatus::Waiting => ForegroundTryOnState::Waiting,
                    TryOnRequestStatus::Running { operation }
                        if snapshot.uncertain_operations.contains(operation) =>
                    {
                        ForegroundTryOnState::Uncertain
                    }
                    TryOnRequestStatus::Running { .. } => ForegroundTryOnState::Rendering,
                    TryOnRequestStatus::Refused { try_on } => ForegroundTryOnState::Refused {
                        try_on: try_on.clone(),
                    },
                    TryOnRequestStatus::Failed { failure } => {
                        ForegroundTryOnState::Failed { failure: *failure }
                    }
                    TryOnRequestStatus::Resolved { .. } | TryOnRequestStatus::Cancelled => {
                        return None;
                    }
                };
                Some(ForegroundTryOn {
                    variant_id: request.variant_id,
                    state,
                })
            }),
            retry_variant_id,
            mode: self.presentation.mode,
            progress: followed.and_then(|request| match request.status {
                TryOnRequestStatus::Waiting
                    if matches!(snapshot.body.height(), Some(HeightStatus::Uncertain { .. }))
                        || snapshot.uncertain_try_on =>
                {
                    None
                }
                TryOnRequestStatus::Waiting => Some(match snapshot.body_target() {
                    Some(BodyTarget::Pending { .. }) => TryOnProgress::WaitingForHeight,
                    _ => TryOnProgress::Queued,
                }),
                TryOnRequestStatus::Running { operation }
                    if !snapshot.uncertain_operations.contains(&operation) =>
                {
                    Some(TryOnProgress::Rendering)
                }
                _ => None,
            }),
            fit_retryable,
            cart_pending: self.cart_view(snapshot).pending,
            suggested_variant_id: suggested.map(|variant| variant.id),
            try_ons: self
                .carousel_try_ons(snapshot)
                .iter()
                .map(|t| t.id)
                .collect(),
            axis_rows: self.presented_axes(snapshot),
            tried_items: Some(self.tried_picker_items(snapshot)),
            can_request_try_on: capability,
            primary_action: Some(primary_action),
            feedback: Some(self.try_on_feedback(snapshot, followed, capability)),
        }
    }

    /// Whether the flow follows `operation`: the followed request runs it.
    pub(super) fn follows_try_on(&self, operation: OperationId, snapshot: &DomainSnapshot) -> bool {
        self.presentation
            .followed_try_on_request
            .and_then(|id| snapshot.try_on_request(id))
            .is_some_and(|r| r.status == TryOnRequestStatus::Running { operation })
    }

    /// Lets go of the followed request. The domain decides what that means
    /// for its render: see `TryOnCommand::DetachRequest`.
    pub(super) fn detach(&mut self, snapshot: &DomainSnapshot, plan: &mut Plan) {
        if let Some(id) = self.presentation.followed_try_on_request.take()
            && snapshot
                .try_on_request(id)
                .is_some_and(|r| r.status.is_open())
        {
            plan.command(
                Purpose::Other,
                TryOnCommand::DetachRequest {
                    try_on_request_id: id,
                },
            );
        }
    }

    /// Returns to the picker while keeping the current image in view.
    pub(super) fn back_to_selection(&mut self, snapshot: &DomainSnapshot, plan: &mut Plan) {
        self.presentation.mode = PresentationMode::Selection;
        self.detach(snapshot, plan);
        self.clear_try_on_issue();
    }

    /// Whether the try-on screen is up: the flow is visible and no modal
    /// is open. Its try-ons can be browsed.
    pub(super) fn try_on_screen(&self) -> Result<(), Rejection> {
        self.unobstructed()?;
        if !self.navigation.on_try_on() {
            return Err(Rejection::TryOnUnavailable);
        }
        Ok(())
    }

    /// Whether the try-on screen is up and free: no new photo is pending
    /// either, so the body stays. A try-on can start, and the policies run.
    pub(super) fn try_on_screen_free(&self) -> Result<(), Rejection> {
        self.try_on_screen()?;
        if self.new_photo().is_some() || !self.product_available() {
            return Err(Rejection::TryOnUnavailable);
        }
        Ok(())
    }

    /// Whether a try-on of the selection can start now, and the body
    /// revision it would read. The view's `can_request_try_on` shows it,
    /// `RequestTryOn` is refused without it, and auto-start waits for it.
    pub(super) fn try_on_admission(
        &self,
        snapshot: &DomainSnapshot,
    ) -> Result<BodyTarget, Rejection> {
        self.try_on_screen_free()?;
        if self.foreground_pending(snapshot) {
            return Err(Rejection::TryOnUnavailable);
        }
        if snapshot.body.is_missing() {
            return Err(Rejection::TryOnInputsUnavailable {
                error: BackendError::BodyNotFound,
            });
        }
        let target = snapshot
            .body_target()
            .ok_or(Rejection::HeightNotAcknowledged)?;
        self.admit_target(snapshot, self.selection.variant_id, &target)?;
        Ok(target)
    }

    pub(super) fn admit_target(
        &self,
        snapshot: &DomainSnapshot,
        variant_id: VariantId,
        target: &BodyTarget,
    ) -> Result<(), Rejection> {
        if snapshot.uncertain_try_on {
            return Err(Rejection::TryOnUnavailable);
        }
        validate_request(snapshot, variant_id, target)?;
        if let Some(error) = snapshot.permanent_try_on_failure(variant_id, target) {
            return Err(Rejection::TryOnInputsUnavailable { error });
        }
        if let Some(reason) = refusal(snapshot, variant_id) {
            return Err(Rejection::TryOnRefused { reason });
        }
        Ok(())
    }

    /// Tries the selection on, unless the followed request already does.
    pub(super) fn request(
        &mut self,
        origin: TryOnRequestOrigin,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        let target = self.try_on_admission(snapshot)?;
        self.submit(self.selection.variant_id, target, origin, snapshot, plan);
        Ok(())
    }

    fn submit(
        &mut self,
        variant_id: VariantId,
        target: BodyTarget,
        origin: TryOnRequestOrigin,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) {
        self.detach(snapshot, plan);
        self.clear_try_on_issue();
        plan.command(
            Purpose::RequestTryOn,
            TryOnCommand::Request {
                variant_id,
                target,
                origin: Some(origin),
            },
        );
    }

    fn show(
        &mut self,
        id: TryOnId,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        let try_on = snapshot.try_on(id).ok_or(Rejection::TryOnNotAvailable)?;
        if snapshot
            .product
            .as_ref()
            .and_then(|p| p.variant(try_on.key.variant_id))
            .is_none()
        {
            return Err(Rejection::TryOnOfAnotherProduct);
        }
        if !self.foreground_pending(snapshot) {
            self.detach(snapshot, plan);
        }
        self.clear_try_on_issue();
        self.presentation.displayed = DisplayedImage::TryOn { try_on_id: id };
        self.presentation.mode = PresentationMode::Result;
        plan.event(PresentationEvent::TryOnSelected { try_on_id: id });
        plan.prepare_companions = true;
        Ok(())
    }

    /// Starts once when every variant axis has an explicit choice.
    pub(super) fn auto_start(
        &mut self,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        if !matches!(self.presentation.auto_start, AutoStart::Armed) {
            return Ok(());
        }
        if !self.selection.explicit() {
            self.presentation.auto_start = AutoStart::Disarmed;
            return Ok(());
        }
        // It stays armed until a try-on can start.
        if self.try_on_admission(snapshot).is_err() {
            return Ok(());
        }
        self.presentation.auto_start = AutoStart::Disarmed;
        self.request(TryOnRequestOrigin::Automatic, snapshot, plan)
    }
}
