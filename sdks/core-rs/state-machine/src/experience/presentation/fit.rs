//! The fit details drawn over a result image: one callout per measured
//! dimension, at the anchor the backend projected for it.

use crate::{Fit, FitAxis, FitAxisScore, ResultFit, ResultFitAnchor, ResultSubjectBand, TryOn};

/// One fit detail at fractional coordinates within its result image.
///
/// The host names it from its catalog by `axis` (for example "Sleeve
/// length"), never by the garment's own name for the measurement, which is a
/// technical point of measure.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ResultFitCallout {
    pub key: String,
    pub x: f64,
    pub y: f64,
    /// The measurement, for the host's name of it.
    pub axis: FitAxis,
    pub fit: Fit,
    pub is_length: bool,
}

/// The result's fit callouts: one per measured dimension, even when the
/// backend anchored it on both sides (the sleeves). The verdict is the most
/// severe of that dimension's measurements; of its anchors, the one beside
/// the fewest other callouts is kept.
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn result_fit_callouts(result: TryOn) -> Vec<ResultFitCallout> {
    let Some(ResultFit::Ready { axes, .. }) = result.fit else {
        return Vec::new();
    };
    let anchors = result.fit_anchors.unwrap_or_default();
    let center = subject_center(result.subject_bands.as_deref(), &anchors);

    // The dimensions in the order the backend first anchored them.
    let mut groups: Vec<(&str, Vec<&ResultFitAnchor>, &FitAxisScore)> = Vec::new();
    for anchor in &anchors {
        if let Some((_, members, _)) = groups
            .iter_mut()
            .find(|(dimension, ..)| *dimension == anchor.dimension)
        {
            members.push(anchor);
        } else if let Some(axis) = most_severe(&axes, &anchor.dimension) {
            groups.push((&anchor.dimension, vec![anchor], axis));
        }
    }

    // Single anchors are fixed; a paired dimension then takes the side that
    // leaves its callout least crowded.
    let mut placed: Vec<(f64, f64)> = groups
        .iter()
        .filter(|(_, members, _)| members.len() == 1)
        .map(|(_, members, _)| (members[0].x, members[0].y))
        .collect();
    groups
        .iter()
        .map(|(dimension, members, axis)| {
            let anchor = if let [only] = members.as_slice() {
                *only
            } else {
                let chosen = least_crowded(members, &placed, center);
                placed.push((chosen.x, chosen.y));
                chosen
            };
            ResultFitCallout {
                key: (*dimension).to_owned(),
                x: anchor.x,
                y: anchor.y,
                axis: axis.axis,
                fit: axis.fit,
                is_length: matches!(
                    axis.axis,
                    FitAxis::TotalLength | FitAxis::SleeveLength | FitAxis::Inseam
                ),
            }
        })
        .collect()
}

/// How far a fit is from ideal: a too-tight or too-loose verdict outranks a
/// slight one.
fn severity(fit: Fit) -> u8 {
    match fit {
        Fit::Ideal => 0,
        Fit::RunsTight | Fit::RunsLoose => 1,
        Fit::TooSmall | Fit::TooLoose => 2,
    }
}

/// The dimension's most severe measurement; the first on a tie.
fn most_severe<'a>(axes: &'a [FitAxisScore], dimension: &str) -> Option<&'a FitAxisScore> {
    axes.iter()
        .filter(|axis| axis.dimension.as_deref() == Some(dimension))
        .fold(None, |best: Option<&FitAxisScore>, axis| match best {
            Some(best) if severity(best.fit) >= severity(axis.fit) => Some(best),
            _ => Some(axis),
        })
}

