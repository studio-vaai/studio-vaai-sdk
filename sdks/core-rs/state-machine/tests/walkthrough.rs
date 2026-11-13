//! A whole journey through a deterministic fake adapter: session, photo,
//! height, try-on, disposal. It answers effects synchronously while their
//! batch is being delivered, which the runtime allows.

use state_machine::*;
use uuid::Uuid;

fn uuid(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

/// The variant in size M, which the fake backend recommends.
fn medium() -> VariantId {
    VariantId(uuid(10))
}

/// The fake backend: every job succeeds at once; the other domain effects
/// need no completion.
fn answer(effect: DomainEffect) -> Option<Completion> {
    let DomainEffect::Start { operation, job } = effect else {
        return None;
    };
    let outcome = match job {
        Job::Session { job } => match job {
            SessionJob::Restore => SessionOutcome::Absent,
            SessionJob::Create { .. } => SessionOutcome::Ready,
        }
        .into(),
        Job::Photo {
            job: PhotoJob::Process { .. },
        } => PhotoOutcome::Accepted {
            body_id: BodyId(uuid(2)),
            estimated_height: HeightCm(172.0),
        }
        .into(),
        Job::Body {
            job: BodyJob::SetHeight { .. },
        } => BodyOutcome::HeightSet.into(),
        Job::Body {
            job: BodyJob::ReadHeight { height, .. },
        } => Outcome::HeightReadback {
            height: Some(height),
            backend_revision: Some("readback-revision".into()),
        },
        Job::SizeRecommendation {
            job: SizeRecommendationJob::Fetch { .. },
        } => SizeRecommendationOutcome::Fetched {
            scores: vec![SizeRecommendationScore {
                variant_ids: vec![medium()],
                aggregate: FitScore {
                    fit_match: FitMatch(0.92),
                    fit: Fit::Ideal,
                },
                axes: vec![FitAxisScore {
                    axis: FitAxis::Chest,
                    fit: Fit::Ideal,
                    dimension: None,
                    label: None,
                }],
            }],
        }
        .into(),
        Job::TryOn {
            job: TryOnJob::Create { key, .. },
        } => TryOnOutcome::Created {
            // The fake backend names each result after its render.
            try_on_id: TryOnId(operation.0),
            image_url: format!("https://example.invalid/{}.png", key.variant_id).into(),
        }
        .into(),
    };
    Some(Completion { operation, outcome })
}

/// Delivers every batch, completing domain effects as they are started.
fn pump(session: &TryOnSession, driver: &EffectDriver) -> Vec<FlowEvent> {
    let mut events = Vec::new();
    while let Some(batch) = driver.next_batch().unwrap() {
        for effect in batch.effects {
            match effect {
                Effect::DomainEffect { effect } => {
                    if let Some(completion) = answer(effect) {
                        session.complete(completion).unwrap();
                    }
                }
                Effect::FlowEvent { event, .. } => events.push(event),
                Effect::DomainEvent { .. } => {}
                // The picker is answered explicitly below.
                Effect::DeviceEffect { .. } => {}
            }
        }
        driver.acknowledge(batch.id).unwrap();
    }
    events
}

#[test]
fn a_whole_journey_with_a_fake_adapter() {
    let session = TryOnSession::new(SessionConfig::new(RuntimeId(uuid(42)))).unwrap();
    let driver = session.claim_effect_driver().unwrap();
    let product = Product {
        id: ProductId(uuid(1)),
        variants: ["M", "L"]
            .into_iter()
            .zip(10..)
            .map(|(size, n)| Variant {
                id: VariantId(uuid(n)),
                foreign_ids: [("size".into(), size.into())].into_iter().collect(),
            })
            .collect(),
    };
    let sizes = VariantAxis {
        role: None,
        key: "size".into(),
        label: Some("Size".into()),
        display_options: None,
        items: ["M", "L"]
            .into_iter()
            .map(|size| AxisItem {
                key: size.into(),
                display: ItemDisplay::Text { text: size.into() },
            })
            .collect(),
    };
    let flow = DefaultTryOnFlow::new(
        session.clone(),
        FlowConfig {
            host_product: HostProduct {
                label_formats: vec![],
                product,
                axes: vec![sizes],
                variant_id: medium(),
                chosen_axes: vec!["size".into()],
            },
            auto_start: AutoStartPolicy::Never,
        },
    )
    .unwrap();
    pump(&session, &driver);
    flow.dispatch(PresenceAction::Open.into()).unwrap();
    flow.dispatch(SessionAction::SetConsent { accepted: true }.into())
        .unwrap();
    // A web adapter opens its picker synchronously, inside this gesture.
    flow.dispatch(
        PhotoAction::BeginSource {
            source: PhotoSource::Library,
        }
        .into(),
    )
    .unwrap();
    pump(&session, &driver);
    let Some(Modal::Picker { token }) = flow.view().unwrap().modal else {
        panic!("no picker");
    };
    flow.complete_device(
        PickerEvent::Selected {
            token,
            media: MediaId(uuid(3)),
        }
        .into(),
    )
    .unwrap();
    pump(&session, &driver);
    assert!(matches!(
        flow.view().unwrap().screen,
        ScreenView::Height { .. }
    ));
    flow.dispatch(
        HeightAction::Edit {
            height: HeightCm(175.0),
        }
        .into(),
    )
    .unwrap();
    flow.dispatch(HeightAction::Confirm.into()).unwrap();
    // The view moves on at once; SetHeight is still pending.
    assert!(matches!(
        flow.view().unwrap().screen,
        ScreenView::TryOn { .. }
    ));
    flow.dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    let events = pump(&session, &driver);
    let view = flow.view().unwrap();
    let ScreenView::TryOn { presentation, .. } = &view.screen else {
        panic!("not the try-on screen");
    };
    let DisplayedImage::TryOn { try_on_id } = presentation.displayed else {
        panic!("no displayed try-on");
    };
    let record = view.domain.try_on(try_on_id).unwrap().clone();
    assert_eq!(record.key.variant_id, medium());
    assert!(events.iter().any(|n| matches!(
        n,
        FlowEvent::Presentation {
            event: PresentationEvent::TryOnSelected { try_on_id },
        } if *try_on_id == record.id
    )));
    flow.dispatch(PresenceAction::Dispose.into()).unwrap();
    session.command(SessionCommand::Dispose.into()).unwrap();
    pump(&session, &driver);
    assert_eq!(session.snapshot().unwrap().session, SessionPhase::Disposed);
}
