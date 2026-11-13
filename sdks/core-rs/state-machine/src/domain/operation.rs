//! The operations out with the host, from registration until their
//! completion: each one's identity, how far it has got, and its job. What a
//! job does is its concern's; this module knows none of them.

use std::collections::BTreeMap;

use super::model::{DomainEffect, Job};
use crate::error::Rejection;
use crate::ids::*;

/// Outstanding operations at most.
const MAX_OPERATIONS: usize = 256;

/// The operations awaiting a completion, at most 256, and the sequence
/// their IDs come from.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Operations {
    /// The operations, by ID.
    entries: BTreeMap<OperationId, Operation>,
    /// Mints their IDs.
    ids: Sequence<OperationId>,
}

impl Operations {
    pub fn new(seed: uuid::Uuid) -> Self {
        Self {
            entries: BTreeMap::new(),
            ids: Sequence::new(seed),
        }
    }

    /// Registers an operation: running at once, or queued until the engine
    /// starts it.
    pub fn register(
        &mut self,
        job: Job,
        queued: bool,
        product_id: Option<ProductId>,
    ) -> Result<&mut Operation, Rejection> {
        if self.entries.len() >= MAX_OPERATIONS {
            return Err(Rejection::OperationLimit);
        }
        let id = self.ids.next()?;
        let status = if queued {
            OperationStatus::Queued
        } else {
            OperationStatus::Running
        };
        Ok(self.entries.entry(id).or_insert(Operation {
            id,
            status,
            job,
            product_id,
            result_fit: None,
        }))
    }

    pub fn get(&self, id: OperationId) -> Option<&Operation> {
        self.entries.get(&id)
    }

    pub fn get_mut(&mut self, id: OperationId) -> Option<&mut Operation> {
        self.entries.get_mut(&id)
    }

    pub fn remove(&mut self, id: OperationId) -> Option<Operation> {
        self.entries.remove(&id)
    }

    /// Every operation, by ID.
    pub fn iter(&self) -> impl Iterator<Item = &Operation> {
        self.entries.values()
    }

    pub fn iter_mut(&mut self) -> impl Iterator<Item = &mut Operation> {
        self.entries.values_mut()
    }

    /// Takes every operation, as a reset does.
    pub fn take_all(&mut self) -> Vec<Operation> {
        std::mem::take(&mut self.entries).into_values().collect()
    }

    /// Retires the operations whose job is `outdated`; their late
    /// completions find nothing. Returns those whose effect is out, to
    /// cancel.
    pub fn retire(&mut self, outdated: impl Fn(&Job) -> bool) -> Vec<OperationId> {
        let mut out = Vec::new();
        self.entries.retain(|id, operation| {
            if !outdated(&operation.job) {
                return true;
            }
            if operation.status != OperationStatus::Queued {
                out.push(*id);
            }
            false
        });
        out
    }
}

/// One operation, from registration until its completion.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Operation {
    /// The operation's identity, as its effect and completion carry it.
    pub id: OperationId,
    /// Whether its effect is out, and whether its outcome is known.
    pub status: OperationStatus,
    /// What the host does for it, with the inputs it captured.
    pub job: Job,
    /// The product when the operation was requested.
    pub product_id: Option<ProductId>,
    /// An accepted fit assessment for this render, retained across product changes.
    pub result_fit: Option<super::ResultFit>,
}

impl Operation {
    /// The effect that hands the operation to the host.
    pub fn effect(&self) -> DomainEffect {
        DomainEffect::Start {
            operation: self.id,
            job: self.job.clone(),
        }
    }
}

/// How far an operation has got.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum OperationStatus {
    /// Registered, but its effect is not out yet: a SetHeight waiting for
    /// the body's readers.
    Queued,
    /// Its effect is out, and its outcome is awaited.
    Running,
    /// Its outcome is unknown; only an authoritative one settles it. A
    /// render is only ever uncertain while a request still wants it.
    Uncertain,
}
