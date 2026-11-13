use std::collections::{HashMap, HashSet};

use super::DefaultController;
use crate::{AxisKey, AxisRole, DomainSnapshot, ForeignId, ForeignIds};

/// Show sizes tried with the other selected size axes, and colors tried with
/// the selected size and other color axes. Toolbar styles do not affect marks.
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn tried_picker_items(
    axes: HashMap<AxisKey, AxisRole>,
    selected: Option<ForeignIds>,
    tried: Vec<ForeignIds>,
) -> HashMap<AxisKey, Vec<ForeignId>> {
    project(&axes, selected.as_ref(), tried.iter().collect())
}

fn project(
    axes: &HashMap<AxisKey, AxisRole>,
    selected: Option<&ForeignIds>,
    tried: Vec<&ForeignIds>,
) -> HashMap<AxisKey, Vec<ForeignId>> {
    if tried.is_empty() {
        return HashMap::new();
    }
    axes.iter()
        .filter(|(_, role)| matches!(role, AxisRole::Size | AxisRole::Color))
        .map(|(axis, role)| {
            let context: Vec<_> = axes
                .iter()
                .filter(|(key, other_role)| {
                    *key != axis && (**other_role == AxisRole::Size || **other_role == *role)
                })
                .map(|(key, _)| key)
                .collect();
            let mut seen = HashSet::new();
            let items = tried
                .iter()
                .filter(|items| {
                    context.iter().all(|key| {
                        items.get(key) == selected.and_then(|selected| selected.get(key))
                    })
                })
                .filter_map(|items| items.get(axis))
                .filter(|item| seen.insert(*item))
                .cloned()
                .collect();
            (axis.clone(), items)
        })
        .collect()
}

impl DefaultController {
    pub(super) fn tried_picker_items(
        &self,
        snapshot: &DomainSnapshot,
    ) -> HashMap<AxisKey, Vec<ForeignId>> {
        let Some(product) = &snapshot.product else {
            return HashMap::new();
        };
        let Some(revision) = snapshot.body.acknowledged() else {
            return HashMap::new();
        };
        let axes = self
            .selection
            .axes
            .iter()
            .filter_map(|axis| Some((axis.key.clone(), axis.role?)))
            .collect();
        let tried = snapshot
            .try_ons
            .iter()
            .filter(|result| result.key.body_revision == revision)
            .filter_map(|result| product.variant(result.key.variant_id))
            .map(|variant| &variant.foreign_ids)
            .collect();
        project(
            &axes,
            product
                .variant(self.selection.variant_id)
                .map(|variant| &variant.foreign_ids),
            tried,
        )
    }
}
