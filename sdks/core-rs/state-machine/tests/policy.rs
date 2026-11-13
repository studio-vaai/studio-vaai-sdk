//! The default experience's policies: recommendation seeding and
//! auto-start.

mod common;

use common::*;
use state_machine::*;

fn advice(size: &str, fit_match: f64) -> SizeRecommendationScore {
    score(&[id(size)], fit_match)
}

/// The try-ons `effects` start: each operation and its variant.
fn started(effects: &[Effect]) -> Vec<(OperationId, VariantId)> {
    effects
        .iter()
        .filter_map(|e| match e {
            Effect::DomainEffect {
                effect:
                    DomainEffect::Start {
                        operation,
                        job:
                            Job::TryOn {
                                job: TryOnJob::Create { key, .. },
                            },
                    },
            } => Some((*operation, key.variant_id)),
            _ => None,
        })
        .collect()
}

fn rendered(effects: &[Effect]) -> Vec<VariantId> {
    started(effects).into_iter().map(|(_, v)| v).collect()
}

#[test]
fn a_recommendation_replaces_a_host_default_without_auto_start() {
    let (f, effects) = Fixture::ready_with(
        FlowConfig {
            host_product: HostProduct {
                chosen_axes: vec![],
                ..host_product()
            },
            auto_start: AutoStartPolicy::ExplicitPreselection,
        },
        vec![advice("M", 0.7), advice("L", 0.9)],
    );
    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("L"));
    assert!(view.selection().recommended);
    assert!(rendered(&effects).is_empty());
}

#[test]
fn an_explicit_preselection_auto_starts_and_keeps_its_size() {
    let (f, _) = Fixture::ready_with(
        FlowConfig {
            auto_start: AutoStartPolicy::ExplicitPreselection,
            ..flow_config()
        },
        vec![advice("L", 0.9)],
    );
    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("M"));
    assert!(!view.selection().recommended);
    let foreground = view
        .presentation()
        .foreground
        .as_ref()
        .expect("an automatic request");
    assert_eq!(foreground.variant_id, id("M"));
    assert_eq!(foreground.state, ForegroundTryOnState::Rendering);
}

#[test]
fn a_refused_recommended_size_is_seeded_no_more() {
    let (f, _) = Fixture::ready_with(
        FlowConfig {
            host_product: HostProduct {
                chosen_axes: vec![],
                ..host_product()
            },
            ..flow_config()
        },
        vec![advice("L", 0.9), advice("M", 0.7)],
    );
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    let [(operation, variant)] = started(&drain(&f.driver))[..] else {
        panic!("one requested try-on");
    };
    assert_eq!(variant, id("L"));
    let refusal = RefusalReason::GarmentTooSmall;
    f.session
        .complete(Completion {
            operation,
            outcome: TryOnOutcome::Refused { reason: refusal }.into(),
        })
        .unwrap();
    // The next best size is seeded, and not tried on: auto-start is once.
    assert!(rendered(&drain(&f.driver)).is_empty());
    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("M"));
    assert!(view.selection().recommended);
    assert_eq!(
        view.presentation().can_request_try_on,
        Capability::Available
    );
    assert_eq!(view.issue, Some(Issue::TryOnRefused { reason: refusal }));
    let l = view.selection().rows[0]
        .items
        .iter()
        .find(|i| i.key.0 == "L");
    assert_eq!(l.and_then(|i| i.refusal), Some(refusal));
    // Choosing the refused size again cannot try it on.
    let view = f
        .flow
        .dispatch(
            SelectionAction::SelectItem {
                axis: "size".into(),
                item: "L".into(),
            }
            .into(),
        )
        .unwrap()
        .view;
    let refused = Rejection::TryOnRefused { reason: refusal };
    assert_eq!(
        view.presentation().can_request_try_on,
        Capability::Unavailable { reason: refused }
    );
    // The action agrees with the capability.
    assert_eq!(
        f.flow
            .dispatch(PresentationAction::RequestTryOn.into())
            .unwrap_err(),
        TryOnError::Rejected { reason: refused }
    );
}

