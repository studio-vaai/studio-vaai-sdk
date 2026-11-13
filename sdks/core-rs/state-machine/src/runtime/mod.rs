//! Atomic composition of the domain and its flow, and the ordered
//! single-consumer queue of their effects.
//!
//! A mutex guards transitions only: a transition runs on a copy of the
//! state and commits whole, and no host code runs under the lock. Claim one
//! [`EffectDriver`], start each batch's effects in order, then acknowledge
//! that they were started (not that their network work finished).

mod delivery;
pub mod experience_events;
pub mod model;

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::domain::{
    Completion, DomainCommand, DomainEngine, DomainEvent, DomainInput, DomainOutput, DomainReceipt,
    DomainSnapshot, ProductCommand, SessionCommand, SessionConfig, TryOnAsset,
};
use crate::error::{Disposition, Rejection, TryOnError};
use crate::experience::{
    DefaultController, DeviceEvent, FlowAction, FlowConfig, FlowUpdate, FlowView, Plan,
    PresenceAction,
};
use crate::ids::{BatchId, DriverId, FlowId, RuntimeRevision, Sequence, TryOnId};
use delivery::Delivery;
use model::*;

/// Steps one transition may take to settle at most.
const MAX_SETTLEMENT_STEPS: usize = 512;

/// The authoritative domain of one shopper's try-on session, driven by one
/// client: its flow, or the host's own experience.
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct TryOnSession {
    /// The runtime, which the session's flow and driver share.
    shared: Arc<Shared>,
}

#[cfg_attr(feature = "uniffi", uniffi::export)]
impl TryOnSession {
    /// A new session; its first effect batch loads the stored session.
    #[cfg_attr(feature = "uniffi", uniffi::constructor)]
    pub fn new(config: SessionConfig) -> Result<Arc<Self>, TryOnError> {
        let seed = config.runtime_id.0;
        let domain =
            DomainEngine::new(config).map_err(|reason| TryOnError::InvalidInput { reason })?;
        let session = Arc::new(Self {
            shared: Arc::new(Shared {
                state: Mutex::new(RuntimeState {
                    domain,
                    flow: None,
                    flow_ids: Sequence::new(seed),
                    revision: RuntimeRevision(0),
                    delivery: Delivery::new(seed),
                }),
            }),
        });
        session.command(SessionCommand::Initialize.into())?;
        Ok(session)
    }

    /// What the domain shows.
    pub fn snapshot(&self) -> Result<DomainSnapshot, TryOnError> {
        Ok(self.shared.lock()?.domain.snapshot())
    }

    pub fn try_on_asset(&self, id: TryOnId) -> Result<Option<TryOnAsset>, TryOnError> {
        Ok(self.shared.lock()?.domain.try_on_asset(id))
    }

    pub fn command(&self, command: DomainCommand) -> Result<DomainReceipt, TryOnError> {
        self.shared
            .transaction(|state, effects| {
                state.domain_input(DomainInput::Command(command), effects)
            })
            .map(|commit| commit.value)
    }

    /// Reports how one of this runtime's domain effects ended.
    pub fn complete(&self, completion: Completion) -> Result<DomainReceipt, TryOnError> {
        self.shared
            .transaction(|state, effects| {
                state.domain_input(DomainInput::Completion(completion), effects)
            })
            .map(|commit| commit.value)
    }

    /// The session's one effect driver; refused while another is alive.
    pub fn claim_effect_driver(&self) -> Result<Arc<EffectDriver>, TryOnError> {
        let id = self.shared.lock()?.delivery.claim()?;
        Ok(Arc::new(EffectDriver {
            shared: self.shared.clone(),
            id,
        }))
    }
}

/// The default try-on experience over a session: its own navigation and
/// selection, the session's domain. A session has one flow at a time.
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct DefaultTryOnFlow {
    /// The session's runtime.
    shared: Arc<Shared>,
    /// Which flow of the session this is; once a newer one replaced it,
    /// this one refuses every call.
    id: FlowId,
}

