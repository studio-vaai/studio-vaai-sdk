//! The domain engine on its own, without an experience or runtime.

mod common;

use common::*;
use state_machine::domain::DomainEngine;
use state_machine::*;

fn photo(d: &mut DomainEngine, key: &str, source: PhotoSource) -> OperationId {
    command(
        d,
        PhotoCommand::Process {
            photo: Photo {
                media: id(key),
                source,
            },
        }
        .into(),
    )
    .receipt
    .operation
    .unwrap()
}

fn set_height(d: &mut DomainEngine, height: f64) -> DomainOutput {
    command(
        d,
        BodyCommand::SetHeight {
            height: HeightCm(height),
        }
        .into(),
    )
}

fn starts_set_height(out: &DomainOutput) -> bool {
    out.effects.iter().any(|e| {
        matches!(
            e,
            DomainEffect::Start {
                job: Job::Body {
                    job: BodyJob::SetHeight { .. }
                },
                ..
            }
        )
    })
}

#[test]
fn headless_journey_needs_no_controller() {
    let mut d = ready();
    let out = request(&mut d, "M");
    rendered(&mut d, render_op(&out).unwrap(), "m-result");
    assert_eq!(d.snapshot().try_ons()[0].key.variant_id, id("M"));
}

#[test]
fn rejected_input_is_atomic() {
    let mut d = ready();
    let before = d.snapshot();
    let out = d.dispatch(DomainInput::Command(
        BodyCommand::SetHeight {
            height: HeightCm(f64::NAN),
        }
        .into(),
    ));
    assert!(matches!(
        out.receipt.disposition,
        Disposition::Rejected { .. }
    ));
    assert_eq!(before, d.snapshot());
    assert!(out.effects.is_empty());
}

#[test]
fn no_upload_without_consent_and_session() {
    let mut d = DomainEngine::new(config()).unwrap();
    let out = d.dispatch(DomainInput::Command(
        PhotoCommand::Process {
            photo: Photo {
                media: id("x"),
                source: PhotoSource::Library,
            },
        }
        .into(),
    ));
    assert!(matches!(
        out.receipt.disposition,
        Disposition::Rejected { .. }
    ));
}

#[test]
fn a_product_needs_unique_variants_on_the_same_axes() {
    let mut d = ready();
    let refused = |d: &mut DomainEngine, product: Product| {
        let out = d.dispatch(DomainInput::Command(
            ProductCommand::Show {
                product,
                unavailable_variants: None,
            }
            .into(),
        ));
        matches!(out.receipt.disposition, Disposition::Rejected { .. })
    };
    let mut repeated = product();
    repeated.variants[1].foreign_ids = foreign(&[("size", "M")]);
    assert!(refused(&mut d, repeated));
    let mut uneven = product();
    uneven.variants[1].foreign_ids = foreign(&[("size", "L"), ("colorway", "red")]);
    assert!(refused(&mut d, uneven));
    let mut unnamed = product();
    unnamed.variants[1].foreign_ids = foreign(&[("size", "")]);
    assert!(refused(&mut d, unnamed));
    let mut twice = product();
    twice.variants[1].id = id("M");
    assert!(refused(&mut d, twice));
}

#[test]
fn one_try_on_is_created_at_a_time() {
    let mut d = ready();
    let m = request(&mut d, "M");
    let op = render_op(&m).unwrap();
    // M is being created: L waits for it.
    let l = request(&mut d, "L");
    assert!(render_op(&l).is_none());
    let done = rendered(&mut d, op, "M");
    assert_eq!(d.snapshot().try_ons()[0].key.variant_id, id("M"));
    assert!(done.effects.iter().any(|e| matches!(
        e,
        DomainEffect::Start {
            job: Job::TryOn {
                job: TryOnJob::Create { key, .. },
            },
            ..
        } if key.variant_id == id("L")
    )));
}

fn cancel(d: &mut DomainEngine, out: &DomainOutput) {
    command(
        d,
        TryOnCommand::DetachRequest {
            try_on_request_id: out.receipt.try_on_request_id.unwrap(),
        }
        .into(),
    );
}

fn status(d: &DomainEngine, out: &DomainOutput) -> TryOnRequestStatus {
    let id = out.receipt.try_on_request_id.unwrap();
    d.snapshot().try_on_request(id).unwrap().status.clone()
}

#[test]
fn identical_requests_share_a_try_on() {
    let mut d = ready();
    let a = request(&mut d, "M");
    let b = request(&mut d, "M");
    assert!(render_op(&b).is_none());
    // A running request is not cancelled: it settles with its try-on.
    cancel(&mut d, &a);
    rendered(&mut d, render_op(&a).unwrap(), "M");
    for out in [&a, &b] {
        let TryOnRequestStatus::Resolved { try_on_id } = status(&d, out) else {
            panic!("not resolved");
        };
        assert_eq!(try_on_id, id("M"));
    }
}

#[test]
fn only_a_request_not_started_is_cancelled() {
    let mut d = ready();
    let m = request(&mut d, "M");
    let l = request(&mut d, "L");
    cancel(&mut d, &l);
    assert_eq!(status(&d, &l), TryOnRequestStatus::Cancelled);
    // Nothing waits once M is done.
    let done = rendered(&mut d, render_op(&m).unwrap(), "M");
    assert!(render_op(&done).is_none());
}

