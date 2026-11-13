#![allow(dead_code)]

use std::sync::Arc;

use state_machine::domain::DomainEngine;
use state_machine::*;
use uuid::Uuid;

/// The identifier whose UUID spells `name` (at most 16 bytes), so tests can
/// name their identifiers.
pub fn id<T: From<Uuid>>(name: &str) -> T {
    let mut bytes = [0; 16];
    bytes[..name.len()].copy_from_slice(name.as_bytes());
    Uuid::from_bytes(bytes).into()
}

/// The identifier numbered `n`.
pub fn nth<T: From<Uuid>>(n: u64) -> T {
    Uuid::from_u128(n.into()).into()
}

/// What a test reads of the screen a view shows; each panics if the view
/// shows another screen.
pub trait ScreenOf {
    /// The try-on screen's selection.
    fn selection(&self) -> &SelectionView;
    /// The try-on screen's presentation.
    fn presentation(&self) -> &PresentationView;
    /// The camera screen's camera.
    fn camera(&self) -> &CameraState;
    /// The introduction's consent.
    fn consent_given(&self) -> bool;
}

impl ScreenOf for FlowView {
    fn selection(&self) -> &SelectionView {
        match &self.screen {
            ScreenView::TryOn { selection, .. } => selection,
            other => panic!("not the try-on screen: {other:?}"),
        }
    }

    fn presentation(&self) -> &PresentationView {
        match &self.screen {
            ScreenView::TryOn { presentation, .. } => presentation,
            other => panic!("not the try-on screen: {other:?}"),
        }
    }

    fn camera(&self) -> &CameraState {
        match &self.screen {
            ScreenView::Camera { camera, .. } => camera,
            other => panic!("not the camera screen: {other:?}"),
        }
    }

    fn consent_given(&self) -> bool {
        match &self.screen {
            ScreenView::Introduction { consent_given } => *consent_given,
            other => panic!("not the introduction: {other:?}"),
        }
    }
}

/// The try-on the view's main image shows, if it shows one.
pub fn displayed_try_on(view: FlowView) -> Option<TryOn> {
    match view.presentation().displayed {
        DisplayedImage::TryOn { try_on_id } => view.domain.try_on(try_on_id).cloned(),
        DisplayedImage::SourcePhoto => None,
    }
}

/// A session configuration with the default limits.
pub fn config() -> SessionConfig {
    SessionConfig::new(id("runtime"))
}

/// Foreign IDs from axis and item pairs.
pub fn foreign(pairs: &[(&str, &str)]) -> ForeignIds {
    pairs
        .iter()
        .map(|(axis, item)| ((*axis).into(), (*item).into()))
        .collect()
}

/// An item shown as its own key.
pub fn item(key: &str) -> AxisItem {
    AxisItem {
        key: key.into(),
        display: ItemDisplay::Text { text: key.into() },
    }
}

/// An axis shown with these items, in this order.
pub fn axis(key: &str, items: &[&str]) -> VariantAxis {
    VariantAxis {
        role: None,
        key: key.into(),
        label: Some(key.into()),
        display_options: None,
        items: items.iter().copied().map(item).collect(),
    }
}

/// Jeans in M, L and XL, each variant named after its size.
pub fn product() -> Product {
    Product {
        id: id("jeans"),
        variants: ["M", "L", "XL"]
            .into_iter()
            .map(|size| Variant {
                id: id(size),
                foreign_ids: foreign(&[("size", size)]),
            })
            .collect(),
    }
}

pub fn command(engine: &mut DomainEngine, command: DomainCommand) -> DomainOutput {
    let out = engine.dispatch(DomainInput::Command(command));
    assert!(
        !matches!(out.receipt.disposition, Disposition::Rejected { .. }),
        "{:?}",
        out.receipt
    );
    out
}

pub fn complete(
    engine: &mut DomainEngine,
    operation: OperationId,
    outcome: Outcome,
) -> DomainOutput {
    let out = engine.dispatch(DomainInput::Completion(Completion { operation, outcome }));
    assert!(
        !matches!(out.receipt.disposition, Disposition::Rejected { .. }),
        "{:?}",
        out.receipt
    );
    out
}

/// A domain with a consented session, a committed photo and an acknowledged
/// height of 175 cm.
pub fn ready() -> DomainEngine {
    ready_with(config())
}

