//! What the runtime hands its effect driver.

use crate::domain::{DomainEffect, DomainEvent};
use crate::experience::model::{DeviceEffect, FlowEvent, FlowView};
use crate::ids::{BatchId, RuntimeRevision};

/// The effects one committed transition produced. Start them in order, then
/// acknowledge the batch.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct EffectBatch {
    /// The batch's ID, which `acknowledge` and `halt` take.
    pub id: BatchId,
    /// The runtime revision that committed them.
    pub revision: RuntimeRevision,
    /// The flow projection of this exact commit, when a flow is attached.
    pub flow: Option<FlowTransition>,
    /// The effects, in the order to start them.
    pub effects: Vec<Effect>,
    /// Shopper events from this commit, with their product and step attached.
    pub experience_events: Vec<super::experience_events::ExperienceEvent>,
}

/// The snapshots that belong to this batch, independent of later commits.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FlowTransition {
    pub before: Option<Box<FlowView>>,
    pub after: Option<Box<FlowView>>,
}

/// One unit of work or one fact for the host, in delivery order.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Effect {
    /// Work for the session's network and storage adapters.
    DomainEffect {
        /// What to do.
        effect: DomainEffect,
    },
    /// Work for the flow's device adapter; report its outcome through the
    /// flow.
    DeviceEffect {
        /// What to do.
        effect: DeviceEffect,
    },
    /// Something happened in the domain, such as for analytics.
    DomainEvent {
        /// The domain's event.
        event: DomainEvent,
    },
    /// Something happened in the flow, such as for analytics or the
    /// storefront.
    FlowEvent {
        /// What happened.
        event: FlowEvent,
    },
}
