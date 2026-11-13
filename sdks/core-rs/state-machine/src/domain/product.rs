//! Products and their variants, as the backend lists them, and the one
//! product the domain shows. A variant is named by its `VariantId` and
//! placed on each axis by the shop's own identifiers; names, labels, images
//! and stock are the shop's, and reach only the experience.

#[cfg(feature = "uniffi")]
use std::collections::HashMap;
use std::collections::{BTreeMap, BTreeSet};

use super::engine::DomainEngine;
use super::model::{DomainOutput, Job};
use super::try_on::TryOnCommand;
use crate::error::Rejection;
use crate::ids::*;
use crate::values::*;

/// A garment the shopper can try on: its variants, as the backend lists
/// them.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct Product {
    /// The product's identifier.
    pub id: ProductId,
    /// The variants that can be tried on: 1 to 4096, with unique IDs and
    /// foreign IDs, all on the same axes. A variant the shop sells but the
    /// backend does not list cannot be tried on.
    pub variants: Vec<Variant>,
}

impl Product {
    pub fn variant(&self, id: VariantId) -> Option<&Variant> {
        self.variants.iter().find(|v| v.id == id)
    }

    /// The axes its variants differ along, in key order.
    pub fn axes(&self) -> impl Iterator<Item = &AxisKey> {
        self.variants
            .first()
            .into_iter()
            .flat_map(|v| v.foreign_ids.axes())
    }

    /// The product, if it has 1 to 4096 variants with unique IDs and
    /// foreign IDs, every one with a nonempty item on the same axes.
    pub fn validated(self) -> Result<Self, Rejection> {
        if self.variants.is_empty() || self.variants.len() > 4096 {
            return Err(Rejection::InvalidVariantCount);
        }
        let axes: Vec<_> = self.axes().cloned().collect();
        let mut ids = BTreeSet::new();
        let mut foreign_ids = BTreeSet::new();
        for variant in &self.variants {
            if variant
                .foreign_ids
                .iter()
                .any(|(axis, id)| axis.is_empty() || id.is_empty())
            {
                return Err(Rejection::EmptyAxisKey);
            }
            if !variant.foreign_ids.axes().eq(axes.iter()) {
                return Err(Rejection::InconsistentAxes);
            }
            if !ids.insert(variant.id) || !foreign_ids.insert(&variant.foreign_ids) {
                return Err(Rejection::DuplicateVariant);
            }
        }
        Ok(self)
    }
}

/// One variant of a product that can be tried on.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct Variant {
    /// The variant's identifier: what a try-on is created from.
    pub id: VariantId,
    /// Where it sits on each of the product's axes, by the shop's
    /// identifiers; unique within its product.
    pub foreign_ids: ForeignIds,
}

/// A variant's item on each axis, by the shop's own identifiers, such as
/// `{ colorway: "IX7055-259", size: "XS" }`; a map in the bindings.
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ForeignIds(BTreeMap<AxisKey, ForeignId>);

impl ForeignIds {
    /// The item on `axis`, if the variant has that axis.
    pub fn get(&self, axis: &AxisKey) -> Option<&ForeignId> {
        self.0.get(axis)
    }

    /// The axes, in key order.
    pub fn axes(&self) -> impl Iterator<Item = &AxisKey> {
        self.0.keys()
    }

    /// The axes and their items, in key order.
    pub fn iter(&self) -> impl Iterator<Item = (&AxisKey, &ForeignId)> {
        self.0.iter()
    }

    /// Whether both name the same item on every axis but `axis`.
    pub fn same_beside(&self, other: &Self, axis: &AxisKey) -> bool {
        self.0.len() == other.0.len()
            && self
                .0
                .iter()
                .all(|(key, id)| key == axis || other.0.get(key) == Some(id))
    }

    /// How many of `axes` both name the same item on.
    pub fn agreement<'a>(
        &self,
        other: &Self,
        axes: impl IntoIterator<Item = &'a AxisKey>,
    ) -> usize {
        axes.into_iter()
            .filter(|axis| {
                self.0
                    .get(*axis)
                    .is_some_and(|id| other.0.get(*axis) == Some(id))
            })
            .count()
    }
}

impl FromIterator<(AxisKey, ForeignId)> for ForeignIds {
    fn from_iter<I: IntoIterator<Item = (AxisKey, ForeignId)>>(iter: I) -> Self {
        Self(iter.into_iter().collect())
    }
}

#[cfg(feature = "uniffi")]
uniffi::custom_type!(ForeignIds, HashMap<AxisKey, ForeignId>, {
    lower: |ids| ids.0.into_iter().collect(),
    try_lift: |map| Ok(map.into_iter().collect()),
});

/// What a client asks of the product shown.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ProductCommand {
    /// Shows the shopper a product, replacing the one shown: the domain
    /// holds only that one. A changed product drops the size
    /// recommendation, and waiting try-on requests for another product
    /// fail.
    Show {
        /// The product now shown.
        product: Product,
        /// Stock for the installed product, when supplied by the host.
        #[cfg_attr(feature = "uniffi", uniffi(default))]
        unavailable_variants: Option<Vec<VariantId>>,
    },
}

impl DomainEngine {
    pub(super) fn product_command(
        &mut self,
        command: ProductCommand,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        let ProductCommand::Show {
            product,
            unavailable_variants,
        } = command;
        let product = product.validated()?;
        if self.product.as_ref() != Some(&product) {
            // The recommendation is scoped to the catalogue being replaced.
            if let (Some(previous), Some(revision)) =
                (&self.product, self.body.state.acknowledged())
            {
                self.requests
                    .update_fit(previous.id, revision, |_| super::ResultFit::Failed);
            }
            self.size_recommendation = None;
            self.size_recommendation_error = None;
            self.retire(|job| matches!(job, Job::SizeRecommendation { .. }), output);
            self.catalogue_revision = self.catalogue_revision.next().ok_or(Rejection::Exhausted)?;
            self.product = Some(product);
        }
        if let Some(variant_ids) = unavailable_variants {
            self.try_on_command(TryOnCommand::SetUnavailableVariants { variant_ids }, output)?;
        }
        Ok(())
    }
}
