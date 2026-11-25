//! A size the fit gate refuses is not a dead end: the flow offers the next
//! size along the size run that can be tried on, and its primary action
//! selects that size and tries it on.

mod common;

use common::*;
use state_machine::*;

const SIZES: [&str; 5] = ["XS", "S", "M", "L", "XL"];

/// A shirt in black, XS to XL in the host's order, with `selection` picked.
fn shirt(selection: &str) -> FlowConfig {
    FlowConfig {
        host_product: HostProduct {
            label_formats: vec![],
            product: Product {
                id: id("shirt"),
                variants: SIZES
                    .iter()
                    .map(|size| Variant {
                        id: id(&format!("black-{size}")),
                        foreign_ids: foreign(&[("colorway", "black"), ("size", size)]),
                    })
                    .collect(),
            },
            axes: vec![
                axis("colorway", &["black"]),
                VariantAxis {
                    role: Some(AxisRole::Size),
                    ..axis("size", &SIZES)
                },
            ],
            variant_id: id(&format!("black-{selection}")),
            chosen_axes: vec!["size".into()],
        },
        ..flow_config()
    }
}

/// The first size the gate leaves alone, which the host selects.
fn host_size(gated: &[(&str, RefusalReason)]) -> &'static str {
    SIZES
        .into_iter()
        .find(|size| !gated.iter().any(|(refused, _)| refused == size))
        .unwrap()
}

/// The API's fit gate on `gated` sizes, `selection` picked by the shopper
/// in the picker; the host selected a size the gate leaves alone.
fn gated(selection: &str, gated: &[(&str, RefusalReason)]) -> Fixture {
    let f = gated_on_host(host_size(gated), gated);
    if selection != host_size(gated) {
        pick(&f, selection);
    }
    f
}

/// The shopper picks `size` in the picker.
fn pick(f: &Fixture, size: &str) {
    f.flow
        .dispatch(
            SelectionAction::SelectItem {
                axis: "size".into(),
                item: size.into(),
            }
            .into(),
        )
        .unwrap();
}

/// The shirt with the API's fit gate on `gated` sizes, `selection` the host's.
fn gated_on_host(selection: &str, gated: &[(&str, RefusalReason)]) -> Fixture {
    let (f, _) = Fixture::ready_with_recommendation(
        shirt(selection),
        SizeRecommendationOutcome::Ranked {
            scores: vec![],
            restrictions: gated
                .iter()
                .map(|&(size, reason)| SizeRestriction {
                    variant_id: id(&format!("black-{size}")),
                    reason,
                })
                .collect(),
            no_suitable_size: false,
            preferred: vec![],
        },
        config(),
    );
    f
}

const SMALL: RefusalReason = RefusalReason::GarmentTooSmall;
const LARGE: RefusalReason = RefusalReason::GarmentTooLarge;

fn next_fitting(f: &Fixture) -> Option<VariantId> {
    f.flow
        .view()
        .unwrap()
        .presentation()
        .next_fitting_variant_id
}

fn primary(f: &Fixture) -> Option<PrimaryTryOnAction> {
    f.flow.view().unwrap().presentation().primary_action
}

#[test]
fn a_size_too_small_offers_the_next_larger_size_that_can_be_tried_on() {
    // S is refused too, so the offer skips it: the next size that fits, not the best.
    let f = gated("XS", &[("XS", SMALL), ("S", SMALL)]);
    assert_eq!(next_fitting(&f), Some(id("black-M")));
    assert_eq!(
        primary(&f),
        Some(PrimaryTryOnAction::TryNextFitting {
            variant_id: id("black-M")
        })
    );
}

#[test]
fn a_size_too_large_offers_the_next_smaller_size() {
    let f = gated("XL", &[("XL", LARGE)]);
    assert_eq!(next_fitting(&f), Some(id("black-L")));
}

#[test]
fn sold_out_sizes_are_skipped() {
    let f = gated("XS", &[("XS", SMALL)]);
    f.flow
        .dispatch(
            SelectionAction::HostProductUpdated {
                host_product: shirt(host_size(&[("XS", SMALL)])).host_product,
                unavailable_variants: Some(vec![id("black-S")]),
            }
            .into(),
        )
        .unwrap();
    assert_eq!(next_fitting(&f), Some(id("black-M")));
}

#[test]
fn the_button_stays_closed_when_no_size_is_left_in_that_direction() {
    let f = gated("XL", &[("XL", SMALL)]);
    assert_eq!(next_fitting(&f), None);
    assert_eq!(
        primary(&f),
        Some(PrimaryTryOnAction::Unavailable {
            reason: Rejection::TryOnRefused { reason: SMALL }
        })
    );
}

