//! Result-toolbar axes: exact companions of the displayed immutable result,
//! their cached images, and bounded background preparation. Selection is untouched.

use super::{AutoStart, DisplayedImage};
use crate::domain::*;
use crate::error::Rejection;
use crate::experience::selection::{AxisDisplayOptions, AxisPlacement, ItemDisplay};
use crate::experience::{Capability, DefaultController, Plan, Purpose};
use crate::ids::*;
use crate::values::*;

/// One toolbar axis projected against the displayed result.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PresentedAxis {
    pub role: Option<crate::experience::AxisRole>,
    pub key: AxisKey,
    pub label: Option<String>,
    pub display_options: Option<AxisDisplayOptions>,
    pub items: Vec<PresentedAxisItem>,
}

/// A result choice, with the exact variant and same-revision cached image.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PresentedAxisItem {
    pub key: ForeignId,
    pub display: ItemDisplay,
    pub selected: bool,
    pub variant_id: Option<VariantId>,
    pub try_on_id: Option<TryOnId>,
    /// A cached image may be shown even at an earlier height. An uncached
    /// image can only be requested for the body's acknowledged revision.
    pub can_show: Capability,
}

impl DefaultController {
    fn displayed_try_on<'a>(&self, snapshot: &'a DomainSnapshot) -> Option<&'a TryOn> {
        let DisplayedImage::TryOn { try_on_id } = self.presentation.displayed else {
            return None;
        };
        snapshot.try_on(try_on_id)
    }

    pub(super) fn presented_axes(&self, snapshot: &DomainSnapshot) -> Vec<PresentedAxis> {
        let Some(shown) = self.displayed_try_on(snapshot) else {
            return vec![];
        };
        let Some(product) = &snapshot.product else {
            return vec![];
        };
        let Some(current) = product.variant(shown.key.variant_id) else {
            return vec![];
        };
        self.selection
            .axes
            .iter()
            .filter(|axis| {
                axis.display_options
                    .is_some_and(|d| d.placement == AxisPlacement::ResultToolbar)
            })
            .map(|axis| PresentedAxis {
                key: axis.key.clone(),
                role: axis.role,
                label: axis.label.clone(),
                display_options: axis.display_options,
                items: axis
                    .items
                    .iter()
                    .map(|item| {
                        let variant = product.variants.iter().find(|v| {
                            v.foreign_ids.get(&axis.key) == Some(&item.key)
                                && v.foreign_ids.same_beside(&current.foreign_ids, &axis.key)
                        });
                        let key = variant.map(|v| TryOnKey {
                            body_revision: shown.key.body_revision,
                            variant_id: v.id,
                        });
                        let cached = key
                            .as_ref()
                            .and_then(|key| snapshot.try_ons().into_iter().find(|t| t.key == *key));
                        let admission = self.try_on_screen().and_then(|()| {
                            let key = key.as_ref().ok_or(Rejection::NoVariantForItem)?;
                            if cached.is_some() {
                                return Ok(());
                            }
                            self.try_on_screen_free()?;
                            if self.foreground_pending(snapshot) {
                                return Err(Rejection::TryOnUnavailable);
                            }
                            self.admit_target(
                                snapshot,
                                key.variant_id,
                                &BodyTarget::Acknowledged {
                                    revision: key.body_revision,
                                },
                            )
                        });
                        PresentedAxisItem {
                            key: item.key.clone(),
                            display: item.display.clone(),
                            selected: current.foreign_ids.get(&axis.key) == Some(&item.key),
                            variant_id: variant.map(|v| v.id),
                            try_on_id: cached.map(|t| t.id),
                            can_show: match admission {
                                Ok(()) => Capability::Available,
                                Err(reason) => Capability::Unavailable { reason },
                            },
                        }
                    })
                    .collect(),
            })
            .collect()
    }

    /// Omit another toolbar combination only when the history or toolbar
    /// offers an existing result that can reach it without rendering.
    pub(super) fn carousel_try_ons<'a>(&self, snapshot: &'a DomainSnapshot) -> Vec<&'a TryOn> {
        let results: Vec<_> = super::product_try_ons(snapshot).collect();
        let Some(product) = snapshot.product.as_ref() else {
            return results;
        };
        let Some(current) = self
            .displayed_try_on(snapshot)
            .and_then(|result| product.variant(result.key.variant_id))
        else {
            return results;
        };
        let toolbar_axes: Vec<_> = self
            .selection
            .axes
            .iter()
            .filter(|axis| {
                axis.display_options
                    .is_some_and(|display| display.placement == AxisPlacement::ResultToolbar)
            })
            .collect();
        if toolbar_axes.is_empty() {
            return results;
        }
        results
            .iter()
            .copied()
            .filter(|result| {
                let Some(variant) = product.variant(result.key.variant_id) else {
                    return false;
                };
                let mut differing = toolbar_axes.iter().filter(|axis| {
                    variant.foreign_ids.get(&axis.key) != current.foreign_ids.get(&axis.key)
                });
                let Some(axis) = differing.next() else {
                    return true;
                };
                differing.next().is_some()
                    || !results.iter().any(|candidate| {
                        candidate.key.body_revision == result.key.body_revision
                            && product
                                .variant(candidate.key.variant_id)
                                .is_some_and(|other| {
                                    other
                                        .foreign_ids
                                        .same_beside(&variant.foreign_ids, &axis.key)
                                        && other.foreign_ids.get(&axis.key)
                                            == current.foreign_ids.get(&axis.key)
                                })
                    })
            })
            .collect()
    }

    pub(super) fn show_axis_item(
        &mut self,
        axis: &AxisKey,
        item: &ForeignId,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        self.try_on_screen()?;
        let choice = self
            .presented_axes(snapshot)
            .into_iter()
            .find(|row| row.key == *axis)
            .and_then(|row| {
                row.items
                    .into_iter()
                    .find(|candidate| candidate.key == *item)
            })
            .ok_or(Rejection::NoVariantForItem)?;
        if let Capability::Unavailable { reason } = choice.can_show {
            return Err(reason);
        }
        self.presentation.auto_start = AutoStart::Disarmed;
        if let Some(id) = choice.try_on_id {
            return self.show(id, snapshot, plan);
        }
        let shown = self
            .displayed_try_on(snapshot)
            .ok_or(Rejection::TryOnNotAvailable)?;
        let variant_id = choice.variant_id.ok_or(Rejection::NoVariantForItem)?;
        let target = BodyTarget::Acknowledged {
            revision: shown.key.body_revision,
        };
        self.submit(
            variant_id,
            target,
            super::TryOnRequestOrigin::Shopper,
            snapshot,
            plan,
        );
        Ok(())
    }

    /// Background work never evicts a kept result, follows the hero, loops
    /// after a failure, or fans out concurrent requests.
    pub(crate) fn prepare_companions(&mut self, snapshot: &DomainSnapshot, plan: &mut Plan) {
        if self.try_on_screen_free().is_err() || snapshot.uncertain_try_on {
            return;
        }
        if self
            .presentation
            .followed_try_on_request
            .and_then(|id| snapshot.try_on_request(id))
            .is_some_and(|r| r.status.is_open())
        {
            return;
        }
        if self
            .presentation
            .preparing
            .and_then(|id| snapshot.try_on_request(id))
            .is_some_and(|r| r.status.is_open())
        {
            return;
        }
        self.presentation.preparing = None;
        let Some(shown) = self.displayed_try_on(snapshot) else {
            return;
        };
        let revision = shown.key.body_revision;
        if snapshot.body_target() != Some(BodyTarget::Acknowledged { revision }) {
            return;
        }
        self.presentation.prepared.retain(|key| {
            key.body_revision == revision
                && snapshot
                    .product
                    .as_ref()
                    .is_some_and(|p| p.variant(key.variant_id).is_some())
        });
        if snapshot.try_ons.len() >= self.request_capacity {
            return;
        }
        let candidate = self
            .presented_axes(snapshot)
            .into_iter()
            .flat_map(|row| row.items)
            .find_map(|item| {
                let key = TryOnKey {
                    body_revision: revision,
                    variant_id: item.variant_id?,
                };
                (item.try_on_id.is_none()
                    && matches!(item.can_show, Capability::Available)
                    && !self.presentation.prepared.contains(&key))
                .then_some(key)
            });
        if let Some(key) = candidate {
            self.presentation.prepared.insert(key.clone());
            plan.command(
                Purpose::PrepareCompanion,
                TryOnCommand::Request {
                    variant_id: key.variant_id,
                    target: BodyTarget::Acknowledged { revision },
                    origin: None,
                },
            );
        }
    }
}