/// Back to the height and a new one confirmed and acknowledged, with the
/// recommendation fetch that follows.
fn new_height(f: &Fixture) -> OperationId {
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    f.flow
        .dispatch(
            HeightAction::Edit {
                height: HeightCm(180.0),
            }
            .into(),
        )
        .unwrap();
    f.flow.dispatch(HeightAction::Confirm.into()).unwrap();
    let operation = f
        .session
        .snapshot()
        .unwrap()
        .body
        .height()
        .and_then(HeightStatus::outstanding)
        .unwrap();
    f.session
        .complete(Completion {
            operation,
            outcome: BodyOutcome::HeightSet.into(),
        })
        .unwrap();
    fetch_started(&f.driver)
}

/// The recommendation fetch the pending effects start.
fn fetch_started(driver: &EffectDriver) -> OperationId {
    drain(driver)
        .into_iter()
        .find_map(|e| match e {
            Effect::DomainEffect {
                effect:
                    DomainEffect::Start {
                        operation,
                        job:
                            Job::SizeRecommendation {
                                job: SizeRecommendationJob::Fetch { .. },
                            },
                    },
            } => Some(operation),
            _ => None,
        })
        .expect("a recommendation fetch")
}

fn recommended_flow() -> Fixture {
    let (f, _) = Fixture::ready_with(
        FlowConfig {
            host_product: HostProduct {
                chosen_axes: vec![],
                ..host_product()
            },
            ..flow_config()
        },
        vec![advice("L", 0.9)],
    );
    f
}

#[test]
fn a_selection_is_recommended_only_by_the_current_recommendation() {
    let f = recommended_flow();
    assert!(f.flow.view().unwrap().selection().recommended);
    let fetch = new_height(&f);
    // The old recommendation went with the old height.
    let view = f.flow.view().unwrap();
    assert_eq!(view.domain.size_recommendation, None);
    assert!(!view.selection().recommended);
    f.session
        .complete(Completion {
            operation: fetch,
            outcome: SizeRecommendationOutcome::Fetched {
                scores: vec![advice("XL", 0.8)],
            }
            .into(),
        })
        .unwrap();
    let view = f.flow.view().unwrap();
    assert!(view.selection().recommended);
    assert_eq!(view.selection().variant_id, id("XL"));
}

#[test]
fn a_recommendation_that_arrives_clears_its_failure() {
    let f = recommended_flow();
    let fetch = new_height(&f);
    f.session
        .complete(Completion {
            operation: fetch,
            outcome: Outcome::Failed {
                error: BackendError::Unavailable,
            },
        })
        .unwrap();
    assert_eq!(
        f.flow.view().unwrap().issue,
        Some(Issue::SizeRecommendationFailed {
            error: BackendError::Unavailable
        })
    );
    f.flow
        .dispatch(SizeRecommendationAction::Retry.into())
        .unwrap();
    let retry = fetch_started(&f.driver);
    f.session
        .complete(Completion {
            operation: retry,
            outcome: SizeRecommendationOutcome::Fetched {
                scores: vec![advice("L", 0.9)],
            }
            .into(),
        })
        .unwrap();
    assert_eq!(f.flow.view().unwrap().issue, None);
}

#[test]
fn a_recommendation_that_arrives_under_the_picker_is_seeded_when_it_closes() {
    let f = recommended_flow();
    let fetch = new_height(&f);
    replace_with_library(&f);
    let Some(Modal::Picker { token }) = f.flow.view().unwrap().modal else {
        panic!("no picker");
    };
    f.session
        .complete(Completion {
            operation: fetch,
            outcome: SizeRecommendationOutcome::Fetched {
                scores: vec![advice("XL", 0.8)],
            }
            .into(),
        })
        .unwrap();
    f.flow
        .complete_device(PickerEvent::Cancelled { token }.into())
        .unwrap();
    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("XL"));
    assert!(view.selection().recommended);
}