#[cfg_attr(feature = "uniffi", uniffi::export)]
impl DefaultTryOnFlow {
    /// A new flow over `session`; the session shows its product from then
    /// on. It replaces the session's flow, if it has one: that one is
    /// disposed, and its handle refuses every call from then on.
    #[cfg_attr(feature = "uniffi", uniffi::constructor)]
    pub fn new(session: Arc<TryOnSession>, config: FlowConfig) -> Result<Arc<Self>, TryOnError> {
        Self::create(session, config, None)
    }

    /// Installs the initial product, its stock, and the host's installation token together.
    #[cfg_attr(feature = "uniffi", uniffi::constructor)]
    pub fn with_installation(
        session: Arc<TryOnSession>,
        config: FlowConfig,
        initial: crate::InitialProductInstallation,
    ) -> Result<Arc<Self>, TryOnError> {
        Self::create(session, config, Some(initial))
    }

    pub fn view(&self) -> Result<FlowView, TryOnError> {
        self.shared.lock()?.view(self.id)
    }

    pub fn dispatch(&self, action: FlowAction) -> Result<FlowUpdate, TryOnError> {
        self.commit_action(action, false, None)
    }

    /// Dispatches a shopper action and keeps actionable rejection feedback in the flow.
    pub fn dispatch_shopper(&self, action: FlowAction) -> Result<FlowUpdate, TryOnError> {
        self.commit_action(action, true, None)
    }

    /// Dispatches input only for the currently attached renderer.
    pub fn dispatch_from_renderer(
        &self,
        renderer: crate::InteractionToken,
        action: FlowAction,
        shopper: bool,
    ) -> Result<FlowUpdate, TryOnError> {
        self.commit_action(action, shopper, Some(renderer))
    }

    fn commit_action(
        &self,
        action: FlowAction,
        shopper: bool,
        renderer: Option<crate::InteractionToken>,
    ) -> Result<FlowUpdate, TryOnError> {
        let committed = self.shared.transaction_or(
            |state, effects| {
                if let Some(renderer) = renderer
                    && state.controller(self.id)?.renderer_token() != Some(renderer)
                {
                    return state.view(self.id);
                }
                if shopper {
                    state.controller(self.id)?.clear_rejection();
                }
                state.flow_action(self.id, action, effects)?;
                state.view(self.id)
            },
            |state, error| match error {
                TryOnError::Rejected { reason } if shopper => {
                    state.controller(self.id)?.report_shopper_rejection(reason);
                    state.view(self.id)
                }
                error => Err(error),
            },
        )?;
        Ok(FlowUpdate {
            revision: committed.revision,
            view: committed.value,
        })
    }

    /// Reports how one of this flow's device effects ended.
    pub fn complete_device(&self, event: DeviceEvent) -> Result<FlowUpdate, TryOnError> {
        self.commit_device(event, None)
    }

    /// Accepts a device observation only from the active renderer.
    pub fn complete_device_from_renderer(
        &self,
        renderer: crate::InteractionToken,
        event: DeviceEvent,
    ) -> Result<FlowUpdate, TryOnError> {
        self.commit_device(event, Some(renderer))
    }

    fn commit_device(
        &self,
        event: DeviceEvent,
        renderer: Option<crate::InteractionToken>,
    ) -> Result<FlowUpdate, TryOnError> {
        let committed = self.shared.transaction(|state, effects| {
            if renderer.is_none() || state.controller(self.id)?.renderer_token() == renderer {
                state.device_event(self.id, event, effects)?;
            }
            state.view(self.id)
        })?;
        Ok(FlowUpdate {
            revision: committed.revision,
            view: committed.value,
        })
    }
}