#[test]
fn try_ons_keep_their_height_and_creation_order() {
    let mut d = ready();
    let m = request(&mut d, "M");
    rendered(&mut d, render_op(&m).unwrap(), "m-175");
    let write = set_height(&mut d, 180.0);
    complete(
        &mut d,
        write.receipt.operation.unwrap(),
        BodyOutcome::HeightSet.into(),
    );
    let m = request(&mut d, "M");
    rendered(&mut d, render_op(&m).unwrap(), "m-180");
    let l = request(&mut d, "L");
    rendered(&mut d, render_op(&l).unwrap(), "l-180");
    // Asking for M again reuses its try-on at this height and adds nothing.
    request(&mut d, "M");
    let snapshot = d.snapshot();
    let carousel: Vec<(TryOnId, f64)> = snapshot
        .try_ons()
        .iter()
        .map(|t| (t.id, t.height.0))
        .collect();
    assert_eq!(
        carousel,
        [
            (id("m-175"), 175.0),
            (id("m-180"), 180.0),
            (id("l-180"), 180.0)
        ]
    );
}

#[test]
fn result_eviction_identifies_only_the_result_that_left_history() {
    let mut d = ready_with(SessionConfig {
        max_try_on_requests: 1,
        ..config()
    });
    let first = request(&mut d, "M");
    let first = rendered(&mut d, render_op(&first).unwrap(), "first");
    let evictions = |output: DomainOutput| -> Vec<TryOnId> {
        output
            .events
            .into_iter()
            .filter_map(|event| match event {
                DomainEvent::TryOn {
                    event: TryOnEvent::Evicted { try_on_id },
                } => Some(try_on_id),
                _ => None,
            })
            .collect()
    };
    assert!(evictions(first).is_empty());

    let second = request(&mut d, "L");
    assert!(evictions(second.clone()).is_empty());
    assert_eq!(
        evictions(rendered(&mut d, render_op(&second).unwrap(), "second")),
        [id("first")]
    );
    assert_eq!(d.snapshot().try_ons[0].id, id("second"));
}

#[test]
fn completed_results_survive_request_receipt_eviction() {
    let mut d = ready_with(SessionConfig {
        max_try_on_requests: 5,
        ..config()
    });
    let failed = request(&mut d, "XL");
    let unavailable = Outcome::Failed {
        error: BackendError::Unavailable,
    };
    complete(&mut d, render_op(&failed).unwrap(), unavailable);
    let refusal = request(&mut d, "XL");
    refused(&mut d, render_op(&refusal).unwrap());
    let m = request(&mut d, "M");
    rendered(&mut d, render_op(&m).unwrap(), "M");
    let l = request(&mut d, "L");
    rendered(&mut d, render_op(&l).unwrap(), "L");
    let reused = request(&mut d, "L");
    assert!(matches!(
        status(&d, &reused),
        TryOnRequestStatus::Resolved { .. }
    ));
    // Requests waiting for a SetHeight stay open, and take the room.
    set_height(&mut d, 180.0);
    let kept = |d: &DomainEngine| -> Vec<TryOnRequestId> {
        d.snapshot().try_on_requests.iter().map(|r| r.id).collect()
    };
    for dropped in [&failed, &refusal, &m, &l, &reused] {
        let before = kept(&d);
        request(&mut d, "M");
        let gone: Vec<_> = before
            .into_iter()
            .filter(|id| !kept(&d).contains(id))
            .collect();
        assert_eq!(gone, [dropped.receipt.try_on_request_id.unwrap()]);
    }
    assert_eq!(
        d.snapshot()
            .try_ons
            .iter()
            .map(|result| result.id)
            .collect::<Vec<_>>(),
        [id("M"), id("L")]
    );
    let full = d.dispatch(DomainInput::Command(
        TryOnCommand::Request {
            origin: None,
            variant_id: id("M"),
            target: d.snapshot().body_target().unwrap(),
        }
        .into(),
    ));
    assert_eq!(
        full.receipt.disposition,
        Disposition::Rejected {
            reason: Rejection::RequestLimit
        }
    );
}

#[test]
fn cache_hit_resolves_logical_request_without_new_completion_notification() {
    let mut d = ready();
    let a = request(&mut d, "M");
    rendered(&mut d, render_op(&a).unwrap(), "M");
    let replay = request(&mut d, "M");
    assert!(render_op(&replay).is_none());
    assert!(replay.events.iter().any(|e| matches!(
        e,
        DomainEvent::TryOn {
            event: TryOnEvent::RequestResolved { .. }
        }
    )));
    assert!(!replay.events.iter().any(|e| matches!(
        e,
        DomainEvent::TryOn {
            event: TryOnEvent::Created { .. }
        }
    )));
}

#[test]
fn duplicate_completion_is_ignored() {
    let mut d = ready();
    let a = request(&mut d, "M");
    let op = render_op(&a).unwrap();
    rendered(&mut d, op, "M");
    let out = rendered(&mut d, op, "M");
    assert_eq!(out.receipt.disposition, Disposition::Ignored);
    assert_eq!(d.snapshot().try_ons().len(), 1);
}

