//! Variants in the default experience: the rows the host's axes become,
//! choosing items, and size recommendations that keep chosen items and
//! skip refused sizes.

mod common;

use common::*;
use state_machine::*;

/// A jacket in black and red; red only in M.
fn jacket(selection: &str, chosen: &[&str]) -> FlowConfig {
    let variant = |colorway: &str, size: &str| Variant {
        id: id(&format!("{colorway}-{size}")),
        foreign_ids: foreign(&[("colorway", colorway), ("size", size)]),
    };
    FlowConfig {
        host_product: HostProduct {
            label_formats: vec![],
            product: Product {
                id: id("jacket"),
                variants: vec![
                    variant("black", "M"),
                    variant("black", "L"),
                    variant("red", "M"),
                ],
            },
            axes: vec![
                axis("colorway", &["black", "red"]),
                axis("size", &["M", "L", "XL"]),
            ],
            variant_id: id(selection),
            chosen_axes: chosen.iter().map(|&a| a.into()).collect(),
        },
        ..flow_config()
    }
}

fn size(variants: &[&str], fit_match: f64) -> SizeRecommendationScore {
    let ids: Vec<VariantId> = variants.iter().map(|&v| id(v)).collect();
    score(&ids, fit_match)
}

/// An unselected, available, unrefused item that selects `variant`.
fn shown(key: &str, variant: &str) -> VariantRowItem {
    VariantRowItem {
        key: key.into(),
        display: ItemDisplay::Text { text: key.into() },
        selected: false,
        available: true,
        variant_id: Some(id(variant)),
        refusal: None,
    }
}

#[test]
fn storefront_choices_update_the_picker_without_reinstalling_or_starting_a_render() {
    let (f, _) = Fixture::ready_with(
        jacket("black-L", &["size"]),
        vec![size(&["red-M"], 0.9), size(&["black-L"], 0.8)],
    );
    let before = f.flow.view().unwrap();
    f.flow.dispatch(PresenceAction::Close.into()).unwrap();
    let options = foreign(&[("colorway", "red")]);
    f.flow
        .dispatch(
            SelectionAction::SetStorefrontSelection {
                options: options.clone(),
                installation: None,
            }
            .into(),
        )
        .unwrap();
    f.flow.dispatch(PresenceAction::Open.into()).unwrap();
    let after = f.flow.view().unwrap();
    assert_eq!(after.selection().variant_id, id("red-M"));
    assert_eq!(
        after.selection().chosen_axes,
        vec![AxisKey::from("colorway")]
    );
    assert_eq!(after.product_installation, before.product_installation);
    assert_eq!(after.domain.body, before.domain.body);
    assert!(after.domain.try_on_requests.is_empty());

    for invalid in [
        foreign(&[("colorway", "red"), ("size", "L")]),
        foreign(&[("colorway", "unknown")]),
        options,
    ] {
        f.flow
            .dispatch(
                SelectionAction::SetStorefrontSelection {
                    options: invalid,
                    installation: None,
                }
                .into(),
            )
            .unwrap();
        assert_eq!(f.flow.view().unwrap(), after);
    }
}

#[test]
fn glyphs_are_host_displays_preserved_by_selection_projection() {
    let mut config = jacket("black-M", &["size"]);
    let display = ItemDisplay::Glyph {
        glyph: ItemGlyph::ShirtOpen,
        alt: "Offen".into(),
    };
    config.host_product.axes[0].items[1].display = display.clone();
    let (f, _) = Fixture::ready_with(config, vec![]);
    assert_eq!(
        f.flow.view().unwrap().selection().rows[0].items[1].display,
        display
    );
    f.flow
        .dispatch(
            SelectionAction::SelectItem {
                axis: "colorway".into(),
                item: "red".into(),
            }
            .into(),
        )
        .unwrap();
    let view = f.flow.view().unwrap();
    let red = &view.selection().rows[0].items[1];
    assert_eq!(red.display, display);
    assert!(red.selected);
    assert_eq!(view.selection().variant_id, id("red-M"));
}