#[test]
fn a_size_that_fits_offers_nothing() {
    let f = gated("M", &[("XS", SMALL)]);
    assert_eq!(next_fitting(&f), None);
    assert_eq!(
        primary(&f),
        Some(PrimaryTryOnAction::Try {
            variant_id: id("black-M")
        })
    );
}

#[test]
fn running_the_offer_selects_the_size_and_tries_it_on() {
    let f = gated("XS", &[("XS", SMALL)]);
    f.flow
        .dispatch(
            PresentationAction::RunPrimary {
                variant_id: id("black-S"),
            }
            .into(),
        )
        .unwrap();
    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("black-S"));
    let requested = drain(&f.driver)
        .into_iter()
        .find_map(|effect| match effect {
            Effect::DomainEffect {
                effect:
                    DomainEffect::Start {
                        job:
                            Job::TryOn {
                                job: TryOnJob::Create { key, .. },
                            },
                        ..
                    },
            } => Some(key.variant_id),
            _ => None,
        });
    assert_eq!(requested, Some(id("black-S")));
}

#[test]
fn a_stale_offer_is_refused() {
    let f = gated("XS", &[("XS", SMALL)]);
    assert!(
        f.flow
            .dispatch(
                PresentationAction::RunPrimary {
                    variant_id: id("black-L"),
                }
                .into(),
            )
            .is_err()
    );
    assert_eq!(
        f.flow.view().unwrap().selection().variant_id,
        id("black-XS")
    );
}

/// The host's size with the gate on `gated` sizes, the recommendation
/// preferring `preferred`, and auto-start armed; with the effects that
/// followed the recommendation.
fn recommended_on_host(
    selection: &str,
    gated: &[(&str, RefusalReason)],
    preferred: &str,
) -> (Fixture, Vec<Effect>) {
    let mut setup = FlowConfig {
        auto_start: AutoStartPolicy::ExplicitPreselection,
        ..shirt(selection)
    };
    // The page names its color and its size, the default one included.
    setup.host_product.chosen_axes = vec!["colorway".into(), "size".into()];
    Fixture::ready_with_recommendation(
        setup,
        SizeRecommendationOutcome::Ranked {
            scores: vec![score(&[id(&format!("black-{preferred}"))], 0.9)],
            restrictions: gated
                .iter()
                .map(|&(size, reason)| SizeRestriction {
                    variant_id: id(&format!("black-{size}")),
                    reason,
                })
                .collect(),
            no_suitable_size: false,
            preferred: vec![id(&format!("black-{preferred}"))],
        },
        config(),
    )
}

fn gate_switch(f: &Fixture) -> Option<GateSwitch> {
    f.flow.view().unwrap().presentation().gate_switch
}

/// The variant of the try-on these effects start, if one.
fn started(effects: &[Effect]) -> Option<VariantId> {
    effects.iter().find_map(|effect| match effect {
        Effect::DomainEffect {
            effect:
                DomainEffect::Start {
                    job:
                        Job::TryOn {
                            job: TryOnJob::Create { key, .. },
                        },
                    ..
                },
        } => Some(key.variant_id),
        _ => None,
    })
}

/// The try-on requests the session received, by variant, and the running one's operation.
fn requests(f: &Fixture) -> (Vec<VariantId>, Option<OperationId>) {
    let snapshot = f.session.snapshot().unwrap();
    let running = snapshot
        .try_on_requests
        .iter()
        .find_map(|request| match request.status {
            TryOnRequestStatus::Running { operation } => Some(operation),
            _ => None,
        });
    (
        snapshot
            .try_on_requests
            .iter()
            .map(|request| request.variant_id)
            .collect(),
        running,
    )
}

#[test]
fn the_hosts_default_size_wins_over_the_recommendation() {
    let (f, _) = recommended_on_host("XS", &[], "M");
    assert_eq!(
        f.flow.view().unwrap().selection().variant_id,
        id("black-XS")
    );
    assert_eq!(gate_switch(&f), None);
    // Every axis is the host's, so auto-start tries XS on, not the recommended M.
    assert_eq!(requests(&f).0, [id("black-XS")]);
}

#[test]
fn a_hosts_size_the_gate_refuses_gives_way_to_the_next_size_that_fits() {
    // S is refused too: the next size along the run that can be tried on is M,
    // not the recommended L.
    let (f, effects) = recommended_on_host("XS", &[("XS", SMALL), ("S", SMALL)], "L");
    assert_eq!(f.flow.view().unwrap().selection().variant_id, id("black-M"));
    assert_eq!(
        gate_switch(&f),
        Some(GateSwitch {
            from_variant_id: id("black-XS"),
            to_variant_id: id("black-M"),
            reason: SMALL,
        })
    );
    assert_eq!(
        primary(&f),
        Some(PrimaryTryOnAction::Try {
            variant_id: id("black-M")
        })
    );
    // The shopper did not ask for M: nothing starts by itself, and the flow
    // stops following the auto-started XS.
    assert_eq!(started(&effects), None);
    assert_eq!(started(&drain(&f.driver)), None);
    assert!(!requests(&f).0.contains(&id("black-M")));
    assert_eq!(f.flow.view().unwrap().presentation().foreground, None);
    // The note goes once the shopper picks another size.
    pick(&f, "L");
    assert_eq!(gate_switch(&f), None);
}