#[test]
fn set_height_drains_every_read_of_the_body() {
    let mut d = ready();
    let a = request(&mut d, "M");
    let Some(BodyTarget::Acknowledged { revision }) = d.snapshot().body_target() else {
        panic!("an acknowledged revision");
    };
    let fetch = command(&mut d, SizeRecommendationCommand::Fetch.into())
        .receipt
        .operation
        .unwrap();
    assert!(!starts_set_height(&set_height(&mut d, 180.0)));
    let first = rendered(&mut d, render_op(&a).unwrap(), "M");
    assert!(!starts_set_height(&first));
    let second = complete(
        &mut d,
        fetch,
        SizeRecommendationOutcome::Fetched { scores: vec![] }.into(),
    );
    assert!(starts_set_height(&second));
    assert!(
        d.snapshot()
            .try_ons()
            .iter()
            .all(|r| r.key.body_revision == revision)
    );
}

#[test]
fn a_queued_height_write_keeps_the_product_from_confirmation() {
    let mut d = ready();
    let original_product = d.snapshot().product.unwrap().id;
    let render = render_op(&request(&mut d, "M")).unwrap();
    let write = set_height(&mut d, 180.0);
    assert!(!starts_set_height(&write));

    let mut other_product = product();
    other_product.id = id("other product");
    command(
        &mut d,
        ProductCommand::Show {
            product: other_product,
            unavailable_variants: None,
        }
        .into(),
    );
    let completed = rendered(&mut d, render, "M");
    assert!(completed.effects.iter().any(|effect| matches!(
        effect,
        DomainEffect::Start {
            operation,
            job: Job::Body {
                job: BodyJob::SetHeight { product_id: Some(product_id), .. }
            },
        } if Some(*operation) == write.receipt.operation && *product_id == original_product
    )));
}

#[test]
fn set_height_waiting_request_pins_its_dependency() {
    let mut d = ready();
    let write = set_height(&mut d, 180.0);
    let req = request(&mut d, "M");
    assert!(render_op(&req).is_none());
    let settled = complete(
        &mut d,
        write.receipt.operation.unwrap(),
        BodyOutcome::HeightSet.into(),
    );
    assert!(render_op(&settled).is_some());
}

#[test]
fn reconciles_height_without_rewriting_and_only_accepts_a_matching_revision() {
    for saved in [180.0, 170.0] {
        let mut d = ready();
        let write = set_height(&mut d, 180.0).receipt.operation.unwrap();
        let req = request(&mut d, "M");
        assert!(render_op(&req).is_none());
        let read = complete(&mut d, write, Outcome::HeightWriteUnconfirmed);
        assert!(matches!(
            read.effects.as_slice(),
            [DomainEffect::Start {
                operation,
                job: Job::Body { job: BodyJob::ReadHeight { .. } },
            }] if *operation == write
        ));
        assert_eq!(
            d.snapshot().body.height().cloned().unwrap(),
            HeightStatus::Pending {
                operation: write,
                height: HeightCm(180.0),
            }
        );
        assert!(set_height(&mut d, 180.0).effects.is_empty());

        let result = complete(
            &mut d,
            write,
            Outcome::HeightReadback {
                height: Some(HeightCm(saved)),
                backend_revision: Some("server-revision".into()),
            },
        );
        if saved == 180.0 {
            assert!(render_op(&result).is_some());
            let snapshot = d.snapshot();
            assert!(matches!(
                snapshot.body.height(),
                Some(HeightStatus::Acknowledged { backend_revision: Some(revision), .. })
                    if revision == "server-revision"
            ));
        } else {
            assert!(render_op(&result).is_none());
            assert_eq!(
                d.snapshot().body.height().cloned().unwrap(),
                HeightStatus::Uncertain {
                    operation: write,
                    height: HeightCm(180.0),
                }
            );
        }
    }
}

#[test]
fn terminal_set_height_failure_drops_waiting_intents() {
    let mut d = ready();
    let write = set_height(&mut d, 180.0);
    let req = request(&mut d, "M");
    complete(
        &mut d,
        write.receipt.operation.unwrap(),
        Outcome::Failed {
            error: BackendError::Unusable,
        },
    );
    let status = d
        .snapshot()
        .try_on_request(req.receipt.try_on_request_id.unwrap())
        .unwrap()
        .status
        .clone();
    assert!(matches!(status, TryOnRequestStatus::Failed { .. }));
}

#[test]
fn unknown_write_outcome_blocks_followup_work() {
    let mut d = ready();
    let write = set_height(&mut d, 180.0);
    complete(&mut d, write.receipt.operation.unwrap(), Outcome::Unknown);
    assert_eq!(
        d.snapshot().body.height().cloned().unwrap(),
        HeightStatus::Uncertain {
            operation: write.receipt.operation.unwrap(),
            height: HeightCm(180.0),
        }
    );
    let out = d.dispatch(DomainInput::Command(
        BodyCommand::SetHeight {
            height: HeightCm(181.0),
        }
        .into(),
    ));
    assert!(matches!(
        out.receipt.disposition,
        Disposition::Rejected { .. }
    ));
}

