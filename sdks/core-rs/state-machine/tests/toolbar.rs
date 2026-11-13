//! Display hints and result companions belong to the shared experience.
mod common;
use common::*;
use state_machine::*;

fn styled(styles: &[&str]) -> FlowConfig {
    let mut wearing = axis("wearing", styles);
    wearing.display_options = Some(AxisDisplayOptions {
        control: AxisControl::Segmented,
        placement: AxisPlacement::ResultToolbar,
    });
    FlowConfig {
        host_product: HostProduct {
            label_formats: vec![],
            product: Product {
                id: id("shirt"),
                variants: ["M", "L"]
                    .into_iter()
                    .flat_map(|size| {
                        styles.iter().map(move |style| Variant {
                            id: id(&format!("{size}-{style}")),
                            foreign_ids: foreign(&[("size", size), ("wearing", style)]),
                        })
                    })
                    .collect(),
            },
            axes: vec![axis("size", &["M", "L"]), wearing],
            variant_id: id("M-closed"),
            chosen_axes: vec!["size".into()],
        },
        ..flow_config()
    }
}

fn renders(f: &Fixture) -> Vec<(OperationId, TryOnKey)> {
    drain(&f.driver)
        .into_iter()
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
            } => Some((operation, key)),
            _ => None,
        })
        .collect()
}
fn finish(f: &Fixture, op: OperationId, name: &str) {
    f.session
        .complete(Completion {
            operation: op,
            outcome: TryOnOutcome::Created {
                try_on_id: id(name),
                image_url: format!("https://example.invalid/{name}").into(),
            }
            .into(),
        })
        .unwrap();
}
fn begin(f: &Fixture) -> Vec<(OperationId, TryOnKey)> {
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    let work = renders(f);
    assert_eq!(work.len(), 1);
    finish(f, work[0].0, "closed-result");
    renders(f)
}
fn shown(f: &Fixture) -> DisplayedImage {
    f.flow.view().unwrap().presentation().displayed
}

#[test]
fn toolbar_projects_displayed_variant_and_cached_switch_leaves_next_selection_untouched() {
    let (f, _) = Fixture::ready_with(styled(&["closed", "open"]), vec![]);
    let background = begin(&f);
    assert_eq!(background.len(), 1);
    assert_eq!(background[0].1.variant_id, id("M-open"));
    f.flow
        .dispatch(
            SelectionAction::SelectItem {
                axis: "size".into(),
                item: "L".into(),
            }
            .into(),
        )
        .unwrap();
    finish(&f, background[0].0, "open-result");
    assert_eq!(
        shown(&f),
        DisplayedImage::TryOn {
            try_on_id: id("closed-result")
        }
    );
    let view = f.flow.view().unwrap();
    assert_eq!(view.selection().variant_id, id("L-closed"));
    assert_eq!(
        view.selection().rows[1].display_options,
        styled(&["closed", "open"]).host_product.axes[1].display_options
    );
    let row = &view.presentation().axis_rows[0];
    assert!(row.items[0].selected);
    assert_eq!(row.items[1].variant_id, Some(id("M-open")));
    assert_eq!(row.items[1].try_on_id, Some(id("open-result")));
    f.flow
        .dispatch(
            PresentationAction::ShowAxisItem {
                axis: "wearing".into(),
                item: "open".into(),
            }
            .into(),
        )
        .unwrap();
    assert!(renders(&f).is_empty());
    let view = f.flow.view().unwrap();
    assert_eq!(
        view.presentation().displayed,
        DisplayedImage::TryOn {
            try_on_id: id("open-result")
        }
    );
    assert_eq!(view.presentation().try_ons, vec![id("open-result")]);
    assert_eq!(view.selection().variant_id, id("L-closed"));
}

