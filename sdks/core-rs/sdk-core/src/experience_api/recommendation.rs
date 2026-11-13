use std::collections::{HashMap, HashSet};

use api::{RecommendedSize, SizeRecommendationGate};
use state_machine::{
    BackendError, Fit, FitAxis, FitAxisScore, FitMatch, FitScore, Outcome, Product, RefusalReason,
    SizeRecommendationOutcome, SizeRecommendationScore, VariantId,
};

use state_machine::domain::SizeRestriction;

use super::outcomes::{failed, foreign_ids};

#[derive(uniffi::Record)]
pub struct RankedRecommendation {
    pub scores: Vec<SizeRecommendationScore>,
    pub restrictions: Vec<SizeRestriction>,
    pub no_suitable_size: bool,
    pub preferred: Vec<VariantId>,
}

#[uniffi::export]
pub fn normalize_recommendation(product: Product, result: RecommendedSize) -> RankedRecommendation {
    normalize(&product, result)
}

fn normalize(product: &Product, result: RecommendedSize) -> RankedRecommendation {
    let matching = |items: HashMap<String, String>| {
        if items.is_empty() {
            return Vec::new();
        }
        let items = foreign_ids(items);
        product
            .variants
            .iter()
            .filter(|variant| {
                items
                    .iter()
                    .all(|(axis, item)| variant.foreign_ids.get(axis) == Some(item))
            })
            .map(|variant| variant.id)
            .collect()
    };
    let no_suitable_size =
        result.recommended_foreign_ids.is_none() && !result.recommendations.is_empty();
    let preferred = result
        .recommended_foreign_ids
        .map_or_else(Vec::new, matching);
    let mut recommendations = result.recommendations;
    recommendations.sort_by_key(|entry| entry.rank);
    let mut matched = HashSet::new();
    let mut scores = Vec::new();
    let mut restrictions = Vec::new();
    for entry in recommendations {
        let variant_ids: Vec<_> = matching(entry.foreign_ids)
            .into_iter()
            .filter(|id| !matched.contains(id))
            .collect();
        if variant_ids.is_empty() {
            continue;
        }
        match entry.gate {
            Some(SizeRecommendationGate::TooSmall | SizeRecommendationGate::TooLarge) => {
                let reason = if entry.gate == Some(SizeRecommendationGate::TooSmall) {
                    RefusalReason::GarmentTooSmall
                } else {
                    RefusalReason::GarmentTooLarge
                };
                matched.extend(variant_ids.iter().copied());
                restrictions.extend(
                    variant_ids
                        .into_iter()
                        .map(|variant_id| SizeRestriction { variant_id, reason }),
                );
            }
            Some(SizeRecommendationGate::Unknown { .. }) => {}
            None => {
                let Some(fit) = read_fit(&entry.fit) else {
                    continue;
                };
                if !(0..=100).contains(&entry.fit_match) {
                    continue;
                }
                matched.extend(variant_ids.iter().copied());
                let axes = entry
                    .fit_checks
                    .into_iter()
                    .filter_map(|check| {
                        Some(FitAxisScore {
                            axis: axis(&check.dimension),
                            dimension: Some(check.dimension),
                            label: Some(check.label),
                            fit: read_fit(&check.fit)?,
                        })
                    })
                    .collect();
                scores.push(SizeRecommendationScore {
                    variant_ids,
                    aggregate: FitScore {
                        fit,
                        fit_match: FitMatch(f64::from(entry.fit_match) / 100.0),
                    },
                    axes,
                });
            }
        }
    }
    RankedRecommendation {
        scores,
        restrictions,
        no_suitable_size,
        preferred,
    }
}

#[uniffi::export]
pub fn recommendation_outcome(
    product: Product,
    result: RecommendedSize,
    expected_revision: String,
) -> Outcome {
    if result.body_revision_id.as_deref() != Some(&expected_revision) {
        return failed(BackendError::Unavailable);
    }
    let RankedRecommendation {
        scores,
        restrictions,
        no_suitable_size,
        preferred,
    } = normalize(&product, result);
    SizeRecommendationOutcome::Ranked {
        scores,
        restrictions,
        no_suitable_size,
        preferred,
    }
    .into()
}

fn read_fit(value: &str) -> Option<Fit> {
    Some(match value {
        "too_small" => Fit::TooSmall,
        "runs_tight" => Fit::RunsTight,
        "ideal" => Fit::Ideal,
        "runs_loose" => Fit::RunsLoose,
        "too_loose" => Fit::TooLoose,
        _ => return None,
    })
}

fn axis(dimension: &str) -> FitAxis {
    match dimension {
        "chest" => FitAxis::Chest,
        "waist" => FitAxis::Waist,
        "hip" => FitAxis::Hip,
        "bottom" => FitAxis::Bottom,
        "total_length" => FitAxis::TotalLength,
        "sleeve_length" => FitAxis::SleeveLength,
        "shoulder_width" => FitAxis::ShoulderWidth,
        "inseam" => FitAxis::Inseam,
        _ => FitAxis::Other,
    }
}