#[test]
fn an_uncertain_render_blocks_height_writes_while_wanted() {
    let mut d = ready();
    let render = request(&mut d, "M");
    complete(&mut d, render_op(&render).unwrap(), Outcome::Unknown);
    assert!(!starts_set_height(&set_height(&mut d, 180.0)));
}

#[test]
fn same_height_is_a_noop_only_when_synchronized() {
    let mut d = ready();
    let before = d.snapshot().body;
    let out = d.dispatch(DomainInput::Command(
        BodyCommand::SetHeight {
            height: HeightCm(175.0),
        }
        .into(),
    ));
    assert_eq!(out.receipt.disposition, Disposition::Ignored);
    assert!(out.receipt.operation.is_none());
    assert_eq!(before, d.snapshot().body);
}

#[test]
fn rejected_replacement_preserves_committed_progress() {
    let mut d = ready();
    let a = request(&mut d, "M");
    rendered(&mut d, render_op(&a).unwrap(), "M");
    let old = d.snapshot();
    let op = photo(&mut d, "bad", PhotoSource::Library);
    complete(
        &mut d,
        op,
        PhotoOutcome::Rejected {
            reason: PhotoRejection::HumanOccluded,
        }
        .into(),
    );
    assert_eq!(old.body, d.snapshot().body);
    assert_eq!(old.try_ons(), d.snapshot().try_ons());
}

#[test]
fn cancel_photo_then_late_accept_does_not_replace_body() {
    let mut d = ready();
    let before = d.snapshot().body;
    let op = photo(&mut d, "new", PhotoSource::Camera);
    command(&mut d, PhotoCommand::Cancel { operation: op }.into());
    let done = complete(
        &mut d,
        op,
        PhotoOutcome::Accepted {
            body_id: id("body-2"),
            estimated_height: HeightCm(174.0),
        }
        .into(),
    );
    assert_eq!(before, d.snapshot().body);
    assert!(done.effects.iter().any(|e| matches!(
        e,
        DomainEffect::Media {
            effect: MediaEffect::Release { media },
        } if *media == id("new")
    )));
}

#[test]
fn new_photo_invalidates_same_height_cache_and_old_completions() {
    let mut d = ready();
    let old = request(&mut d, "M");
    let op = photo(&mut d, "new", PhotoSource::Library);
    complete(
        &mut d,
        op,
        PhotoOutcome::Accepted {
            body_id: id("body-2"),
            estimated_height: HeightCm(175.0),
        }
        .into(),
    );
    rendered(&mut d, render_op(&old).unwrap(), "old");
    assert!(d.snapshot().try_ons().is_empty());
}

#[test]
fn pending_photo_does_not_commit_body() {
    let mut d = ready();
    let before = d.snapshot().body;
    photo(&mut d, "new", PhotoSource::Library);
    assert_eq!(before, d.snapshot().body);
    // One photo is processed at a time.
    let second = d.dispatch(DomainInput::Command(
        PhotoCommand::Process {
            photo: Photo {
                media: id("other"),
                source: PhotoSource::Library,
            },
        }
        .into(),
    ));
    assert_eq!(
        second.receipt.disposition,
        Disposition::Rejected {
            reason: Rejection::PhotoProcessing
        }
    );
}

/// Whether `out` refused a request, and whether it learned a refusal.
fn refusals(out: &DomainOutput) -> (bool, bool) {
    let request = out.events.iter().any(|e| {
        matches!(
            e,
            DomainEvent::TryOn {
                event: TryOnEvent::RequestRefused { .. }
            }
        )
    });
    let learned = out.events.iter().any(|e| {
        matches!(
            e,
            DomainEvent::TryOn {
                event: TryOnEvent::Refused { .. }
            }
        )
    });
    (request, learned)
}

#[test]
fn a_refused_try_on_refuses_its_key_from_then_on() {
    let mut d = ready();
    let first = request(&mut d, "M");
    let op = render_op(&first).unwrap();
    let revision = d.snapshot().body_target();
    let Some(BodyTarget::Acknowledged { revision }) = revision else {
        panic!("no acknowledged revision");
    };
    assert_eq!(refusals(&refused(&mut d, op)), (true, true));
    let key = TryOnKey {
        body_revision: revision,
        variant_id: id("M"),
    };
    assert_eq!(
        d.snapshot().refusal(&key),
        Some(RefusalReason::GarmentTooSmall)
    );
    // Another request for the key is refused at once, and teaches nothing.
    let again = request(&mut d, "M");
    assert!(render_op(&again).is_none());
    assert_eq!(refusals(&again), (true, false));
    // Another variant still reaches the backend.
    let other = render_op(&request(&mut d, "L")).unwrap();
    rendered(&mut d, other, "l");
    // A new height is a new key.
    let write = set_height(&mut d, 180.0);
    complete(
        &mut d,
        write.receipt.operation.unwrap(),
        BodyOutcome::HeightSet.into(),
    );
    assert!(render_op(&request(&mut d, "M")).is_some());
    // A new photo forgets every refusal.
    let op = photo(&mut d, "new", PhotoSource::Library);
    complete(
        &mut d,
        op,
        PhotoOutcome::Accepted {
            body_id: id("body-2"),
            estimated_height: HeightCm(175.0),
        }
        .into(),
    );
    assert!(d.snapshot().try_on_requests.is_empty());
}

