//! Consent in the default experience: the flow keeps the shopper's answer
//! and attests it when it creates the session, and a session implies it.

mod common;

use std::sync::Arc;

use common::*;
use state_machine::*;

/// The session jobs `effects` start.
fn session_jobs(effects: &[Effect]) -> Vec<(OperationId, SessionJob)> {
    effects
        .iter()
        .filter_map(|e| match e {
            Effect::DomainEffect {
                effect:
                    DomainEffect::Start {
                        operation,
                        job: Job::Session { job },
                    },
            } => Some((*operation, job.clone())),
            _ => None,
        })
        .collect()
}

/// An open flow with restoration pending when a stored session is expected.
fn opened(stored: bool) -> (Arc<TryOnSession>, Arc<EffectDriver>, Arc<DefaultTryOnFlow>) {
    let session = TryOnSession::new(config()).unwrap();
    let driver = session.claim_effect_driver().unwrap();
    let flow = DefaultTryOnFlow::new(session.clone(), flow_config()).unwrap();
    if !stored {
        let [(operation, SessionJob::Restore)] = session_jobs(&drain(&driver))[..] else {
            panic!("no restoration");
        };
        session
            .complete(Completion {
                operation,
                outcome: SessionOutcome::Absent.into(),
            })
            .unwrap();
    }
    flow.dispatch(PresenceAction::Open.into()).unwrap();
    (session, driver, flow)
}

fn begin_library(flow: &DefaultTryOnFlow) -> Result<FlowUpdate, TryOnError> {
    flow.dispatch(
        PhotoAction::BeginSource {
            source: PhotoSource::Library,
        }
        .into(),
    )
}

fn consent(flow: &DefaultTryOnFlow, accepted: bool) -> Result<FlowUpdate, TryOnError> {
    flow.dispatch(SessionAction::SetConsent { accepted }.into())
}

fn rejected(reason: Rejection) -> TryOnError {
    TryOnError::Rejected { reason }
}

/// The session job that creates a session with the shopper's consent.
fn creating() -> SessionJob {
    SessionJob::Create {
        data_processing_consent: DataProcessingConsent::Granted,
    }
}

#[test]
fn creating_a_session_attests_the_flows_consent() {
    let (_session, driver, flow) = opened(false);
    assert!(!flow.view().unwrap().consent_given());
    assert_eq!(
        begin_library(&flow).unwrap().view.issue,
        Some(Issue::ConsentRequired)
    );
    // Consenting creates nothing yet: the flow keeps the answer.
    assert!(consent(&flow, true).unwrap().view.consent_given());
    assert!(session_jobs(&drain(&driver)).is_empty());
    begin_library(&flow).unwrap();
    let jobs: Vec<_> = session_jobs(&drain(&driver))
        .into_iter()
        .map(|(_, job)| job)
        .collect();
    assert_eq!(jobs, [creating()]);
}

#[test]
fn a_restored_session_implies_consent() {
    let (session, driver, flow) = opened(true);
    let [(operation, SessionJob::Restore)] = session_jobs(&drain(&driver))[..] else {
        panic!("no validation");
    };
    session
        .complete(Completion {
            operation,
            outcome: SessionOutcome::Ready.into(),
        })
        .unwrap();
    assert!(flow.view().unwrap().consent_given());
    begin_library(&flow).unwrap();
    assert!(session_jobs(&drain(&driver)).is_empty());
    // The consent checkbox only edits the choice before a session is established.
    flow.dispatch(NavigationAction::CancelModal.into()).unwrap();
    assert_eq!(
        consent(&flow, false).unwrap_err(),
        rejected(Rejection::ConsentFormInactive)
    );
    session.command(SessionCommand::Reset.into()).unwrap();
    assert!(!flow.view().unwrap().consent_given());
}

#[test]
fn declining_drops_a_session_being_created() {
    let (session, driver, flow) = opened(false);
    consent(&flow, true).unwrap();
    begin_library(&flow).unwrap();
    let [(operation, _)] = session_jobs(&drain(&driver))[..] else {
        panic!("no creation");
    };
    let view = consent(&flow, false).unwrap().view;
    assert!(!view.consent_given());
    assert_eq!(view.modal, None);
    assert_eq!(view.domain.session, SessionPhase::Absent);
    assert!(drain(&driver).iter().any(|e| matches!(
        e,
        Effect::DomainEffect {
            effect: DomainEffect::Cancel { operation: cancelled },
        } if *cancelled == operation
    )));
    assert_eq!(session.snapshot().unwrap().session, SessionPhase::Absent);
}

#[test]
fn a_failed_creation_is_created_again_from_a_photo_source() {
    let (session, driver, flow) = opened(false);
    consent(&flow, true).unwrap();
    begin_library(&flow).unwrap();
    let [(operation, _)] = session_jobs(&drain(&driver))[..] else {
        panic!("no creation");
    };
    session
        .complete(Completion {
            operation,
            outcome: Outcome::Failed {
                error: BackendError::Unavailable,
            },
        })
        .unwrap();
    drain(&driver);
    assert_eq!(
        session.snapshot().unwrap().session,
        SessionPhase::CreateFailed
    );
    begin_library(&flow).unwrap();
    let jobs: Vec<_> = session_jobs(&drain(&driver))
        .into_iter()
        .map(|(_, job)| job)
        .collect();
    assert_eq!(jobs, [creating()]);
}

