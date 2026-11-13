//! Size recommendations: how well each size of a product fits the body,
//! overall and on each measurement, best first. A size is the set of
//! variants in it, so no axis has to be called `size`. The backend can
//! also report which variants it would refuse before a render is requested.

use std::cmp::Ordering;
use std::collections::BTreeSet;

use super::body::ReadyBody;
use super::engine::DomainEngine;
use super::model::{BackendError, DomainOutput, Job};
use super::product::Product;
use super::try_on::RefusalReason;
use crate::error::Rejection;
use crate::ids::*;
use crate::values::*;

/// The size recommendation for one product and body.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SizeRecommendation {
    /// What it was made for; it applies only while all of it is current.
    pub key: SizeRecommendationKey,
    /// How well each size fits, best aggregate first; a tie keeps the
    /// product's order of their variants.
    pub scores: Vec<SizeRecommendationScore>,
    /// Variants the backend says it would refuse for this body revision.
    pub restrictions: Vec<SizeRestriction>,
    /// The API explicitly reported that none of the published sizes are eligible.
    pub no_suitable_size: bool,
    /// The API's preferred variants, before falling back to the remaining ranked scores.
    pub preferred: Vec<VariantId>,
}

/// A variant the backend would refuse for the current body.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SizeRestriction {
    pub variant_id: VariantId,
    pub reason: RefusalReason,
}

/// Everything a size recommendation depends on.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SizeRecommendationKey {
    /// The body's acknowledged height revision it is for; revisions are
    /// never reused, so it also names the body.
    pub body_revision: BodyRevision,
    /// The product it is for.
    pub product_id: ProductId,
}

/// How well one size fits the body.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SizeRecommendationScore {
    /// The product's variants in this size, whatever their other items,
    /// such as every colorway of it.
    pub variant_ids: Vec<VariantId>,
    /// How well the size fits overall.
    pub aggregate: FitScore,
    /// How it fits on each measurement compared, in size-chart order;
    /// columns of no `FitAxis` are left out.
    pub axes: Vec<FitAxisScore>,
}

/// How well a size fits overall.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FitScore {
    /// How closely it matches the product's intended fit; it orders the
    /// sizes.
    pub fit_match: FitMatch,
    /// How it wears overall.
    pub fit: Fit,
}

/// How a size wears on one measurement.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FitAxisScore {
    /// The measurement compared.
    pub axis: FitAxis,
    /// How the size wears on it.
    pub fit: Fit,
    /// The backend dimension slug and the brand's label, for image callouts.
    #[cfg_attr(feature = "uniffi", uniffi(default))]
    pub dimension: Option<String>,
    #[cfg_attr(feature = "uniffi", uniffi(default))]
    pub label: Option<String>,
}

/// A measurement a size is compared on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum FitAxis {
    /// The chest's girth.
    Chest,
    /// The waist's girth.
    Waist,
    /// The hip's girth.
    Hip,
    /// The hem's opening, graded like a girth.
    Bottom,
    /// The garment's whole length.
    TotalLength,
    /// The sleeve's length.
    SleeveLength,
    /// The shoulders' width.
    ShoulderWidth,
    /// The inseam's length.
    Inseam,
    /// A custom garment measurement.
    Other,
}

/// How a size wears, from tightest to loosest.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Fit {
    /// Smaller than the body, or far tighter than intended.
    TooSmall,
    /// Noticeably tighter than intended, but wearable.
    RunsTight,
    /// As the brand intends.
    Ideal,
    /// Noticeably looser than intended.
    RunsLoose,
    /// Far looser than intended, even for its fit.
    TooLoose,
}

/// What a client asks of the size recommendation.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SizeRecommendationCommand {
    /// Asks for the size recommendation for the product shown and the
    /// body's acknowledged height.
    Fetch,
}

/// What the host does for a size recommendation.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SizeRecommendationJob {
    /// Fetch how well each size of the key's product fits the body; report
    /// `Fetched` or a failure.
    Fetch {
        /// The body to score the sizes for.
        body_id: BodyId,
        /// The product and body revision it is for.
        key: SizeRecommendationKey,
        /// The catalogue used to translate the response into variant IDs.
        product: Product,
        /// The installed catalogue to which the translated scores apply.
        catalogue_revision: CatalogueRevision,
        /// The acknowledged backend revision to read.
        backend_revision: Option<String>,
    },
}

/// How a size recommendation job ended.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SizeRecommendationOutcome {
    /// The size recommendation arrived.
    Fetched {
        /// How well each size fits, each size once, in any order.
        scores: Vec<SizeRecommendationScore>,
    },
    /// A recommendation with the API's eligibility and preferred size.
    Ranked {
        scores: Vec<SizeRecommendationScore>,
        restrictions: Vec<SizeRestriction>,
        no_suitable_size: bool,
        preferred: Vec<VariantId>,
    },
}

/// What happened to the size recommendation for the product shown.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SizeRecommendationEvent {
    /// It arrived; it is in the snapshot.
    Ready,
    /// It could not be fetched.
    Failed {
        /// What the backend reported.
        error: BackendError,
    },
}