#[test]
fn the_size_recommendation_orders_sizes_by_fit_match() {
    let mut d = ready();
    let op = command(&mut d, SizeRecommendationCommand::Fetch.into())
        .receipt
        .operation
        .unwrap();
    complete(
        &mut d,
        op,
        SizeRecommendationOutcome::Fetched {
            scores: vec![
                score(&[id("XL")], 0.6),
                score(&[id("L")], 0.9),
                score(&[id("M")], 0.6),
            ],
        }
        .into(),
    );
    let order: Vec<VariantId> = d
        .snapshot()
        .size_recommendation
        .unwrap()
        .scores
        .iter()
        .map(|s| s.variant_ids[0])
        .collect();
    // A tie keeps the product's order: M before XL.
    assert_eq!(order, [id("L"), id("M"), id("XL")]);
}

#[test]
fn api_ranked_recommendations_preserve_the_servers_order() {
    let mut d = ready();
    let operation = command(&mut d, SizeRecommendationCommand::Fetch.into())
        .receipt
        .operation
        .unwrap();
    complete(
        &mut d,
        operation,
        SizeRecommendationOutcome::Ranked {
            scores: vec![score(&[id("M")], 0.8), score(&[id("L")], 0.95)],
            restrictions: vec![],
            preferred: vec![id("M")],
            no_suitable_size: false,
        }
        .into(),
    );
    let recommendation = d.snapshot().size_recommendation.unwrap();
    assert_eq!(recommendation.scores[0].variant_ids, [id("M")]);
    assert_eq!(recommendation.scores[1].variant_ids, [id("L")]);
}

#[test]
fn the_size_recommendation_names_only_the_products_variants() {
    let refused_with = |scores: Vec<SizeRecommendationScore>| {
        let mut d = ready();
        let op = command(&mut d, SizeRecommendationCommand::Fetch.into())
            .receipt
            .operation
            .unwrap();
        let out = d.dispatch(DomainInput::Completion(Completion {
            operation: op,
            outcome: SizeRecommendationOutcome::Fetched { scores }.into(),
        }));
        let reason = match out.receipt.disposition {
            Disposition::Rejected { reason } => reason,
            other => panic!("accepted: {other:?}"),
        };
        assert!(d.snapshot().size_recommendation.is_none());
        reason
    };
    assert_eq!(
        refused_with(vec![score(&[id("M"), id("shirt-M")], 0.9)]),
        Rejection::RecommendedSizeNotShown
    );
    assert_eq!(
        refused_with(vec![score(&[id("M")], 0.9), score(&[id("M")], 0.8)]),
        Rejection::VariantInTwoSizes
    );
    assert_eq!(
        refused_with(vec![score(&[], 0.9)]),
        Rejection::EmptyRecommendedSize
    );
    assert_eq!(
        refused_with(vec![score(&[id("M")], f64::NAN)]),
        Rejection::InvalidFitMatch
    );
    assert_eq!(
        refused_with(vec![score(&[id("M")], 1.5)]),
        Rejection::InvalidFitMatch
    );
}

#[test]
fn stale_product_recommendation_does_not_install() {
    let mut d = ready();
    let op = command(&mut d, SizeRecommendationCommand::Fetch.into())
        .receipt
        .operation
        .unwrap();
    let mut newer = product();
    newer.variants.pop();
    let changed = command(
        &mut d,
        ProductCommand::Show {
            product: newer,
            unavailable_variants: None,
        }
        .into(),
    );
    assert!(
        changed
            .effects
            .contains(&DomainEffect::Cancel { operation: op })
    );
    complete(
        &mut d,
        op,
        SizeRecommendationOutcome::Fetched {
            scores: vec![score(&[id("M")], 0.9)],
        }
        .into(),
    );
    assert!(d.snapshot().size_recommendation.is_none());
}

#[test]
fn the_domain_holds_only_the_product_shown() {
    let mut d = ready();
    let write = set_height(&mut d, 180.0);
    let waiting = request(&mut d, "M");
    let shirt = Product {
        id: id("shirt"),
        variants: vec![Variant {
            id: id("shirt-M"),
            foreign_ids: foreign(&[("size", "M")]),
        }],
    };
    command(
        &mut d,
        ProductCommand::Show {
            product: shirt,
            unavailable_variants: None,
        }
        .into(),
    );
    assert_eq!(d.snapshot().product.map(|p| p.id), Some(id("shirt")));
    // The request for the jeans waited for the height; it fails once driven.
    let settled = complete(
        &mut d,
        write.receipt.operation.unwrap(),
        BodyOutcome::HeightSet.into(),
    );
    assert!(render_op(&settled).is_none());
    let status = d
        .snapshot()
        .try_on_request(waiting.receipt.try_on_request_id.unwrap())
        .unwrap()
        .status
        .clone();
    assert!(matches!(status, TryOnRequestStatus::Failed { .. }));
    // New requests for the jeans' variants are refused.
    let target = d.snapshot().body_target().unwrap();
    let refused = d.dispatch(DomainInput::Command(
        TryOnCommand::Request {
            origin: None,
            variant_id: id("M"),
            target,
        }
        .into(),
    ));
    assert!(matches!(
        refused.receipt.disposition,
        Disposition::Rejected { .. }
    ));
}