#[test]
fn selecting_a_preparing_companion_joins_its_job_and_only_then_follows_it() {
    let (f, _) = Fixture::ready_with(styled(&["closed", "open"]), vec![]);
    let background = begin(&f);
    let view = f.flow.view().unwrap();
    assert_eq!(view.presentation().axis_rows[0].items[1].try_on_id, None);
    assert_eq!(
        view.presentation().axis_rows[0].items[1].can_show,
        Capability::Available
    );
    f.flow
        .dispatch(
            PresentationAction::ShowAxisItem {
                axis: "wearing".into(),
                item: "open".into(),
            }
            .into(),
        )
        .unwrap();
    assert!(renders(&f).is_empty());
    finish(&f, background[0].0, "open-result");
    assert_eq!(
        shown(&f),
        DisplayedImage::TryOn {
            try_on_id: id("open-result")
        }
    );
    assert_eq!(
        f.flow.view().unwrap().selection().variant_id,
        id("M-closed")
    );
}

#[test]
fn preparation_is_serial_and_a_failed_companion_does_not_loop_or_replace_the_hero() {
    let (f, _) = Fixture::ready_with(styled(&["closed", "open", "rolled"]), vec![]);
    let background = begin(&f);
    assert_eq!(background.len(), 1);
    f.session
        .complete(Completion {
            operation: background[0].0,
            outcome: Outcome::Failed {
                error: BackendError::Unavailable,
            },
        })
        .unwrap();
    let next = renders(&f);
    assert_eq!(next.len(), 1);
    assert_eq!(next[0].1.variant_id, id("M-rolled"));
    finish(&f, next[0].0, "rolled-result");
    assert!(renders(&f).is_empty());
    assert!(f.flow.view().unwrap().issue.is_none());
    assert_eq!(
        shown(&f),
        DisplayedImage::TryOn {
            try_on_id: id("closed-result")
        }
    );
    // An explicit retry is still allowed after best-effort preparation failed.
    f.flow
        .dispatch(
            PresentationAction::ShowAxisItem {
                axis: "wearing".into(),
                item: "open".into(),
            }
            .into(),
        )
        .unwrap();
    assert_eq!(renders(&f).len(), 1);
}

#[test]
fn uncertain_preparation_allows_a_new_shopper_request() {
    let (f, _) = Fixture::ready_with(styled(&["closed", "open"]), vec![]);
    let background = begin(&f);
    assert_eq!(background.len(), 1);
    f.session
        .complete(Completion {
            operation: background[0].0,
            outcome: Outcome::Unknown,
        })
        .unwrap();
    assert!(renders(&f).is_empty());

    let view = f.flow.view().unwrap();
    assert!(!view.domain.uncertain_try_on);
    // Nobody waits for the background render, so its uncertain operation is dropped.
    assert!(!view.domain.uncertain_operations.contains(&background[0].0));
    assert!(view.issue.is_none());
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
    let shopper = renders(&f);
    assert_eq!(shopper.len(), 1);
    assert_eq!(shopper[0].1.variant_id, id("L-closed"));
    finish(&f, shopper[0].0, "large-result");
    assert_eq!(
        shown(&f),
        DisplayedImage::TryOn {
            try_on_id: id("large-result")
        }
    );
    finish(&f, background[0].0, "open-result");
    assert_eq!(
        shown(&f),
        DisplayedImage::TryOn {
            try_on_id: id("large-result")
        }
    );
}

#[test]
fn a_height_write_retires_unconfirmed_preparation() {
    let (f, _) = Fixture::ready_with(styled(&["closed", "open"]), vec![]);
    let background = begin(&f);
    f.session
        .complete(Completion {
            operation: background[0].0,
            outcome: Outcome::Unknown,
        })
        .unwrap();
    f.session
        .command(
            BodyCommand::SetHeight {
                height: HeightCm(180.0),
            }
            .into(),
        )
        .unwrap();
    let effects = drain(&f.driver);
    assert!(effects.iter().any(|effect| matches!(
        effect,
        Effect::DomainEffect {
            effect: DomainEffect::Start {
                job: Job::Body { .. },
                ..
            }
        }
    )));
    finish(&f, background[0].0, "discarded-result");
    assert!(
        f.session
            .snapshot()
            .unwrap()
            .try_on(id("discarded-result"))
            .is_none()
    );
}

#[test]
fn preparation_does_not_evict_the_displayed_result_when_request_capacity_is_full() {
    let session_config = SessionConfig {
        max_try_on_requests: 1,
        ..config()
    };
    let (f, _) = Fixture::ready_with_session(styled(&["closed", "open"]), vec![], session_config);
    assert!(begin(&f).is_empty());
    let view = f.flow.view().unwrap();
    assert_eq!(
        view.presentation().displayed,
        DisplayedImage::TryOn {
            try_on_id: id("closed-result")
        }
    );
    assert_eq!(view.domain.try_on_requests.len(), 1);
    assert!(view.issue.is_none());
}