#[test]
fn rows_show_what_each_item_selects() {
    let (f, _) = Fixture::ready_with(
        jacket("red-M", &["colorway", "size"]),
        vec![size(&["black-M", "red-M"], 0.9), size(&["black-L"], 0.7)],
    );
    let rows = f.flow.view().unwrap().selection().rows.clone();
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0].items,
        [
            shown("black", "black-M"),
            VariantRowItem {
                selected: true,
                ..shown("red", "red-M")
            },
        ]
    );
    // L exists only in black, and XL not at all.
    assert_eq!(
        rows[1].items,
        [
            VariantRowItem {
                selected: true,
                ..shown("M", "red-M")
            },
            VariantRowItem {
                available: false,
                ..shown("L", "black-L")
            },
            VariantRowItem {
                available: false,
                variant_id: None,
                ..shown("XL", "black-M")
            },
        ]
    );
}

#[test]
fn choosing_an_item_drops_the_chosen_items_it_changes() {
    let (f, _) = Fixture::ready_with(jacket("black-M", &["colorway"]), vec![]);
    let choose = |axis: &str, item: &str| {
        f.flow
            .dispatch(
                SelectionAction::SelectItem {
                    axis: axis.into(),
                    item: item.into(),
                }
                .into(),
            )
            .unwrap()
            .view
    };
    let view = choose("size", "L");
    assert_eq!(view.selection().variant_id, id("black-L"));
    assert_eq!(
        view.selection().chosen_axes,
        [AxisKey::from("colorway"), "size".into()]
    );
    // Red comes only in M: the size changes, so it is no longer chosen.
    let view = choose("colorway", "red");
    assert_eq!(view.selection().variant_id, id("red-M"));
    assert_eq!(view.selection().chosen_axes, [AxisKey::from("colorway")]);
    assert!(
        f.flow
            .dispatch(
                SelectionAction::SelectItem {
                    axis: "size".into(),
                    item: "XL".into(),
                }
                .into()
            )
            .is_err()
    );
}

#[test]
fn recommendations_keep_the_chosen_colorway() {
    let sizes = || vec![size(&["black-L"], 0.9), size(&["black-M", "red-M"], 0.8)];
    // L is best, but red has no L: the best size in red is M.
    let (f, _) = Fixture::ready_with(jacket("red-M", &["colorway"]), sizes());
    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("red-M"));
    assert!(view.selection().recommended);
    // With nothing chosen, the best size wins whatever its colorway.
    let (f, _) = Fixture::ready_with(jacket("red-M", &[]), sizes());
    assert_eq!(f.flow.view().unwrap().selection().variant_id, id("black-L"));
}

#[test]
fn the_recommendation_shortcut_replaces_an_explicit_size_and_keeps_the_chosen_color() {
    let mut config = jacket("black-M", &["size", "colorway"]);
    config.host_product.axes[1].role = Some(AxisRole::Size);
    let (f, _) = Fixture::ready_with(
        config,
        vec![size(&["black-L"], 0.9), size(&["black-M", "red-M"], 0.8)],
    );
    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("black-M"));
    assert_eq!(view.selection().recommended_variant_id, Some(id("black-L")));

    let view = f
        .flow
        .dispatch(SizeRecommendationAction::Select.into())
        .unwrap()
        .view;
    assert_eq!(view.selection().variant_id, id("black-L"));
    assert_eq!(view.presentation().foreground, None);

    assert_eq!(view.selection().recommended_variant_id, Some(id("black-L")));
}

#[test]
fn the_host_shows_every_axis_once() {
    let session = TryOnSession::new(config()).unwrap();
    let mut missing = jacket("red-M", &[]);
    missing.host_product.axes = vec![axis("colorway", &["black", "red"])];
    assert!(DefaultTryOnFlow::new(session.clone(), missing).is_err());
    let mut repeated = jacket("red-M", &[]);
    repeated.host_product.axes = vec![
        axis("colorway", &["black", "black"]),
        axis("size", &["M", "L"]),
    ];
    assert!(DefaultTryOnFlow::new(session, repeated).is_err());
}