#[test]
fn session_reset_rejects_late_success_and_old_expiry() {
    let mut d = ready();
    let req = request(&mut d, "M");
    let op = render_op(&req).unwrap();
    command(&mut d, SessionCommand::Reset.into());
    rendered(&mut d, op, "old");
    // The old operation's expiry does not reset the new session.
    let expired = complete(&mut d, op, Outcome::SessionExpired);
    assert_eq!(expired.receipt.disposition, Disposition::Ignored);
    assert!(expired.events.is_empty());
    assert!(d.snapshot().try_ons().is_empty());
}

#[test]
fn transient_restore_failure_preserves_retryable_identity() {
    let mut d = DomainEngine::new(config()).unwrap();
    let restore = command(&mut d, SessionCommand::Initialize.into())
        .receipt
        .operation
        .unwrap();
    let failed = complete(
        &mut d,
        restore,
        Outcome::Failed {
            error: BackendError::Unavailable,
        },
    );
    assert!(!failed.effects.iter().any(|e| matches!(
        e,
        DomainEffect::Session {
            effect: SessionEffect::Clear
        }
    )));
    let retry = command(&mut d, SessionCommand::Retry.into());
    assert!(retry.effects.iter().any(|e| matches!(
        e,
        DomainEffect::Start {
            job: Job::Session {
                job: SessionJob::Restore,
            },
            ..
        }
    )));
}

#[test]
fn wrong_typed_completion_does_not_consume_operation() {
    let mut d = ready();
    let req = request(&mut d, "M");
    let op = render_op(&req).unwrap();
    let before = d.snapshot();
    let wrong = d.dispatch(DomainInput::Completion(Completion {
        operation: op,
        outcome: BodyOutcome::HeightSet.into(),
    }));
    assert!(matches!(
        wrong.receipt.disposition,
        Disposition::Rejected { .. }
    ));
    assert_eq!(before, d.snapshot());
    rendered(&mut d, op, "M");
    assert_eq!(d.snapshot().try_ons().len(), 1);
}

#[test]
fn foreign_runtime_operation_cannot_complete_local_work() {
    let mut d = ready();
    let req = request(&mut d, "M");
    // The same operation number, minted by another runtime.
    let (prefix, number) = render_op(&req).unwrap().0.as_u64_pair();
    let foreign = OperationId(uuid::Uuid::from_u64_pair(!prefix, number));
    let out = rendered(&mut d, foreign, "wrong");
    assert_eq!(out.receipt.disposition, Disposition::Ignored);
}

fn detach(d: &mut DomainEngine, out: &DomainOutput) -> DomainOutput {
    d.dispatch(DomainInput::Command(
        TryOnCommand::DetachRequest {
            try_on_request_id: out.receipt.try_on_request_id.unwrap(),
        }
        .into(),
    ))
}

fn detached_stage(out: &DomainOutput) -> Option<DetachedStage> {
    out.events.iter().find_map(|event| match event {
        DomainEvent::TryOn {
            event: TryOnEvent::RequestDetached { stage, .. },
        } => Some(*stage),
        _ => None,
    })
}

fn cancels(out: &DomainOutput, operation: OperationId) -> bool {
    out.effects.contains(&DomainEffect::Cancel { operation })
}

#[test]
fn detaching_a_waiting_request_cancels_it() {
    let mut d = ready();
    request(&mut d, "M");
    let waiting = request(&mut d, "L");
    assert_eq!(status(&d, &waiting), TryOnRequestStatus::Waiting);
    let out = detach(&mut d, &waiting);
    assert_eq!(detached_stage(&out), Some(DetachedStage::Waiting));
    assert_eq!(status(&d, &waiting), TryOnRequestStatus::Cancelled);
}

#[test]
fn a_render_detached_while_rendering_still_settles() {
    let mut d = ready();
    let render = request(&mut d, "M");
    let op = render_op(&render).unwrap();
    let out = detach(&mut d, &render);
    assert_eq!(detached_stage(&out), Some(DetachedStage::Rendering));
    assert!(!cancels(&out, op));
    assert_eq!(
        status(&d, &render),
        TryOnRequestStatus::Running { operation: op }
    );
    rendered(&mut d, op, "m-result");
    assert_eq!(
        status(&d, &render),
        TryOnRequestStatus::Resolved {
            try_on_id: id("m-result")
        }
    );
    assert!(d.snapshot().try_on(id("m-result")).is_some());
}

#[test]
fn an_detached_render_that_becomes_uncertain_is_dropped() {
    let mut d = ready();
    let render = request(&mut d, "M");
    let op = render_op(&render).unwrap();
    detach(&mut d, &render);
    let out = complete(&mut d, op, Outcome::Unknown);
    assert!(cancels(&out, op));
    assert_eq!(status(&d, &render), TryOnRequestStatus::Cancelled);
    assert!(d.snapshot().uncertain_operations.is_empty());
    assert!(starts_set_height(&set_height(&mut d, 180.0)));
}