impl DefaultTryOnFlow {
    fn create(
        session: Arc<TryOnSession>,
        config: FlowConfig,
        initial: Option<crate::InitialProductInstallation>,
    ) -> Result<Arc<Self>, TryOnError> {
        let committed = session.shared.transaction(|state, effects| {
            if let Some(old) = &state.flow
                && !old.controller.is_disposed()
            {
                state.flow_action(old.id, PresenceAction::Dispose.into(), effects)?;
            }
            state.flow = None;
            let product_id = config.host_product.product.id;
            state.domain_input(
                DomainInput::Command(
                    ProductCommand::Show {
                        unavailable_variants: initial
                            .as_ref()
                            .map(|initial| initial.unavailable_variants.clone()),
                        product: config.host_product.product.clone(),
                    }
                    .into(),
                ),
                effects,
            )?;
            let id = state.flow_ids.next().map_err(|_| TryOnError::Exhausted)?;
            let mut controller =
                DefaultController::new(id, config, state.domain.try_on_request_capacity())
                    .map_err(|reason| TryOnError::InvalidInput { reason })?;
            if let Some(initial) = initial {
                controller.accept_initial_product(product_id, initial);
            }
            controller.adopt_existing(&state.domain.snapshot());
            state.flow = Some(Flow { id, controller });
            Ok(id)
        })?;
        Ok(Arc::new(Self {
            shared: session.shared.clone(),
            id: committed.value,
        }))
    }
}

impl Drop for DefaultTryOnFlow {
    fn drop(&mut self) {
        // Best-effort logical cleanup. The host still releases OS resources
        // itself if the driver is gone or delivery halted.
        let _ = self.shared.transaction(|state, effects| {
            let Some(flow) = &state.flow else {
                return Ok(());
            };
            if flow.id != self.id {
                return Ok(());
            }
            if !flow.controller.is_disposed() {
                state.flow_action(self.id, PresenceAction::Dispose.into(), effects)?;
            }
            state.flow = None;
            Ok(())
        });
    }
}

/// The session's exclusive effect consumer.
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct EffectDriver {
    /// The session's runtime.
    shared: Arc<Shared>,
    /// The driver's ID; only the driver the runtime names may deliver.
    id: DriverId,
}

#[cfg_attr(feature = "uniffi", uniffi::export)]
impl EffectDriver {
    /// The next batch to start, or `None` when the queue is empty. Refused
    /// until the previous batch is acknowledged.
    pub fn next_batch(&self) -> Result<Option<EffectBatch>, TryOnError> {
        self.shared.lock()?.delivery.next_batch(self.id)
    }

    /// Confirms that every effect of the batch was started. Do not wait for
    /// network work to finish first.
    pub fn acknowledge(&self, batch_id: BatchId) -> Result<(), TryOnError> {
        self.shared.lock()?.delivery.acknowledge(self.id, batch_id)
    }

    /// Stops delivery after a batch failed partway, rather than replaying
    /// effects whose execution is uncertain. Recover by releasing resources
    /// and creating a new runtime.
    pub fn halt(&self, batch_id: BatchId) -> Result<(), TryOnError> {
        self.shared.lock()?.delivery.halt(self.id, batch_id)
    }
}

impl Drop for EffectDriver {
    fn drop(&mut self) {
        if let Ok(mut state) = self.shared.state.lock() {
            state.delivery.release(self.id);
        }
    }
}

/// What a session and its flow and driver share.
struct Shared {
    /// The runtime state; held only while a transition computes, never while
    /// host code runs.
    state: Mutex<RuntimeState>,
}

impl Shared {
    /// Runs `f` on a copy of the state and commits it, with its effects as
    /// one batch, only if `f` succeeds.
    fn transaction<T>(
        &self,
        f: impl FnOnce(&mut RuntimeState, &mut Vec<Effect>) -> Result<T, TryOnError>,
    ) -> Result<Commit<T>, TryOnError> {
        self.transaction_or(f, |_, error| Err(error))
    }