#[test]
fn a_refused_variant_skips_its_whole_size() {
    // M is best; black-M is refused, so red-M is not seeded either.
    let (f, _) = Fixture::ready_with(
        jacket("black-M", &[]),
        vec![size(&["black-M", "red-M"], 0.9), size(&["black-L"], 0.7)],
    );
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    let operation = drain(&f.driver)
        .iter()
        .find_map(|e| match e {
            Effect::DomainEffect {
                effect:
                    DomainEffect::Start {
                        operation,
                        job:
                            Job::TryOn {
                                job: TryOnJob::Create { key, .. },
                            },
                    },
            } if key.variant_id == id("black-M") => Some(*operation),
            _ => None,
        })
        .expect("black-M tried on");
    f.session
        .complete(Completion {
            operation,
            outcome: TryOnOutcome::Refused {
                reason: RefusalReason::GarmentTooSmall,
            }
            .into(),
        })
        .unwrap();
    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("black-L"));
    // The rows mark only the variant refused: red-M was never tried.
    let item = |row: usize, key: &str| {
        view.selection().rows[row]
            .items
            .iter()
            .find(|i| i.key.0 == key)
            .cloned()
            .unwrap()
    };
    let m = item(1, "M");
    assert_eq!(m.variant_id, Some(id("black-M")));
    assert_eq!(m.refusal, Some(RefusalReason::GarmentTooSmall));
    let red = item(0, "red");
    assert_eq!(red.variant_id, Some(id("red-M")));
    assert_eq!(red.refusal, None);
}

#[test]
fn the_host_sending_its_product_again_changes_nothing() {
    let config = jacket("black-M", &["colorway"]);
    let (f, _) = Fixture::ready_with(config.clone(), vec![size(&["black-M"], 0.9)]);
    f.flow
        .dispatch(
            SelectionAction::SelectItem {
                axis: "size".into(),
                item: "L".into(),
            }
            .into(),
        )
        .unwrap();
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    drain(&f.driver);
    let before = f.flow.view().unwrap();
    let after = f
        .flow
        .dispatch(
            SelectionAction::HostProductUpdated {
                unavailable_variants: None,
                host_product: config.host_product,
            }
            .into(),
        )
        .unwrap()
        .view;
    // The shopper's choice and the try-on they asked for stay.
    assert!(drain(&f.driver).is_empty());
    assert_eq!(after.selection(), before.selection());
    assert_eq!(after.selection().variant_id, id("black-L"));
    assert!(after.presentation().foreground.is_some());
}

#[test]
fn a_refusal_suggestion_preserves_the_requested_color_after_the_draft_changes() {
    let mut config = jacket("red-M", &["colorway", "size"]);
    config.host_product.product.variants.push(Variant {
        id: id("red-L"),
        foreign_ids: foreign(&[("colorway", "red"), ("size", "L")]),
    });
    let (f, _) = Fixture::ready_with(config, vec![]);
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    let operation = drain(&f.driver)
        .into_iter()
        .find_map(|effect| match effect {
            Effect::DomainEffect {
                effect:
                    DomainEffect::Start {
                        operation,
                        job: Job::TryOn { .. },
                    },
            } => Some(operation),
            _ => None,
        })
        .unwrap();
    f.flow
        .dispatch(
            SelectionAction::SelectItem {
                axis: "colorway".into(),
                item: "black".into(),
            }
            .into(),
        )
        .unwrap();

    f.session
        .complete(Completion {
            operation,
            outcome: TryOnOutcome::RefusedWithAlternative {
                reason: RefusalReason::GarmentTooSmall,
                alternative: foreign(&[("size", "L")]),
            }
            .into(),
        })
        .unwrap();

    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("black-M"));
    assert_eq!(view.presentation().suggested_variant_id, Some(id("red-L")));
}
