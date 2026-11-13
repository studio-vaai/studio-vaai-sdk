//! Every ordering of a bounded scenario, run on the actual reducer (not a
//! second model): 7 actions, 5,040 orderings.

mod common;

use common::*;
use state_machine::domain::DomainEngine;
use state_machine::*;

#[derive(Clone, Copy, Debug)]
enum Action {
    RequestL,
    CompleteM,
    Reset,
    SetHeight,
    Replace,
    CancelM,
    DuplicateM,
}

/// The identities that must hold after every step.
fn check(d: &DomainEngine) {
    let snapshot = d.snapshot();
    for result in snapshot.try_ons() {
        assert!(snapshot.body.identity().is_some(), "result without body");
        assert!(
            snapshot
                .body
                .acknowledged()
                .is_none_or(|current| result.key.body_revision <= current)
        );
        assert_eq!(result.key.variant_id, id("M"));
    }
    if snapshot.session != SessionPhase::Ready {
        assert!(snapshot.try_ons().is_empty());
    }
}

struct Scenario {
    base: DomainEngine,
    render: OperationId,
    try_on_request_id: TryOnRequestId,
    photo: OperationId,
}

impl Scenario {
    fn input(&self, d: &DomainEngine, action: Action) -> Option<DomainInput> {
        Some(match action {
            Action::RequestL => DomainInput::Command(
                TryOnCommand::Request {
                    origin: None,
                    variant_id: id("L"),
                    target: d.snapshot().body_target()?,
                }
                .into(),
            ),
            Action::CompleteM | Action::DuplicateM => DomainInput::Completion(Completion {
                operation: self.render,
                outcome: TryOnOutcome::Created {
                    try_on_id: id("M"),
                    image_url: "m-image".into(),
                }
                .into(),
            }),
            Action::Reset => DomainInput::Command(SessionCommand::Reset.into()),
            Action::SetHeight => DomainInput::Command(
                BodyCommand::SetHeight {
                    height: HeightCm(180.0),
                }
                .into(),
            ),
            Action::Replace => DomainInput::Completion(Completion {
                operation: self.photo,
                outcome: PhotoOutcome::Accepted {
                    body_id: id("new-body"),
                    estimated_height: HeightCm(180.0),
                }
                .into(),
            }),
            Action::CancelM => DomainInput::Command(
                TryOnCommand::DetachRequest {
                    try_on_request_id: self.try_on_request_id,
                }
                .into(),
            ),
        })
    }

    fn run(&self, order: &[Action]) {
        let mut d = self.base.clone();
        for &action in order {
            let Some(input) = self.input(&d, action) else {
                continue;
            };
            let before = d.snapshot();
            let out = d.dispatch(input);
            if matches!(out.receipt.disposition, Disposition::Rejected { .. }) {
                assert_eq!(before, d.snapshot(), "{order:?}");
            }
            check(&d);
        }
    }

    fn explore(&self, prefix: &mut Vec<Action>, remaining: &[Action], count: &mut usize) {
        if remaining.is_empty() {
            self.run(prefix);
            *count += 1;
            return;
        }
        for i in 0..remaining.len() {
            let mut rest = remaining.to_vec();
            prefix.push(rest.remove(i));
            self.explore(prefix, &rest, count);
            prefix.pop();
        }
    }
}

#[test]
fn all_5040_orderings_preserve_identity_and_scope() {
    let mut base = ready();
    let request = request(&mut base, "M");
    let photo = command(
        &mut base,
        PhotoCommand::Process {
            photo: Photo {
                media: id("candidate"),
                source: PhotoSource::Library,
            },
        }
        .into(),
    )
    .receipt
    .operation
    .unwrap();
    let scenario = Scenario {
        render: render_op(&request).unwrap(),
        try_on_request_id: request.receipt.try_on_request_id.unwrap(),
        photo,
        base,
    };
    let mut count = 0;
    scenario.explore(
        &mut Vec::new(),
        &[
            Action::RequestL,
            Action::CompleteM,
            Action::Reset,
            Action::SetHeight,
            Action::Replace,
            Action::CancelM,
            Action::DuplicateM,
        ],
        &mut count,
    );
    assert_eq!(count, 5040);
}