#[test]
fn an_unconfirmed_creation_fails_and_is_created_again() {
    let (session, driver, flow) = opened(false);
    consent(&flow, true).unwrap();
    begin_library(&flow).unwrap();
    let [(operation, _)] = session_jobs(&drain(&driver))[..] else {
        panic!("no creation");
    };
    session
        .complete(Completion {
            operation,
            outcome: Outcome::Unknown,
        })
        .unwrap();
    let snapshot = session.snapshot().unwrap();
    assert_eq!(snapshot.session, SessionPhase::CreateFailed);
    assert!(snapshot.uncertain_operations.is_empty());
    assert!(drain(&driver).iter().any(|e| matches!(
        e,
        Effect::DomainEvent {
            event: DomainEvent::Session {
                event: SessionEvent::Failed { .. }
            },
        }
    )));
    // A late outcome of the abandoned creation finds nothing.
    session
        .complete(Completion {
            operation,
            outcome: Outcome::Session {
                outcome: SessionOutcome::Ready,
            },
        })
        .unwrap();
    assert_eq!(
        session.snapshot().unwrap().session,
        SessionPhase::CreateFailed
    );
    begin_library(&flow).unwrap();
    let jobs: Vec<_> = session_jobs(&drain(&driver))
        .into_iter()
        .map(|(_, job)| job)
        .collect();
    assert_eq!(jobs, [creating()]);
}

#[test]
fn retry_after_a_failed_creation_is_refused() {
    let (session, driver, flow) = opened(false);
    consent(&flow, true).unwrap();
    begin_library(&flow).unwrap();
    let [(operation, _)] = session_jobs(&drain(&driver))[..] else {
        panic!("no creation");
    };
    session
        .complete(Completion {
            operation,
            outcome: Outcome::Failed {
                error: BackendError::Unavailable,
            },
        })
        .unwrap();
    assert_eq!(
        flow.dispatch(SessionAction::Retry.into()).unwrap_err(),
        rejected(Rejection::NothingToRetry)
    );
}

#[test]
fn a_new_flow_does_not_inherit_consent() {
    let (session, _driver, flow) = opened(false);
    consent(&flow, true).unwrap();
    let new = DefaultTryOnFlow::new(session, flow_config()).unwrap();
    new.dispatch(PresenceAction::Open.into()).unwrap();
    assert!(!new.view().unwrap().consent_given());
    assert_eq!(
        begin_library(&new).unwrap().view.issue,
        Some(Issue::ConsentRequired)
    );
}

#[test]
fn the_camera_waiting_for_the_session_opens_after_a_suspension() {
    let (session, driver, flow) = opened(false);
    consent(&flow, true).unwrap();
    flow.dispatch(
        PhotoAction::BeginSource {
            source: PhotoSource::Camera,
        }
        .into(),
    )
    .unwrap();
    let [(create, _)] = session_jobs(&drain(&driver))[..] else {
        panic!("no session created");
    };
    assert_eq!(*flow.view().unwrap().camera(), CameraState::Dormant);
    flow.dispatch(PresenceAction::Suspend.into()).unwrap();
    flow.dispatch(PresenceAction::Resume.into()).unwrap();
    session
        .complete(Completion {
            operation: create,
            outcome: SessionOutcome::Ready.into(),
        })
        .unwrap();
    assert!(matches!(
        flow.view().unwrap().camera(),
        CameraState::Acquiring { .. }
    ));
}

#[test]
fn a_photo_picked_before_the_session_is_sent_after_closing() {
    let (session, driver, flow) = opened(false);
    consent(&flow, true).unwrap();
    let token = match begin_library(&flow).unwrap().view.modal {
        Some(Modal::Picker { token }) => token,
        other => panic!("no picker: {other:?}"),
    };
    let [(create, _)] = session_jobs(&drain(&driver))[..] else {
        panic!("no session created");
    };
    flow.complete_device(
        PickerEvent::Selected {
            token,
            media: id("early"),
        }
        .into(),
    )
    .unwrap();
    flow.dispatch(PresenceAction::Close.into()).unwrap();
    session
        .complete(Completion {
            operation: create,
            outcome: SessionOutcome::Ready.into(),
        })
        .unwrap();
    let sent = drain(&driver).into_iter().any(|e| {
        matches!(
            e,
            Effect::DomainEffect {
                effect: DomainEffect::Start {
                    job: Job::Photo {
                        job: PhotoJob::Process { photo, .. }
                    },
                    ..
                }
            } if photo.media == id::<MediaId>("early")
        )
    });
    assert!(sent, "the photo waited for the session, not for the flow");
}

#[test]
fn a_failed_restore_is_retried_not_replaced() {
    let (session, driver, flow) = opened(true);
    let [(validate, SessionJob::Restore)] = session_jobs(&drain(&driver))[..] else {
        panic!("no validation");
    };
    session
        .complete(Completion {
            operation: validate,
            outcome: Outcome::Failed {
                error: BackendError::Unavailable,
            },
        })
        .unwrap();
    consent(&flow, true).unwrap();
    assert_eq!(
        begin_library(&flow).unwrap_err(),
        rejected(Rejection::SessionRestoreFailed)
    );
    flow.dispatch(PresenceAction::Close.into()).unwrap();
    assert_eq!(
        flow.dispatch(SessionAction::Retry.into()).unwrap_err(),
        rejected(Rejection::NotVisible)
    );
}