    /// A refused transition can publish feedback from the unchanged state.
    fn transaction_or<T>(
        &self,
        f: impl FnOnce(&mut RuntimeState, &mut Vec<Effect>) -> Result<T, TryOnError>,
        rejected: impl FnOnce(&mut RuntimeState, TryOnError) -> Result<T, TryOnError>,
    ) -> Result<Commit<T>, TryOnError> {
        let mut guard = self.lock()?;
        guard.delivery.require_running()?;
        // Metadata only: no image bytes or device handles live in the state.
        let mut next = guard.clone();
        let mut effects = Vec::new();
        let value = match f(&mut next, &mut effects) {
            Ok(value) => value,
            Err(error) => {
                next = guard.clone();
                effects.clear();
                rejected(&mut next, error)?
            }
        };
        next.revision = next.revision.next().ok_or(TryOnError::Exhausted)?;
        let before = guard.flow_view();
        let after = next.flow_view();
        if !effects.is_empty() || before != after {
            let flow =
                (before.is_some() || after.is_some()).then_some(FlowTransition { before, after });
            next.delivery.enqueue(next.revision, effects, flow)?;
        }
        let revision = next.revision;
        *guard = next;
        Ok(Commit { value, revision })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, RuntimeState>, TryOnError> {
        self.state.lock().map_err(|_| TryOnError::Poisoned)
    }
}

/// A transaction's result.
struct Commit<T> {
    /// What the transaction returned.
    value: T,
    /// The revision it committed.
    revision: RuntimeRevision,
}

/// Everything one session's runtime holds; a transition works on a copy.
#[derive(Clone)]
struct RuntimeState {
    /// The session's domain.
    domain: DomainEngine,
    /// The session's flow, while it has one.
    flow: Option<Flow>,
    /// Mints flow IDs from the runtime ID.
    flow_ids: Sequence<FlowId>,
    /// Counts committed transitions; each batch and flow update carries it.
    revision: RuntimeRevision,
    /// The committed effect batches and their driver.
    delivery: Delivery,
}

impl RuntimeState {
    fn flow_view(&self) -> Option<Box<FlowView>> {
        let flow = self.flow.as_ref()?;
        Some(Box::new(flow.controller.view(&self.domain.snapshot())))
    }

    fn journey_position(&self) -> Option<crate::experience::JourneyPosition> {
        self.flow
            .as_ref()
            .map(|flow| flow.controller.journey_position(&self.domain.snapshot()))
    }

    fn domain_input(
        &mut self,
        input: DomainInput,
        effects: &mut Vec<Effect>,
    ) -> Result<DomainReceipt, TryOnError> {
        let before = self.journey_position();
        let first = effects.len();
        let output = self.domain.dispatch(input);
        if let Disposition::Rejected { reason } = &output.receipt.disposition {
            return Err(rejected(*reason));
        }
        let mut queue = VecDeque::new();
        Self::emit_domain(&output, effects, &mut queue);
        self.settle(queue, effects)?;
        self.observe_journey(before, effects, first)?;
        Ok(output.receipt)
    }

    /// The controller of flow `id`, while it is the session's flow.
    fn controller(&mut self, id: FlowId) -> Result<&mut DefaultController, TryOnError> {
        match &mut self.flow {
            Some(flow) if flow.id == id => Ok(&mut flow.controller),
            _ => Err(TryOnError::FlowReplaced),
        }
    }

    fn flow_action(
        &mut self,
        id: FlowId,
        action: FlowAction,
        effects: &mut Vec<Effect>,
    ) -> Result<(), TryOnError> {
        let before = self.journey_position();
        let snapshot = self.domain.snapshot();
        let plan = self
            .controller(id)?
            .action(action, &snapshot)
            .map_err(rejected)?;
        let first = effects.len();
        self.settle(VecDeque::from([Step::Plan { plan, strict: true }]), effects)?;
        self.observe_journey(before, effects, first)
    }

    fn device_event(
        &mut self,
        id: FlowId,
        event: DeviceEvent,
        effects: &mut Vec<Effect>,
    ) -> Result<(), TryOnError> {
        let before = self.journey_position();
        let snapshot = self.domain.snapshot();
        let plan = self
            .controller(id)?
            .device(event, &snapshot)
            .map_err(rejected)?;
        let first = effects.len();
        // The native picker has already closed: a rejected domain command
        // becomes an issue in the experience, not a rollback into a picker
        // that is no longer open.
        self.settle(
            VecDeque::from([Step::Plan {
                plan,
                strict: false,
            }]),
            effects,
        )?;
        self.observe_journey(before, effects, first)
    }

    fn observe_journey(
        &mut self,
        before: Option<crate::experience::JourneyPosition>,
        effects: &mut Vec<Effect>,
        first: usize,
    ) -> Result<(), TryOnError> {
        if let (Some(flow), Some(before)) = (&mut self.flow, before) {
            flow.controller
                .observe_journey(before, &self.domain.snapshot(), effects, first)
                .map_err(rejected)?;
        }
        Ok(())
    }