#[test]
fn detaching_an_uncertain_render_drops_it() {
    let mut d = ready();
    let render = request(&mut d, "M");
    let op = render_op(&render).unwrap();
    complete(&mut d, op, Outcome::Unknown);
    assert_eq!(d.snapshot().uncertain_operations, vec![op]);
    let out = detach(&mut d, &render);
    assert_eq!(detached_stage(&out), Some(DetachedStage::Uncertain));
    assert!(cancels(&out, op));
    assert_eq!(status(&d, &render), TryOnRequestStatus::Cancelled);
    assert!(!d.snapshot().uncertain_try_on);
    // A late result finds nothing.
    let late = rendered(&mut d, op, "late");
    assert_eq!(late.receipt.disposition, Disposition::Ignored);
    assert!(d.snapshot().try_on(id("late")).is_none());
}

#[test]
fn a_shared_uncertain_render_survives_one_detach() {
    let mut d = ready();
    let first = request(&mut d, "M");
    let second = request(&mut d, "M");
    let op = render_op(&first).unwrap();
    complete(&mut d, op, Outcome::Unknown);
    let out = detach(&mut d, &first);
    assert!(!cancels(&out, op));
    assert_eq!(status(&d, &first), TryOnRequestStatus::Cancelled);
    assert_eq!(
        status(&d, &second),
        TryOnRequestStatus::Running { operation: op }
    );
    assert_eq!(d.snapshot().uncertain_operations, vec![op]);
}

#[test]
fn a_height_write_queued_behind_a_render_starts_once_it_is_detached_uncertain() {
    let mut d = ready();
    let render = request(&mut d, "M");
    let op = render_op(&render).unwrap();
    assert!(!starts_set_height(&set_height(&mut d, 180.0)));
    complete(&mut d, op, Outcome::Unknown);
    let out = detach(&mut d, &render);
    assert!(cancels(&out, op));
    assert!(starts_set_height(&out));
}

#[test]
fn detaching_a_settled_request_changes_nothing() {
    let mut d = ready();
    let render = request(&mut d, "M");
    rendered(&mut d, render_op(&render).unwrap(), "m-result");
    let out = detach(&mut d, &render);
    assert_eq!(out.receipt.disposition, Disposition::Ignored);
    assert_eq!(detached_stage(&out), None);
}

fn restored_body(source: PhotoSource) -> RestoredBody {
    RestoredBody {
        body_id: id("restored-body"),
        media: id("restored-photo"),
        source,
        estimated_height: HeightCm(172.0),
        height: None,
        backend_revision: None,
    }
}

#[test]
fn a_restored_body_keeps_the_source_its_host_kept() {
    for source in [PhotoSource::Camera, PhotoSource::Library] {
        let mut d = DomainEngine::new(config()).unwrap();
        let restore = command(&mut d, SessionCommand::Initialize.into())
            .receipt
            .operation
            .unwrap();
        complete(
            &mut d,
            restore,
            SessionOutcome::CookieEstablished {
                generation: "cookie".into(),
                body: Some(restored_body(source)),
            }
            .into(),
        );
        let snapshot = d.snapshot();
        assert_eq!(snapshot.session, SessionPhase::Ready);
        assert_eq!(snapshot.photo.map(|photo| photo.source), Some(source));
    }
}

#[test]
fn a_created_session_cannot_report_a_body() {
    let mut d = DomainEngine::new(config()).unwrap();
    let restore = command(&mut d, SessionCommand::Initialize.into())
        .receipt
        .operation
        .unwrap();
    complete(&mut d, restore, SessionOutcome::Absent.into());
    let create = command(
        &mut d,
        SessionCommand::Create {
            data_processing_consent: DataProcessingConsent::Granted,
        }
        .into(),
    )
    .receipt
    .operation
    .unwrap();
    let before = d.snapshot();
    let out = d.dispatch(DomainInput::Completion(Completion {
        operation: create,
        outcome: SessionOutcome::CookieEstablished {
            generation: "cookie".into(),
            body: Some(restored_body(PhotoSource::Camera)),
        }
        .into(),
    }));
    assert_eq!(
        out.receipt.disposition,
        Disposition::Rejected {
            reason: Rejection::OutcomeMismatch
        }
    );
    assert_eq!(d.snapshot(), before);
}

fn body_1() -> BodyIdentity {
    BodyIdentity {
        body_id: id("body-1"),
        estimated_height: HeightCm(170.0),
    }
}

#[test]
fn a_render_reporting_body_not_found_marks_the_body_missing() {
    let mut d = ready();
    let op = render_op(&request(&mut d, "M")).unwrap();
    complete(
        &mut d,
        op,
        Outcome::Failed {
            error: BackendError::BodyNotFound,
        },
    );
    let snapshot = d.snapshot();
    assert_eq!(snapshot.body, BodyState::Missing { identity: body_1() });
    // A missing body has no height, so nothing can target it.
    assert_eq!(snapshot.body.height(), None);
    assert_eq!(snapshot.body_target(), None);
    let write = d.dispatch(DomainInput::Command(
        BodyCommand::SetHeight {
            height: HeightCm(180.0),
        }
        .into(),
    ));
    assert_eq!(
        write.receipt.disposition,
        Disposition::Rejected {
            reason: Rejection::TryOnInputsUnavailable {
                error: BackendError::BodyNotFound,
            }
        }
    );
}

