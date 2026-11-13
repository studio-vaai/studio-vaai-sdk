//! The ordered single-consumer queue of effect batches, and the one driver
//! that delivers them.

use std::collections::VecDeque;
use std::sync::Arc;

use super::model::{Effect, EffectBatch, FlowTransition};
use crate::error::TryOnError;
use crate::ids::{BatchId, DriverId, RuntimeRevision, Sequence};

/// Effect batches awaiting delivery at most.
const MAX_BATCHES: usize = 1024;

/// The committed batches and their delivery.
#[derive(Clone)]
pub(super) struct Delivery {
    /// The committed batches awaiting delivery, at most 1024.
    outbox: VecDeque<Arc<EffectBatch>>,
    /// Who delivers them, and whether delivery stopped.
    state: DeliveryState,
    /// Mints batch IDs from the runtime ID.
    batch_ids: Sequence<BatchId>,
    /// Mints driver IDs from the runtime ID.
    driver_ids: Sequence<DriverId>,
}

impl Delivery {
    pub fn new(seed: uuid::Uuid) -> Self {
        Self {
            outbox: VecDeque::new(),
            state: DeliveryState::Idle,
            batch_ids: Sequence::new(seed),
            driver_ids: Sequence::new(seed),
        }
    }

    /// Refused once delivery stopped.
    pub fn require_running(&self) -> Result<(), TryOnError> {
        if matches!(self.state, DeliveryState::Halted) {
            Err(TryOnError::DeliveryHalted)
        } else {
            Ok(())
        }
    }

    /// Queues one transition's effects as a batch.
    pub fn enqueue(
        &mut self,
        revision: RuntimeRevision,
        effects: Vec<Effect>,
        flow: Option<FlowTransition>,
    ) -> Result<(), TryOnError> {
        if self.outbox.len() >= MAX_BATCHES {
            return Err(TryOnError::QueueFull);
        }
        let id = self.batch_ids.next().map_err(|_| TryOnError::Exhausted)?;
        let experience_events = flow
            .as_ref()
            .and_then(|flow| {
                Some(super::experience_events::committed(
                    flow.before.as_deref()?,
                    flow.after.as_deref()?,
                    &effects,
                ))
            })
            .unwrap_or_default();
        self.outbox.push_back(Arc::new(EffectBatch {
            id,
            revision,
            effects,
            experience_events,
            flow,
        }));
        Ok(())
    }

    /// Makes a new driver the one that delivers; refused while another is
    /// alive.
    pub fn claim(&mut self) -> Result<DriverId, TryOnError> {
        match self.state {
            DeliveryState::Halted => Err(TryOnError::DeliveryHalted),
            DeliveryState::Driven { .. } => Err(TryOnError::DriverAlreadyClaimed),
            DeliveryState::Idle => {
                let driver = self.driver_ids.next().map_err(|_| TryOnError::Exhausted)?;
                self.state = DeliveryState::Driven {
                    driver,
                    in_flight: None,
                };
                Ok(driver)
            }
        }
    }

    /// The batch `driver` has in flight; refused unless it is the driver.
    fn in_flight(&mut self, driver: DriverId) -> Result<&mut Option<Arc<EffectBatch>>, TryOnError> {
        match &mut self.state {
            DeliveryState::Driven {
                driver: current,
                in_flight,
            } if *current == driver => Ok(in_flight),
            DeliveryState::Halted => Err(TryOnError::DeliveryHalted),
            _ => Err(TryOnError::InvalidDriver),
        }
    }

    /// The batch in flight, if it is `batch_id`.
    fn require_batch(
        in_flight: &Option<Arc<EffectBatch>>,
        batch_id: BatchId,
    ) -> Result<(), TryOnError> {
        if in_flight.as_ref().map(|b| b.id) == Some(batch_id) {
            Ok(())
        } else {
            Err(TryOnError::WrongBatch)
        }
    }

    /// Hands `driver` the next batch, or `None` when the queue is empty;
    /// refused until the previous batch is acknowledged.
    pub fn next_batch(&mut self, driver: DriverId) -> Result<Option<EffectBatch>, TryOnError> {
        if self.in_flight(driver)?.is_some() {
            return Err(TryOnError::BatchNotAcknowledged);
        }
        let next = self.outbox.pop_front();
        *self.in_flight(driver)? = next.clone();
        Ok(next.as_deref().cloned())
    }

    /// Every effect of the batch in flight was started.
    pub fn acknowledge(&mut self, driver: DriverId, batch_id: BatchId) -> Result<(), TryOnError> {
        let in_flight = self.in_flight(driver)?;
        Self::require_batch(in_flight, batch_id)?;
        *in_flight = None;
        Ok(())
    }

    /// The batch in flight failed partway: delivery stops for good.
    pub fn halt(&mut self, driver: DriverId, batch_id: BatchId) -> Result<(), TryOnError> {
        Self::require_batch(self.in_flight(driver)?, batch_id)?;
        self.state = DeliveryState::Halted;
        Ok(())
    }

    /// `driver` is gone; a batch it left in flight stops delivery.
    pub fn release(&mut self, driver: DriverId) {
        if let DeliveryState::Driven {
            driver: current,
            in_flight,
        } = &self.state
            && *current == driver
        {
            self.state = if in_flight.is_some() {
                DeliveryState::Halted
            } else {
                DeliveryState::Idle
            };
        }
    }
}

/// Who delivers the batches, and whether delivery stopped.
#[derive(Clone)]
enum DeliveryState {
    /// No driver is alive; batches wait.
    Idle,
    /// A driver delivers.
    Driven {
        /// The driver.
        driver: DriverId,
        /// The batch handed to it and not yet acknowledged.
        in_flight: Option<Arc<EffectBatch>>,
    },
    /// A batch was abandoned partway; nothing commits or delivers again.
    Halted,
}