/// Where the person stands: the middle of their outline, or of the anchors
/// without one. Callouts left of it go in the left column.
fn subject_center(bands: Option<&[ResultSubjectBand]>, anchors: &[ResultFitAnchor]) -> f64 {
    let (left, right) = match bands {
        Some(bands) if !bands.is_empty() => bands
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(left, right), band| {
                (left.min(band.left), right.max(band.right))
            }),
        _ => anchors.iter().fold(
            (f64::INFINITY, f64::NEG_INFINITY),
            |(left, right), anchor| (left.min(anchor.x), right.max(anchor.x)),
        ),
    };
    if left.is_finite() && right.is_finite() {
        (left + right) / 2.0
    } else {
        0.5
    }
}

/// The anchor whose column holds the fewest other callouts; on a tie, the one
/// furthest (vertically) from its column's nearest callout, then the first.
fn least_crowded<'a>(
    members: &[&'a ResultFitAnchor],
    placed: &[(f64, f64)],
    center: f64,
) -> &'a ResultFitAnchor {
    let crowding = |anchor: &ResultFitAnchor| {
        let left = anchor.x < center;
        let column: Vec<f64> = placed
            .iter()
            .filter(|(x, _)| (*x < center) == left)
            .map(|(_, y)| (y - anchor.y).abs())
            .collect();
        let nearest = column.iter().copied().fold(f64::INFINITY, f64::min);
        (column.len(), nearest)
    };
    let mut best = members[0];
    let mut best_crowding = crowding(best);
    for &anchor in &members[1..] {
        let (count, nearest) = crowding(anchor);
        if count < best_crowding.0 || (count == best_crowding.0 && nearest > best_crowding.1) {
            best = anchor;
            best_crowding = (count, nearest);
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{FitScore, HeightCm, ImageUrl, TryOnId, TryOnKey, VariantId};

    fn axis(axis: FitAxis, dimension: &str, fit: Fit, label: &str) -> FitAxisScore {
        FitAxisScore {
            axis,
            fit,
            dimension: Some(dimension.to_owned()),
            label: Some(label.to_owned()),
        }
    }

    fn anchor(dimension: &str, side: Option<&str>, x: f64, y: f64) -> ResultFitAnchor {
        ResultFitAnchor {
            dimension: dimension.to_owned(),
            side: side.map(str::to_owned),
            x,
            y,
        }
    }

    fn result(
        axes: Vec<FitAxisScore>,
        anchors: Vec<ResultFitAnchor>,
        bands: Option<Vec<ResultSubjectBand>>,
    ) -> TryOn {
        TryOn {
            id: TryOnId::try_from("00000000-0000-7000-8000-000000000001".to_owned()).unwrap(),
            key: TryOnKey {
                body_revision: crate::BodyRevision(1),
                variant_id: VariantId::try_from("00000000-0000-7000-8000-000000000002".to_owned())
                    .unwrap(),
            },
            height: HeightCm::from(175.0),
            image_url: ImageUrl::from("https://images.example.test/result.webp".to_owned()),
            fit: Some(ResultFit::Ready {
                score: FitScore {
                    fit_match: crate::FitMatch(0.8),
                    fit: Fit::Ideal,
                },
                axes,
            }),
            fit_anchors: Some(anchors),
            subject_bands: bands,
        }
    }

    fn tee_axes(sleeve: Fit) -> Vec<FitAxisScore> {
        vec![
            axis(
                FitAxis::Chest,
                "chest",
                Fit::RunsTight,
                "d 1/2 chest width (2cm below sleeve)",
            ),
            axis(
                FitAxis::SleeveLength,
                "sleeve_length",
                sleeve,
                "i sleeve length outside",
            ),
            axis(
                FitAxis::TotalLength,
                "total_length",
                Fit::Ideal,
                "a front body length from HSP",
            ),
        ]
    }

    #[test]
    fn a_paired_dimension_shows_one_callout() {
        let callouts = result_fit_callouts(result(
            tee_axes(Fit::RunsLoose),
            vec![
                anchor("chest", None, 0.42, 0.35),
                anchor("sleeve_length", Some("left"), 0.25, 0.6),
                anchor("sleeve_length", Some("right"), 0.75, 0.6),
                anchor("total_length", None, 0.5, 0.7),
            ],
            None,
        ));
        let keys: Vec<&str> = callouts.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(keys, ["chest", "sleeve_length", "total_length"]);
        let sleeve = &callouts[1];
        assert_eq!(sleeve.axis, FitAxis::SleeveLength);
        assert_eq!(sleeve.fit, Fit::RunsLoose);
        assert!(sleeve.is_length);
    }

    #[test]
    fn the_paired_callout_takes_the_emptier_column() {
        // The chest sits left of the person's middle, so the right sleeve's
        // column is empty and the right sleeve is kept.
        let callouts = result_fit_callouts(result(
            tee_axes(Fit::Ideal),
            vec![
                anchor("chest", None, 0.4, 0.35),
                anchor("sleeve_length", Some("left"), 0.3, 0.6),
                anchor("sleeve_length", Some("right"), 0.7, 0.6),
            ],
            Some(vec![ResultSubjectBand {
                top: 0.1,
                bottom: 0.9,
                left: 0.3,
                right: 0.7,
            }]),
        ));
        let sleeve = callouts.iter().find(|c| c.key == "sleeve_length").unwrap();
        assert_eq!((sleeve.x, sleeve.y), (0.7, 0.6));

        // Mirrored, the left one is.
        let callouts = result_fit_callouts(result(
            tee_axes(Fit::Ideal),
            vec![
                anchor("chest", None, 0.6, 0.35),
                anchor("sleeve_length", Some("left"), 0.3, 0.6),
                anchor("sleeve_length", Some("right"), 0.7, 0.6),
            ],
            None,
        ));
        let sleeve = callouts.iter().find(|c| c.key == "sleeve_length").unwrap();
        assert_eq!((sleeve.x, sleeve.y), (0.3, 0.6));
    }

    #[test]
    fn a_tie_keeps_the_side_furthest_from_its_neighbours() {
        // Side view: both sleeves on the right, beside a chest callout at the
        // same height as the upper one, and a hem callout on the left.
        let callouts = result_fit_callouts(result(
            tee_axes(Fit::Ideal),
            vec![
                anchor("chest", None, 0.62, 0.4),
                anchor("sleeve_length", Some("left"), 0.66, 0.42),
                anchor("sleeve_length", Some("right"), 0.68, 0.62),
                anchor("total_length", None, 0.3, 0.8),
            ],
            None,
        ));
        let sleeve = callouts.iter().find(|c| c.key == "sleeve_length").unwrap();
        assert_eq!((sleeve.x, sleeve.y), (0.68, 0.62));
    }

    #[test]
    fn the_most_severe_measurement_of_a_dimension_is_shown() {
        let mut axes = tee_axes(Fit::Ideal);
        axes.push(axis(
            FitAxis::SleeveLength,
            "sleeve_length",
            Fit::TooLoose,
            "sleeve length from CB",
        ));
        axes.push(axis(
            FitAxis::SleeveLength,
            "sleeve_length",
            Fit::RunsTight,
            "sleeve length inside",
        ));
        let callouts = result_fit_callouts(result(
            axes,
            vec![anchor("sleeve_length", Some("left"), 0.25, 0.6)],
            None,
        ));
        assert_eq!(callouts.len(), 1);
        assert_eq!(callouts[0].fit, Fit::TooLoose);
    }

    #[test]
    fn anchors_without_a_measurement_and_unready_fits_show_nothing() {
        let callouts = result_fit_callouts(result(
            tee_axes(Fit::Ideal),
            vec![anchor("waist", None, 0.5, 0.5)],
            None,
        ));
        assert!(callouts.is_empty());

        let mut pending = result(
            tee_axes(Fit::Ideal),
            vec![anchor("chest", None, 0.5, 0.4)],
            None,
        );
        pending.fit = Some(ResultFit::Pending);
        assert!(result_fit_callouts(pending).is_empty());
    }
}