#[test]
fn a_size_the_shopper_picks_stays_with_the_next_size_offered() {
    let f = gated("XS", &[("XS", SMALL)]);
    assert_eq!(
        f.flow.view().unwrap().selection().variant_id,
        id("black-XS")
    );
    assert_eq!(gate_switch(&f), None);
    assert_eq!(
        primary(&f),
        Some(PrimaryTryOnAction::TryNextFitting {
            variant_id: id("black-S")
        })
    );
}

#[test]
fn a_hosts_size_the_api_refuses_on_auto_start_gives_way_without_repeating_the_refusal() {
    // No gate in the recommendation: auto-start tries the host's XS, which the API refuses.
    let (f, _) = recommended_on_host("XS", &[], "M");
    let operation = requests(&f).1.unwrap();
    f.session
        .complete(Completion {
            operation,
            outcome: TryOnOutcome::Refused { reason: SMALL }.into(),
        })
        .unwrap();
    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("black-S"));
    assert_eq!(
        gate_switch(&f),
        Some(GateSwitch {
            from_variant_id: id("black-XS"),
            to_variant_id: id("black-S"),
            reason: SMALL,
        })
    );
    // The note says it; the refused request is no longer followed.
    assert_eq!(view.presentation().foreground, None);
    assert_eq!(started(&drain(&f.driver)), None);
}

#[test]
fn a_hosts_size_the_shopper_tried_on_stays_when_the_api_refuses_it() {
    // Pressing "Try on M" makes M the shopper's: the refusal leaves it, and offers L.
    let f = gated_on_host("M", &[]);
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    let operation = requests(&f).1.unwrap();
    f.session
        .complete(Completion {
            operation,
            outcome: TryOnOutcome::Refused { reason: SMALL }.into(),
        })
        .unwrap();
    assert_eq!(f.flow.view().unwrap().selection().variant_id, id("black-M"));
    assert_eq!(gate_switch(&f), None);
    assert_eq!(
        primary(&f),
        Some(PrimaryTryOnAction::TryNextFitting {
            variant_id: id("black-L")
        })
    );
}

#[test]
fn a_restored_session_moves_a_refused_page_size_before_any_request_and_shows_a_tried_size() {
    // After a reload: the page's XS is refused by the gate, and M was tried before.
    let (f, _) = recommended_on_host("XS", &[("XS", SMALL), ("S", SMALL)], "L");
    // No request for the refused size, ever: the gate moved it before auto-start could.
    assert!(!requests(&f).0.contains(&id("black-XS")));
    assert_eq!(f.flow.view().unwrap().selection().variant_id, id("black-M"));
    f.flow
        .dispatch(
            PresentationAction::RestoreTryOns {
                try_ons: vec![RestoredTryOn {
                    try_on_id: id("earlier-M"),
                    product_id: id("shirt"),
                    variant_id: id("black-M"),
                    image_url: "https://example.invalid/earlier-M".into(),
                    backend_revision: "rev-175".into(),
                }],
            }
            .into(),
        )
        .unwrap();
    let view = f.flow.view().unwrap();
    assert_eq!(
        displayed_try_on(view.clone()).map(|t| t.id),
        Some(id("earlier-M"))
    );
    assert_eq!(primary(&f), Some(PrimaryTryOnAction::AlreadyWearing));
    assert_eq!(started(&drain(&f.driver)), None);
}

#[test]
fn a_page_following_the_shoppers_pick_keeps_it_the_shoppers() {
    // The shopper picks the refused XS; the page follows and sends it back as its selection.
    let f = gated("XS", &[("XS", SMALL)]);
    f.flow
        .dispatch(
            SelectionAction::SetStorefrontSelection {
                options: foreign(&[("colorway", "black"), ("size", "XS")]),
                installation: None,
            }
            .into(),
        )
        .unwrap();
    // No loop and no switch: the pick stays, and the button still offers the next size.
    assert_eq!(
        f.flow.view().unwrap().selection().variant_id,
        id("black-XS")
    );
    assert_eq!(gate_switch(&f), None);
    assert_eq!(
        primary(&f),
        Some(PrimaryTryOnAction::TryNextFitting {
            variant_id: id("black-S")
        })
    );
}