#[test]
fn a_set_height_reporting_body_not_found_marks_the_body_missing() {
    let mut d = ready();
    let write = set_height(&mut d, 180.0).receipt.operation.unwrap();
    complete(
        &mut d,
        write,
        Outcome::Failed {
            error: BackendError::BodyNotFound,
        },
    );
    assert_eq!(d.snapshot().body, BodyState::Missing { identity: body_1() });
}

#[test]
fn a_new_photo_replaces_a_missing_body_and_a_reset_forgets_it() {
    let mut d = ready();
    let op = render_op(&request(&mut d, "M")).unwrap();
    complete(
        &mut d,
        op,
        Outcome::Failed {
            error: BackendError::BodyNotFound,
        },
    );
    let photo_op = photo(&mut d, "photo-2", PhotoSource::Camera);
    complete(
        &mut d,
        photo_op,
        PhotoOutcome::Accepted {
            body_id: id("body-2"),
            estimated_height: HeightCm(181.0),
        }
        .into(),
    );
    assert_eq!(
        d.snapshot().body,
        BodyState::Live {
            identity: BodyIdentity {
                body_id: id("body-2"),
                estimated_height: HeightCm(181.0),
            },
            height: HeightStatus::Unset,
        }
    );
    command(&mut d, SessionCommand::Reset.into());
    assert_eq!(d.snapshot().body, BodyState::NoBody);
    assert_eq!(d.snapshot().body.height(), None);
}

#[test]
fn a_late_body_not_found_for_a_replaced_body_changes_nothing() {
    let mut d = ready();
    let old_render = render_op(&request(&mut d, "M")).unwrap();
    let photo_op = photo(&mut d, "photo-2", PhotoSource::Library);
    complete(
        &mut d,
        photo_op,
        PhotoOutcome::Accepted {
            body_id: id("body-2"),
            estimated_height: HeightCm(181.0),
        }
        .into(),
    );
    let before = d.snapshot().body;
    // The old render was retired with the old body; its failure finds nothing.
    complete(
        &mut d,
        old_render,
        Outcome::Failed {
            error: BackendError::BodyNotFound,
        },
    );
    assert_eq!(d.snapshot().body, before);
}

#[test]
fn only_an_acknowledged_height_carries_the_backend_revision() {
    let mut d = ready();
    let write = set_height(&mut d, 180.0).receipt.operation.unwrap();
    complete(
        &mut d,
        write,
        Outcome::Body {
            outcome: BodyOutcome::HeightSet,
            backend_revision: Some("rev-180".into()),
        },
    );
    assert!(matches!(
        d.snapshot().body.height(),
        Some(HeightStatus::Acknowledged { backend_revision: Some(revision), .. }) if revision == "rev-180"
    ));
    // A new write leaves Acknowledged, and its backend revision with it.
    let next = set_height(&mut d, 182.0).receipt.operation.unwrap();
    assert_eq!(
        d.snapshot().body.height(),
        Some(&HeightStatus::Pending {
            operation: next,
            height: HeightCm(182.0),
        })
    );
}

#[test]
fn a_body_restored_without_a_height_is_live_and_unset() {
    let mut d = DomainEngine::new(config()).unwrap();
    let restore = command(&mut d, SessionCommand::Initialize.into())
        .receipt
        .operation
        .unwrap();
    complete(
        &mut d,
        restore,
        SessionOutcome::Restored {
            body: restored_body(PhotoSource::Library),
        }
        .into(),
    );
    assert_eq!(
        d.snapshot().body,
        BodyState::Live {
            identity: BodyIdentity {
                body_id: id("restored-body"),
                estimated_height: HeightCm(172.0),
            },
            height: HeightStatus::Unset,
        }
    );
}

#[test]
fn a_render_created_without_an_image_fails_its_requests() {
    let mut d = ready();
    let req = request(&mut d, "M");
    let op = render_op(&req).unwrap();
    let out = complete(
        &mut d,
        op,
        TryOnOutcome::Created {
            try_on_id: id("no-image"),
            image_url: String::new().into(),
        }
        .into(),
    );
    assert_eq!(out.receipt.disposition, Disposition::Applied);
    assert!(d.snapshot().try_ons().is_empty());
    let id = req.receipt.try_on_request_id.unwrap();
    assert_eq!(
        d.snapshot().try_on_request(id).unwrap().status,
        TryOnRequestStatus::Failed {
            failure: TryOnRequestFailure::Backend {
                error: BackendError::Unavailable,
            },
        }
    );
}

#[test]
fn an_expired_session_found_on_restore_is_cleared_without_an_event() {
    let mut d = DomainEngine::new(config()).unwrap();
    let restore = command(&mut d, SessionCommand::Initialize.into())
        .receipt
        .operation
        .unwrap();
    let out = complete(&mut d, restore, Outcome::SessionExpired);
    assert_eq!(d.snapshot().session, SessionPhase::Absent);
    let session_effects: Vec<_> = out
        .effects
        .iter()
        .filter_map(|effect| match effect {
            DomainEffect::Session { effect } => Some(effect.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(session_effects, vec![SessionEffect::Clear]);
    assert!(out.events.is_empty());
}
