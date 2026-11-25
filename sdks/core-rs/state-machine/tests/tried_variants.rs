//! Variants already tried on: the picker marks them, and choosing one shows
//! its result at once, from the picker or from the storefront.

mod common;

use common::*;
use state_machine::*;

const SIZES: [&str; 3] = ["S", "M", "L"];
const COLORS: [&str; 2] = ["navy", "sand"];

/// A shirt in S to L and two colors, with navy M the host's.
fn shirt() -> FlowConfig {
    FlowConfig {
        host_product: HostProduct {
            label_formats: vec![],
            product: Product {
                id: id("shirt"),
                variants: COLORS
                    .iter()
                    .flat_map(|color| {
                        SIZES.iter().map(move |size| Variant {
                            id: id(&format!("{color}-{size}")),
                            foreign_ids: foreign(&[("colorway", color), ("size", size)]),
                        })
                    })
                    .collect(),
            },
            axes: vec![
                VariantAxis {
                    role: Some(AxisRole::Size),
                    ..axis("size", &SIZES)
                },
                VariantAxis {
                    role: Some(AxisRole::Color),
                    ..axis("colorway", &COLORS)
                },
            ],
            variant_id: id("navy-M"),
            chosen_axes: vec!["size".into(), "colorway".into()],
        },
        ..flow_config()
    }
}

fn pick(f: &Fixture, axis: &str, item: &str) {
    f.flow
        .dispatch(
            SelectionAction::SelectItem {
                axis: axis.into(),
                item: item.into(),
            }
            .into(),
        )
        .unwrap();
}

/// Tries the selection on and lets the render finish as `name`.
fn try_on(f: &Fixture, name: &str) {
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    f.session
        .complete(Completion {
            operation: render_effect(&f.driver),
            outcome: TryOnOutcome::Created {
                try_on_id: id(name),
                image_url: format!("https://example.invalid/{name}").into(),
            }
            .into(),
        })
        .unwrap();
}

/// Each row's items as `key`, `key*` when selected, `key✓` when tried.
fn marks(f: &Fixture) -> Vec<Vec<String>> {
    f.flow
        .view()
        .unwrap()
        .selection()
        .rows
        .iter()
        .map(|row| {
            row.items
                .iter()
                .map(|item| {
                    format!(
                        "{}{}{}",
                        item.key,
                        if item.selected { "*" } else { "" },
                        if item.tried { "✓" } else { "" }
                    )
                })
                .collect()
        })
        .collect()
}

fn shown(f: &Fixture) -> Option<TryOnId> {
    displayed_try_on(f.flow.view().unwrap()).map(|result| result.id)
}

fn primary(f: &Fixture) -> Option<PrimaryTryOnAction> {
    f.flow.view().unwrap().presentation().primary_action
}

fn starts_a_try_on(f: &Fixture) -> bool {
    drain(&f.driver).iter().any(|effect| {
        matches!(
            effect,
            Effect::DomainEffect {
                effect: DomainEffect::Start {
                    job: Job::TryOn {
                        job: TryOnJob::Create { .. }
                    },
                    ..
                }
            }
        )
    })
}

#[test]
fn the_picker_marks_sizes_tried_in_the_selected_color_and_colors_tried_in_the_selected_size() {
    let f = Fixture::ready_with(shirt(), vec![]).0;
    assert_eq!(marks(&f), [vec!["S", "M*", "L"], vec!["navy*", "sand"]]);
    try_on(&f, "navy-M");
    assert_eq!(marks(&f), [vec!["S", "M*✓", "L"], vec!["navy*✓", "sand"]]);
    // An untried pick has no mark; the tried size keeps its own.
    pick(&f, "size", "L");
    assert_eq!(marks(&f), [vec!["S", "M✓", "L*"], vec!["navy*", "sand"]]);
    // In sand, nothing was tried.
    pick(&f, "colorway", "sand");
    assert_eq!(marks(&f), [vec!["S", "M", "L*"], vec!["navy", "sand*"]]);
    pick(&f, "size", "M");
    assert_eq!(marks(&f), [vec!["S", "M*", "L"], vec!["navy✓", "sand*"]]);
}

#[test]
fn choosing_a_tried_variant_shows_its_result_without_a_request() {
    let f = Fixture::ready_with(shirt(), vec![]).0;
    try_on(&f, "navy-M");
    // An untried pick keeps the picture and offers to try it.
    pick(&f, "size", "L");
    assert_eq!(shown(&f), Some(id("navy-M")));
    assert_eq!(
        primary(&f),
        Some(PrimaryTryOnAction::Try {
            variant_id: id("navy-L")
        })
    );
    try_on(&f, "navy-L");
    assert_eq!(shown(&f), Some(id("navy-L")));
    drain(&f.driver);
    // Back to M: its result at once, and the button says it is worn.
    pick(&f, "size", "M");
    assert_eq!(shown(&f), Some(id("navy-M")));
    assert_eq!(primary(&f), Some(PrimaryTryOnAction::AlreadyWearing));
    assert!(!starts_a_try_on(&f));
}

#[test]
fn choosing_a_tried_recommendation_shows_its_result_without_a_request() {
    let (f, _) = Fixture::ready_with(shirt(), vec![score(&[id("navy-M")], 0.9)]);
    try_on(&f, "navy-M");
    pick(&f, "size", "L");
    try_on(&f, "navy-L");
    drain(&f.driver);

    f.flow
        .dispatch(SizeRecommendationAction::Select.into())
        .unwrap();
    assert_eq!(shown(&f), Some(id("navy-M")));
    assert_eq!(primary(&f), Some(PrimaryTryOnAction::AlreadyWearing));
    assert!(!starts_a_try_on(&f));
}

#[test]
fn the_storefront_selection_wins_on_reopening_and_shows_a_tried_variant() {
    let f = Fixture::ready_with(shirt(), vec![]).0;
    try_on(&f, "navy-M");
    pick(&f, "size", "L");
    try_on(&f, "navy-L");
    f.flow.dispatch(PresenceAction::Close.into()).unwrap();
    let storefront = |size: &str| {
        f.flow
            .dispatch(
                SelectionAction::SetStorefrontSelection {
                    options: foreign(&[("colorway", "navy"), ("size", size)]),
                    installation: None,
                }
                .into(),
            )
            .unwrap();
    };
    // An untried size: the picker selects it, and the last result stays in view.
    storefront("S");
    f.flow.dispatch(PresenceAction::Open.into()).unwrap();
    assert_eq!(f.flow.view().unwrap().selection().variant_id, id("navy-S"));
    assert_eq!(shown(&f), Some(id("navy-L")));
    assert_eq!(
        primary(&f),
        Some(PrimaryTryOnAction::Try {
            variant_id: id("navy-S")
        })
    );
    assert_eq!(marks(&f)[0], ["S*", "M✓", "L✓"]);
    // A tried size: its result, without a request.
    f.flow.dispatch(PresenceAction::Close.into()).unwrap();
    drain(&f.driver);
    storefront("M");
    f.flow.dispatch(PresenceAction::Open.into()).unwrap();
    assert_eq!(shown(&f), Some(id("navy-M")));
    assert_eq!(primary(&f), Some(PrimaryTryOnAction::AlreadyWearing));
    assert!(!starts_a_try_on(&f));
}
