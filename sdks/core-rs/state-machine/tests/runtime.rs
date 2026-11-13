//! The runtime: atomic composition, the single driver and ordered delivery.

mod common;

use common::*;
use state_machine::*;

#[test]
fn exclusive_effect_driver() {
    let session = TryOnSession::new(config()).unwrap();
    let first = session.claim_effect_driver().unwrap();
    assert!(matches!(
        session.claim_effect_driver(),
        Err(TryOnError::DriverAlreadyClaimed)
    ));
    drop(first);
    assert!(session.claim_effect_driver().is_ok());
}

#[test]
fn next_batch_requires_ordered_acknowledgment() {
    let session = TryOnSession::new(config()).unwrap();
    let driver = session.claim_effect_driver().unwrap();
    let batch = driver.next_batch().unwrap().unwrap();
    assert!(matches!(
        driver.next_batch(),
        Err(TryOnError::BatchNotAcknowledged)
    ));
    assert!(matches!(
        driver.acknowledge(id("other-batch")),
        Err(TryOnError::WrongBatch)
    ));
    driver.acknowledge(batch.id).unwrap();
    assert!(driver.next_batch().unwrap().is_none());
}

#[test]
fn synchronous_callback_can_reenter_without_deadlock() {
    let session = TryOnSession::new(config()).unwrap();
    let driver = session.claim_effect_driver().unwrap();
    let batch = driver.next_batch().unwrap().unwrap();
    for effect in batch.effects {
        if let Effect::DomainEffect {
            effect:
                DomainEffect::Start {
                    operation,
                    job:
                        Job::Session {
                            job: SessionJob::Restore,
                        },
                },
        } = effect
        {
            session
                .complete(Completion {
                    operation,
                    outcome: SessionOutcome::Absent.into(),
                })
                .unwrap();
        }
    }
    driver.acknowledge(batch.id).unwrap();
    assert_eq!(session.snapshot().unwrap().session, SessionPhase::Absent);
}

#[test]
fn dropping_partial_batch_halts_instead_of_replaying_unknown_effects() {
    let session = TryOnSession::new(config()).unwrap();
    let driver = session.claim_effect_driver().unwrap();
    driver.next_batch().unwrap().unwrap();
    drop(driver);
    assert!(matches!(
        session.claim_effect_driver(),
        Err(TryOnError::DeliveryHalted)
    ));
    assert!(session.snapshot().is_ok());
}

#[test]
fn invalid_selection_rolls_back_ui_and_domain() {
    let f = Fixture::ready();
    let before = f.flow.view().unwrap();
    let domain = f.session.snapshot().unwrap();
    let out = f.flow.dispatch(
        SelectionAction::SelectItem {
            axis: "size".into(),
            item: "NOT_A_SIZE".into(),
        }
        .into(),
    );
    assert!(matches!(out, Err(TryOnError::Rejected { .. })));
    assert_eq!(before, f.flow.view().unwrap());
    assert_eq!(domain, f.session.snapshot().unwrap());
}

#[test]
fn a_new_flow_replaces_the_sessions_flow() {
    let Fixture {
        session,
        flow: old,
        driver,
    } = Fixture::ready();
    drain(&driver);
    let new = DefaultTryOnFlow::new(session.clone(), flow_config()).unwrap();
    // The old flow was disposed, and its handle refuses every call.
    assert!(drain(&driver).iter().any(|e| matches!(
        e,
        Effect::FlowEvent {
            event: FlowEvent::Journey {
                event: JourneyEvent::Closed { .. }
            },
        }
    )));
    assert!(matches!(old.view(), Err(TryOnError::FlowReplaced)));
    assert!(matches!(
        old.dispatch(PresenceAction::Open.into()),
        Err(TryOnError::FlowReplaced)
    ));
    // The new one takes over the session as it stands, body included.
    new.dispatch(PresenceAction::Open.into()).unwrap();
    assert!(new.view().unwrap().domain.body.identity().is_some());
    // Dropping the old handle leaves the new flow alone.
    drop(old);
    assert!(new.view().unwrap().presence.open);
    assert_eq!(session.snapshot().unwrap().session, SessionPhase::Ready);
}

#[test]
fn flow_disposal_does_not_reset_shared_session() {
    let f = Fixture::ready();
    f.flow.dispatch(PresenceAction::Dispose.into()).unwrap();
    assert!(f.flow.view().unwrap().presence.disposed);
    assert_eq!(f.session.snapshot().unwrap().session, SessionPhase::Ready);
}

#[test]
fn dropping_a_flow_disposes_and_removes_it() {
    let Fixture {
        session,
        flow,
        driver,
    } = Fixture::ready();
    drain(&driver);
    drop(flow);
    assert!(drain(&driver).iter().any(|e| matches!(
        e,
        Effect::FlowEvent {
            event: FlowEvent::Journey {
                event: JourneyEvent::Closed { .. }
            },
        }
    )));
    // The session has no flow now; a new one takes its place.
    let flow = DefaultTryOnFlow::new(session, flow_config()).unwrap();
    assert!(!flow.view().unwrap().presence.disposed);
}

#[test]
fn queued_batches_keep_their_own_flow_views_and_revisions() {
    let f = Fixture::ready();
    drain(&f.driver);
    let closed = f.flow.dispatch(PresenceAction::Close.into()).unwrap();
    let opened = f.flow.dispatch(PresenceAction::Open.into()).unwrap();

    let close_batch = f.driver.next_batch().unwrap().unwrap();
    assert_eq!(close_batch.revision, closed.revision);
    let transition = close_batch.flow.unwrap();
    assert!(transition.before.unwrap().presence.open);
    assert_eq!(*transition.after.unwrap(), closed.view);
    f.driver.acknowledge(close_batch.id).unwrap();

    let open_batch = f.driver.next_batch().unwrap().unwrap();
    assert_eq!(open_batch.revision, opened.revision);
    let transition = open_batch.flow.unwrap();
    assert!(!transition.before.unwrap().presence.open);
    assert_eq!(*transition.after.unwrap(), opened.view);
    f.driver.acknowledge(open_batch.id).unwrap();
}