    fn view(&mut self, id: FlowId) -> Result<FlowView, TryOnError> {
        let snapshot = self.domain.snapshot();
        Ok(self.controller(id)?.view(&snapshot))
    }

    fn settle(
        &mut self,
        mut queue: VecDeque<Step>,
        effects: &mut Vec<Effect>,
    ) -> Result<(), TryOnError> {
        let mut steps = 0;
        let mut prepare_companions = false;
        let mut checked_companions = false;
        loop {
            let work = if let Some(work) = queue.pop_front() {
                work
            } else if prepare_companions && !checked_companions {
                checked_companions = true;
                let mut plan = Plan::default();
                if let Some(flow) = &mut self.flow {
                    flow.controller
                        .prepare_companions(&self.domain.snapshot(), &mut plan);
                }
                Step::Plan {
                    plan,
                    strict: false,
                }
            } else {
                break;
            };
            steps += 1;
            if steps > MAX_SETTLEMENT_STEPS {
                return Err(rejected(Rejection::SettlementBudgetExceeded));
            }
            match work {
                Step::Fact(event) => {
                    let snapshot = self.domain.snapshot();
                    if let Some(flow) = &mut self.flow {
                        let plan = flow
                            .controller
                            .domain_event(&event, &snapshot)
                            .map_err(rejected)?;
                        queue.push_back(Step::Plan {
                            plan,
                            strict: false,
                        });
                    }
                    effects.push(Effect::DomainEvent { event });
                }
                Step::Plan { plan, strict } => {
                    prepare_companions |= plan.prepare_companions;
                    effects.extend(
                        plan.effects
                            .into_iter()
                            .map(|effect| Effect::DeviceEffect { effect }),
                    );
                    effects.extend(
                        plan.events
                            .into_iter()
                            .map(|event| Effect::FlowEvent { event }),
                    );
                    for planned in plan.commands {
                        let output = self.domain.dispatch(DomainInput::Command(planned.command));
                        if let Disposition::Rejected { reason } = &output.receipt.disposition {
                            if matches!(
                                planned.purpose,
                                crate::experience::Purpose::PrepareCompanion
                            ) {
                                continue;
                            }
                            if strict {
                                return Err(rejected(*reason));
                            }
                            if let Some(flow) = &mut self.flow {
                                flow.controller.report(*reason);
                            }
                            continue;
                        }
                        let snapshot = self.domain.snapshot();
                        let mut next = match &mut self.flow {
                            Some(flow) => flow
                                .controller
                                .receipt(planned.purpose, &output.receipt, &snapshot)
                                .map_err(rejected)?,
                            None => Plan::default(),
                        };
                        // The receipt is correlated before the command's
                        // facts settle, cache hits included.
                        effects.extend(
                            next.events
                                .drain(..)
                                .map(|event| Effect::FlowEvent { event }),
                        );
                        Self::emit_domain(&output, effects, &mut queue);
                        queue.push_back(Step::Plan {
                            plan: next,
                            strict: false,
                        });
                    }
                }
            }
        }
        Ok(())
    }

    fn emit_domain(output: &DomainOutput, effects: &mut Vec<Effect>, queue: &mut VecDeque<Step>) {
        effects.extend(
            output
                .effects
                .iter()
                .cloned()
                .map(|effect| Effect::DomainEffect { effect }),
        );
        queue.extend(output.events.iter().cloned().map(Step::Fact));
    }
}

/// The session's flow: its controller, under the ID its handle holds.
#[derive(Clone)]
struct Flow {
    /// Which flow it is; a newer one replaces it.
    id: FlowId,
    /// The flow's state.
    controller: DefaultController,
}

/// One step left to settle within a transition.
enum Step {
    /// The flow's plan to carry out.
    Plan {
        /// Its commands, device effects and events.
        plan: Plan,
        /// Whether a rejected command refuses the whole transition; only
        /// for the plan of the action the caller dispatched.
        strict: bool,
    },
    /// A domain fact the flow sees.
    Fact(DomainEvent),
}

fn rejected(reason: Rejection) -> TryOnError {
    TryOnError::Rejected { reason }
}
