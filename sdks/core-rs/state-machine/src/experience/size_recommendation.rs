//! How the flow shows the size recommendation: asking for it, letting it
//! pick the items nobody chose, retrying it, and what its
//! events do to the flow.

use super::DisplayedImage;
use super::model::*;
use super::presentation::{AutoStart, refusal};
use super::{DefaultController, Plan, Purpose};
use crate::domain::*;
use crate::error::Rejection;

/// How the size recommendation is shown.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SizeRecommendationAction {
    /// Asks for the size recommendation again.
    Retry,
    /// Chooses the recommended size without starting a try-on.
    Select,
}

pub(super) fn can_retry(snapshot: &DomainSnapshot) -> bool {
    snapshot.product.is_some()
        && matches!(
            snapshot.body_target(),
            Some(BodyTarget::Acknowledged { .. })
        )
        && snapshot.size_recommendation.is_none()
        && !snapshot.size_recommendation_pending
        && matches!(
            snapshot.size_recommendation_error,
            None | Some(BackendError::Internal | BackendError::Unavailable)
        )
}

pub(super) fn variant_unavailable(snapshot: &DomainSnapshot, id: crate::ids::VariantId) -> bool {
    snapshot.unavailable_variants.contains(&id)
        || snapshot
            .body_target()
            .is_none_or(|target| snapshot.permanent_try_on_failure(id, &target).is_some())
}

impl DefaultController {
    pub(super) fn retry_recommendation(&mut self, plan: &mut Plan) {
        plan.command(Purpose::Other, SizeRecommendationCommand::Fetch);
    }

    pub(super) fn can_retry_result_fit(
        &self,
        id: crate::TryOnId,
        snapshot: &DomainSnapshot,
    ) -> bool {
        self.try_on_screen_free().is_ok()
            && self.presentation.displayed == (DisplayedImage::TryOn { try_on_id: id })
            && can_retry(snapshot)
            && snapshot.try_on(id).is_some_and(|result| {
                matches!(result.fit, Some(ResultFit::Failed))
                    && snapshot.product.as_ref().and_then(|product| product.variant(result.key.variant_id)).is_some()
                    && matches!(snapshot.body_target(), Some(BodyTarget::Acknowledged { revision }) if revision == result.key.body_revision)
            })
    }

    pub(super) fn size_recommendation_action(
        &mut self,
        action: SizeRecommendationAction,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        self.unobstructed()?;
        if !self.navigation.on_try_on() {
            return Err(Rejection::SizeRecommendationUnavailable);
        }
        match action {
            SizeRecommendationAction::Retry => {
                if self.try_on_screen_free().is_err() || !can_retry(snapshot) {
                    return Err(Rejection::SizeRecommendationUnavailable);
                }
                self.retry_recommendation(plan);
            }
            SizeRecommendationAction::Select => {
                let variant_id = self
                    .selection
                    .recommended_variant(snapshot)
                    .ok_or(Rejection::NoSizeRecommendation)?;
                if variant_id != self.selection.variant_id {
                    if !self.foreground_pending(snapshot) {
                        self.detach(snapshot, plan);
                    }
                    self.issue = None;
                }
                self.issue
                    .take_if(|issue| matches!(issue, Issue::StockUnavailable { .. }));
                self.selection.choose_recommended_variant(variant_id);
                self.presentation.auto_start = AutoStart::Disarmed;
            }
        }
        Ok(())
    }

    pub(super) fn size_recommendation_event(
        &mut self,
        event: &SizeRecommendationEvent,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        match event {
            SizeRecommendationEvent::Ready => {
                self.policy(snapshot, plan)?;
            }
            SizeRecommendationEvent::Failed { .. } => {
                self.presentation.auto_start = AutoStart::Disarmed;
            }
        }
        Ok(())
    }

    /// Asks for a missing size recommendation once the height is
    /// acknowledged, and lets it pick the items on the axes nobody chose,
    /// in no size the backend refused. Without a size to seed, the flow
    /// never falls back to trying on an arbitrary default.
    pub(super) fn recommend(
        &mut self,
        product: &Product,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) {
        let recommendation = snapshot.size_recommendation.as_ref();
        if recommendation.is_none()
            && snapshot.size_recommendation_error.is_none()
            && snapshot.body.acknowledged().is_some()
        {
            plan.command(Purpose::Other, SizeRecommendationCommand::Fetch);
        }
        if !self.selection.explicit()
            && let Some(recommendation) = recommendation
            && !self.selection.seed(
                product,
                recommendation,
                |id| refusal(snapshot, id).is_some(),
                |id| variant_unavailable(snapshot, id),
            )
        {
            self.presentation.auto_start = AutoStart::Disarmed;
        }
    }
}
