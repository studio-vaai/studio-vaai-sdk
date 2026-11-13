//! Cart work is owned by the flow. The storefront performs the write.

use std::collections::BTreeMap;

use super::{DefaultController, DisplayedImage, Issue, Plan, PresentationMode, SelectionEvent};
use crate::{
    DomainSnapshot, ForeignIds, InteractionToken, ProductId, Rejection, TryOn, TryOnId, VariantId,
};

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct CartRequest {
    pub token: InteractionToken,
    pub product_id: ProductId,
    pub try_on_id: TryOnId,
    pub variant_id: VariantId,
    pub foreign_ids: ForeignIds,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct CartEvent {
    pub token: InteractionToken,
    pub added: bool,
}

#[derive(Clone, Debug, Default)]
pub(super) struct Cart {
    pending: BTreeMap<InteractionToken, (InteractionToken, TryOnId)>,
    pub(super) failed: Option<TryOnId>,
}

impl DefaultController {
    pub(super) fn cart_pending(&self, id: TryOnId) -> bool {
        self.cart.pending.values().any(|(_, result)| *result == id)
    }

    pub(super) fn cart_view(&self, snapshot: &DomainSnapshot) -> super::ResultActionView {
        let DisplayedImage::TryOn { try_on_id } =
            super::presentation::displayed_image(self.presentation.displayed, snapshot)
        else {
            return super::ResultActionView::default();
        };
        let pending = self.cart_pending(try_on_id);
        super::ResultActionView {
            available: !pending && self.cart_candidate(snapshot).is_some(),
            pending,
            failed: self.cart.failed == Some(try_on_id),
        }
    }

    pub(super) fn cart_issue(&self, snapshot: &DomainSnapshot) -> Option<Issue> {
        self.cart
            .failed
            .filter(|&try_on_id| {
                super::presentation::displayed_image(self.presentation.displayed, snapshot)
                    == DisplayedImage::TryOn { try_on_id }
            })
            .map(|try_on_id| Issue::CartFailed { try_on_id })
    }

    pub(super) fn cart_candidate<'a>(&self, snapshot: &'a DomainSnapshot) -> Option<&'a TryOn> {
        self.selection_shown().ok()?;
        if self.new_photo().is_some()
            || !self.product_available()
            || self.presentation.mode == PresentationMode::Selection
            || !self.image_ready_for_cart()
            || !self.renderer_can_add_to_cart()
        {
            return None;
        }
        let DisplayedImage::TryOn { try_on_id } =
            super::presentation::displayed_image(self.presentation.displayed, snapshot)
        else {
            return None;
        };
        let result = snapshot.try_on(try_on_id)?;
        (!snapshot
            .unavailable_variants
            .contains(&result.key.variant_id))
        .then_some(result)
    }

    pub(super) fn request_cart(
        &mut self,
        variant_id: VariantId,
        expected_result: Option<TryOnId>,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        self.selection_shown()?;
        let try_on_id = self
            .cart_candidate(snapshot)
            .filter(|result| {
                result.key.variant_id == variant_id
                    && expected_result.is_none_or(|id| id == result.id)
            })
            .ok_or(Rejection::CartVariantUnavailable)?
            .id;
        let product = snapshot.product.as_ref().ok_or(Rejection::NoProductShown)?;
        let dialog = self.dialog.ok_or(Rejection::CartVariantUnavailable)?;
        if self.cart_pending(try_on_id) {
            return Ok(());
        }
        let variant = product
            .variant(variant_id)
            .ok_or(Rejection::UnknownVariant)?;
        let token = self.token()?;
        self.cart.pending.insert(token, (dialog, try_on_id));
        self.cart.failed = None;
        let request = CartRequest {
            token,
            product_id: product.id,
            try_on_id,
            variant_id,
            foreign_ids: variant.foreign_ids.clone(),
        };
        plan.event(SelectionEvent::AddToCartRequested {
            request: request.clone(),
        });
        plan.effect(super::DeviceEffect::Cart { request });
        Ok(())
    }

    pub(super) fn cart_event(
        &mut self,
        event: CartEvent,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        let Some((dialog, try_on_id)) = self.cart.pending.remove(&event.token) else {
            return Ok(());
        };
        if self.dialog == Some(dialog)
            && self.navigation.on_try_on()
            && self.navigation.modal.is_none()
            && self.new_photo().is_none()
            && self.presentation.mode != PresentationMode::Selection
            && super::presentation::displayed_image(self.presentation.displayed, snapshot)
                == (DisplayedImage::TryOn { try_on_id })
        {
            if event.added {
                self.presence_action(super::PresenceAction::Close, snapshot, plan)?;
            } else {
                self.cart.failed = Some(try_on_id);
            }
        }
        Ok(())
    }
}