#[test]
fn a_cached_companion_of_a_different_body_revision_is_never_substituted() {
    let (f, _) = Fixture::ready_with(styled(&["closed", "open"]), vec![]);
    let background = begin(&f);
    f.session
        .complete(Completion {
            operation: background[0].0,
            outcome: Outcome::Failed {
                error: BackendError::Unavailable,
            },
        })
        .unwrap();
    drain(&f.driver);
    // Keep the earlier closed result, but change the body revision.
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
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
    let height_op = f
        .session
        .snapshot()
        .unwrap()
        .body
        .height()
        .and_then(HeightStatus::outstanding)
        .unwrap();
    f.session
        .complete(Completion {
            operation: height_op,
            outcome: BodyOutcome::HeightSet.into(),
        })
        .unwrap();
    drain(&f.driver);
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    let current = renders(&f);
    finish(&f, current[0].0, "new-closed");
    let background = renders(&f);
    finish(&f, background[0].0, "new-open");
    drain(&f.driver);
    f.flow
        .dispatch(
            PresentationAction::ShowTryOn {
                try_on_id: id("closed-result"),
            }
            .into(),
        )
        .unwrap();
    let view = f.flow.view().unwrap();
    let open = &view.presentation().axis_rows[0].items[1];
    assert_eq!(open.try_on_id, None);
    assert_eq!(
        open.can_show,
        Capability::Unavailable {
            reason: Rejection::Inadmissible {
                reason: Inadmissible::BodyRevisionUnavailable
            }
        }
    );
    assert!(
        f.flow
            .dispatch(
                PresentationAction::ShowAxisItem {
                    axis: "wearing".into(),
                    item: "open".into()
                }
                .into()
            )
            .is_err()
    );
    assert_eq!(
        shown(&f),
        DisplayedImage::TryOn {
            try_on_id: id("closed-result")
        }
    );
}

#[test]
fn retry_uses_the_failed_toolbar_variant_even_when_the_draft_is_different() {
    let (f, _) = Fixture::ready_with(styled(&["closed", "open"]), vec![]);
    let background = begin(&f);
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
        .dispatch(
            PresentationAction::ShowAxisItem {
                axis: "wearing".into(),
                item: "open".into(),
            }
            .into(),
        )
        .unwrap();
    assert!(renders(&f).is_empty());
    f.session
        .complete(Completion {
            operation: background[0].0,
            outcome: Outcome::Failed {
                error: BackendError::Unavailable,
            },
        })
        .unwrap();
    let before = f.flow.view().unwrap();
    assert_eq!(before.presentation().retry_variant_id, Some(id("M-open")));
    assert_eq!(before.selection().variant_id, id("L-closed"));
    f.flow
        .dispatch(PresentationAction::RetryTryOn.into())
        .unwrap();
    let retry = renders(&f);
    assert_eq!(retry.len(), 1);
    assert_eq!(retry[0].1, background[0].1);
    assert_eq!(
        f.flow.view().unwrap().selection().variant_id,
        id("L-closed")
    );
}

#[test]
fn prepares_only_the_companion_of_the_result_that_just_settled() {
    let (f, _) = Fixture::ready_with(styled(&["closed", "open"]), vec![]);
    let stock = |variant_ids| {
        f.flow
            .dispatch(
                SelectionAction::SetUnavailableVariants {
                    variant_ids,
                    installation: f
                        .flow
                        .view()
                        .unwrap()
                        .product_installation
                        .map(|value| value.token),
                }
                .into(),
            )
            .unwrap();
    };
    stock(vec![id("M-open")]);
    assert!(begin(&f).is_empty());
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
    let foreground = renders(&f);
    assert_eq!(foreground.len(), 1);
    stock(vec![]);
    assert!(renders(&f).is_empty());

    finish(&f, foreground[0].0, "large-closed");
    let work = renders(&f);
    assert_eq!(work.len(), 1);
    assert_eq!(work[0].1.variant_id, id("L-open"));
}