/// `ready`, with this session configuration.
pub fn ready_with(config: SessionConfig) -> DomainEngine {
    let mut d = DomainEngine::new(config).unwrap();
    let op = command(&mut d, SessionCommand::Initialize.into())
        .receipt
        .operation
        .unwrap();
    complete(&mut d, op, SessionOutcome::Absent.into());
    let create = SessionCommand::Create {
        data_processing_consent: DataProcessingConsent::Granted,
    };
    let op = command(&mut d, create.into()).receipt.operation.unwrap();
    complete(&mut d, op, SessionOutcome::Ready.into());
    command(
        &mut d,
        ProductCommand::Show {
            product: product(),
            unavailable_variants: None,
        }
        .into(),
    );
    let op = command(
        &mut d,
        PhotoCommand::Process {
            photo: Photo {
                media: id("photo-1"),
                source: PhotoSource::Library,
            },
        }
        .into(),
    )
    .receipt
    .operation
    .unwrap();
    complete(
        &mut d,
        op,
        PhotoOutcome::Accepted {
            body_id: id("body-1"),
            estimated_height: HeightCm(170.0),
        }
        .into(),
    );
    let op = command(
        &mut d,
        BodyCommand::SetHeight {
            height: HeightCm(175.0),
        }
        .into(),
    )
    .receipt
    .operation
    .unwrap();
    complete(&mut d, op, BodyOutcome::HeightSet.into());
    d
}

pub fn request(d: &mut DomainEngine, size: &str) -> DomainOutput {
    let target = d.snapshot().body_target().unwrap();
    command(
        d,
        TryOnCommand::Request {
            origin: None,
            variant_id: id(size),
            target,
        }
        .into(),
    )
}

pub fn render_op(out: &DomainOutput) -> Option<OperationId> {
    out.effects.iter().find_map(|e| match e {
        DomainEffect::Start {
            operation,
            job: Job::TryOn {
                job: TryOnJob::Create { .. },
            },
        } => Some(*operation),
        _ => None,
    })
}

/// The score of the size `variant_ids` are in: `fit_match` overall, ideal,
/// with no measurement compared.
pub fn score(variant_ids: &[VariantId], fit_match: f64) -> SizeRecommendationScore {
    SizeRecommendationScore {
        variant_ids: variant_ids.to_vec(),
        aggregate: FitScore {
            fit_match: FitMatch(fit_match),
            fit: Fit::Ideal,
        },
        axes: vec![],
    }
}

/// Completes try-on `op` as refused: the garment is too small.
pub fn refused(d: &mut DomainEngine, op: OperationId) -> DomainOutput {
    complete(
        d,
        op,
        TryOnOutcome::Refused {
            reason: RefusalReason::GarmentTooSmall,
        }
        .into(),
    )
}

pub fn rendered(d: &mut DomainEngine, op: OperationId, name: &str) -> DomainOutput {
    complete(
        d,
        op,
        TryOnOutcome::Created {
            try_on_id: id(name),
            image_url: format!("https://example.invalid/{name}").into(),
        }
        .into(),
    )
}

pub fn host_product() -> HostProduct {
    HostProduct {
        label_formats: vec![],
        product: product(),
        axes: vec![axis("size", &["M", "L", "XL"])],
        variant_id: id("M"),
        chosen_axes: vec!["size".into()],
    }
}

pub fn flow_config() -> FlowConfig {
    FlowConfig {
        host_product: host_product(),
        auto_start: AutoStartPolicy::Never,
    }
}

/// Every pending effect, each batch acknowledged.
pub fn drain(driver: &EffectDriver) -> Vec<Effect> {
    let mut effects = Vec::new();
    while let Some(batch) = driver.next_batch().unwrap() {
        effects.extend(batch.effects);
        driver.acknowledge(batch.id).unwrap();
    }
    effects
}

pub fn render_effect(driver: &EffectDriver) -> OperationId {
    drain(driver)
        .iter()
        .find_map(|e| match e {
            Effect::DomainEffect {
                effect:
                    DomainEffect::Start {
                        operation,
                        job:
                            Job::TryOn {
                                job: TryOnJob::Create { .. },
                            },
                    },
            } => Some(*operation),
            _ => None,
        })
        .unwrap()
}