/// What a size recommendation for `product` and `body` depends on.
fn key(body: &ReadyBody<'_>, product: &Product) -> Result<SizeRecommendationKey, Rejection> {
    Ok(SizeRecommendationKey {
        body_revision: body.revision,
        product_id: product.id,
    })
}

/// The scores best first: by aggregate fit match, a tie by the product's
/// order of their variants. Refused unless each names some of `product`'s
/// variants, no variant is in two sizes, and every fit match is from 0 to
/// 1.
fn ordered(
    mut scores: Vec<SizeRecommendationScore>,
    product: &Product,
    preserve_rank: bool,
) -> Result<Vec<SizeRecommendationScore>, Rejection> {
    if scores.iter().any(|s| s.variant_ids.is_empty()) {
        return Err(Rejection::EmptyRecommendedSize);
    }
    if scores.iter().any(|s| !s.aggregate.fit_match.is_valid()) {
        return Err(Rejection::InvalidFitMatch);
    }
    let mut unique = BTreeSet::new();
    for id in scores.iter().flat_map(|s| &s.variant_ids) {
        if product.variant(*id).is_none() {
            return Err(Rejection::RecommendedSizeNotShown);
        }
        if !unique.insert(*id) {
            return Err(Rejection::VariantInTwoSizes);
        }
    }
    if preserve_rank {
        return Ok(scores);
    }
    let first = |score: &SizeRecommendationScore| {
        product
            .variants
            .iter()
            .position(|v| score.variant_ids.contains(&v.id))
    };
    scores.sort_by(|a, b| {
        let by_match = b.aggregate.fit_match.0.total_cmp(&a.aggregate.fit_match.0);
        match by_match {
            Ordering::Equal => first(a).cmp(&first(b)),
            unequal => unequal,
        }
    });
    Ok(scores)
}

impl DomainEngine {
    pub(super) fn size_recommendation_command(
        &mut self,
        command: SizeRecommendationCommand,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        let SizeRecommendationCommand::Fetch = command;
        self.session.ready()?;
        let body = self.body.ready()?;
        let product = self.product.as_ref().ok_or(Rejection::NoProductShown)?;
        let key = key(&body, product)?;
        if self
            .size_recommendation
            .as_ref()
            .is_some_and(|current| current.key == key)
        {
            return Ok(());
        }
        let fetching = self.operations.iter().find(|o| {
            matches!(&o.job, Job::SizeRecommendation {
                job: SizeRecommendationJob::Fetch { key: k, .. },
            } if *k == key)
        });
        if let Some(operation) = fetching {
            output.receipt.operation = Some(operation.id);
            return Ok(());
        }
        self.requests
            .update_fit(product.id, key.body_revision, |_| super::ResultFit::Pending);
        let job = SizeRecommendationJob::Fetch {
            body_id: body.body_id,
            key,
            product: product.clone(),
            catalogue_revision: self.catalogue_revision,
            backend_revision: body.backend_revision.clone(),
        };
        self.size_recommendation_error = None;
        output.receipt.operation = Some(self.start(job, false, output)?);
        Ok(())
    }

    pub(super) fn size_recommendation_ended(
        &mut self,
        job: SizeRecommendationJob,
        outcome: SizeRecommendationOutcome,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        let SizeRecommendationJob::Fetch { key, .. } = job;
        let preserve_rank = matches!(outcome, SizeRecommendationOutcome::Ranked { .. });
        let (scores, restrictions, no_suitable_size, preferred) = match outcome {
            SizeRecommendationOutcome::Fetched { scores } => (scores, vec![], false, vec![]),
            SizeRecommendationOutcome::Ranked {
                scores,
                restrictions,
                no_suitable_size,
                preferred,
            } => (scores, restrictions, no_suitable_size, preferred),
        };
        // Its key is still current: a new photo or product retires the
        // fetch, and a SetHeight waits for it.
        let product = self.product.as_ref().ok_or(Rejection::NoProductShown)?;
        let scores = ordered(scores, product, preserve_rank)?;
        self.requests
            .update_fit(key.product_id, key.body_revision, |variant_id| {
                super::ResultFit::from_scores(&scores, variant_id)
            });
        for operation in self.operations.iter_mut() {
            if let Job::TryOn {
                job:
                    super::TryOnJob::Create {
                        key: render,
                        catalogue_revision,
                        ..
                    },
            } = &operation.job
                && *catalogue_revision == self.catalogue_revision
                && render.body_revision == key.body_revision
            {
                operation.result_fit =
                    Some(super::ResultFit::from_scores(&scores, render.variant_id));
            }
        }
        self.size_recommendation = Some(SizeRecommendation {
            key,
            scores,
            restrictions,
            no_suitable_size,
            preferred,
        });
        output.events.push(SizeRecommendationEvent::Ready.into());
        Ok(())
    }

    pub(super) fn size_recommendation_failed(
        &mut self,
        error: BackendError,
        output: &mut DomainOutput,
    ) {
        self.size_recommendation_error = Some(error);
        if let (Some(product), Some(revision)) = (&self.product, self.body.state.acknowledged()) {
            self.requests
                .update_fit(product.id, revision, |_| super::ResultFit::Failed);
        }
        output
            .events
            .push(SizeRecommendationEvent::Failed { error }.into());
    }
}