pub fn replace_with_library(f: &Fixture) {
    f.flow.dispatch(PhotoAction::Replace.into()).unwrap();
    assert_eq!(f.flow.view().unwrap().modal, Some(Modal::ChoosePhotoSource));
    f.flow
        .dispatch(
            PhotoAction::BeginSource {
                source: PhotoSource::Library,
            }
            .into(),
        )
        .unwrap();
}

pub struct Fixture {
    pub session: Arc<TryOnSession>,
    pub flow: Arc<DefaultTryOnFlow>,
    pub driver: Arc<EffectDriver>,
}

impl Fixture {
    /// An open flow over a consented, ready session without a photo.
    pub fn new() -> Self {
        Self::with(flow_config())
    }

    /// `new`, with this flow configuration.
    pub fn with(setup: FlowConfig) -> Self {
        Self::with_session_config(setup, config())
    }

    pub fn with_session_config(setup: FlowConfig, session_config: SessionConfig) -> Self {
        let session = TryOnSession::new(session_config).unwrap();
        let driver = session.claim_effect_driver().unwrap();
        let flow = DefaultTryOnFlow::new(session.clone(), setup).unwrap();
        let op = drain(&driver)
            .iter()
            .find_map(|e| match e {
                Effect::DomainEffect {
                    effect:
                        DomainEffect::Start {
                            operation,
                            job:
                                Job::Session {
                                    job: SessionJob::Restore,
                                },
                        },
                } => Some(*operation),
                _ => None,
            })
            .unwrap();
        session
            .complete(Completion {
                operation: op,
                outcome: SessionOutcome::Absent.into(),
            })
            .unwrap();
        flow.dispatch(PresenceAction::Open.into()).unwrap();
        flow.dispatch(SessionAction::SetConsent { accepted: true }.into())
            .unwrap();
        let create = SessionCommand::Create {
            data_processing_consent: DataProcessingConsent::Granted,
        };
        let op = session.command(create.into()).unwrap().operation.unwrap();
        session
            .complete(Completion {
                operation: op,
                outcome: SessionOutcome::Ready.into(),
            })
            .unwrap();
        drain(&driver);
        Self {
            session,
            flow,
            driver,
        }
    }

    /// `new`, with a committed photo, a set height and an empty
    /// recommendation, on the try-on route.
    pub fn ready() -> Self {
        let (f, _) = Self::ready_with(flow_config(), vec![]);
        f
    }

    /// `ready` with this flow configuration and recommendation, and the
    /// effects that followed the recommendation.
    pub fn ready_with(
        config: FlowConfig,
        scores: Vec<SizeRecommendationScore>,
    ) -> (Self, Vec<Effect>) {
        Self::ready_with_session(config, scores, self::config())
    }

    pub fn ready_with_session(
        config: FlowConfig,
        scores: Vec<SizeRecommendationScore>,
        session_config: SessionConfig,
    ) -> (Self, Vec<Effect>) {
        let f = Self::with_session_config(config, session_config);
        let op = f
            .session
            .command(
                PhotoCommand::Process {
                    photo: Photo {
                        media: id("photo-1"),
                        source: PhotoSource::Library,
                    },
                }
                .into(),
            )
            .unwrap()
            .operation
            .unwrap();
        f.session
            .complete(Completion {
                operation: op,
                outcome: PhotoOutcome::Accepted {
                    body_id: id("body-1"),
                    estimated_height: HeightCm(170.0),
                }
                .into(),
            })
            .unwrap();
        f.flow
            .dispatch(
                HeightAction::Edit {
                    height: HeightCm(175.0),
                }
                .into(),
            )
            .unwrap();
        f.flow.dispatch(HeightAction::Confirm.into()).unwrap();
        let op = f
            .session
            .snapshot()
            .unwrap()
            .body
            .height()
            .and_then(HeightStatus::outstanding)
            .unwrap();
        f.session
            .complete(Completion {
                operation: op,
                outcome: BodyOutcome::HeightSet.into(),
            })
            .unwrap();
        // The default experience asks for a recommendation by itself.
        let recommend = drain(&f.driver)
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
            .expect("a recommendation request");
        f.session
            .complete(Completion {
                operation: recommend,
                outcome: SizeRecommendationOutcome::Fetched { scores }.into(),
            })
            .unwrap();
        let effects = drain(&f.driver);
        (f, effects)
    }
}
