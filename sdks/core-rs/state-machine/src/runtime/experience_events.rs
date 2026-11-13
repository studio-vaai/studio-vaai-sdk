//! Public shopper events with the context of the commit that emitted them.

use crate::{
    BackendError, BodyEvent, CartRequest, DetachedStage, DeviceRecoveryEvent, DomainEvent, Effect,
    FlowEvent, FlowView, ForeignIds, JourneyEvent, JourneyStep, PhotoEvent, PresentationEvent,
    ProductId, RefusalReason, SelectionEvent, SessionEvent, TryOnEvent, TryOnId,
    TryOnRequestFailure, TryOnRequestId, TryOnRequestOrigin, UncertainWork, VariantId,
};

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ExperienceEvent {
    pub product_id: ProductId,
    pub step: JourneyStep,
    pub fact: ExperienceFact,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ExperienceFact {
    Journey {
        event: JourneyEvent,
    },
    ConsentGranted,
    SessionFailed {
        error: BackendError,
    },
    Photo {
        event: PhotoEvent,
    },
    Height {
        event: BodyEvent,
    },
    OperationUncertain {
        work: UncertainWork,
    },
    DeviceRecovery {
        event: DeviceRecoveryEvent,
    },
    TryOnRequested {
        request_id: TryOnRequestId,
        variant_id: VariantId,
        origin: TryOnRequestOrigin,
        foreign_ids: ForeignIds,
    },
    TryOnResolved {
        request_id: TryOnRequestId,
        variant_id: VariantId,
        try_on_id: TryOnId,
    },
    TryOnRendered {
        variant_id: VariantId,
        try_on_id: TryOnId,
    },
    TryOnRefused {
        request_id: TryOnRequestId,
        variant_id: VariantId,
        reason: RefusalReason,
    },
    TryOnFailed {
        request_id: TryOnRequestId,
        variant_id: VariantId,
        failure: TryOnRequestFailure,
    },
    /// The shopper let go of a try-on before it was shown. One detached
    /// while rendering can still report `TryOnResolved` later.
    TryOnDetached {
        request_id: TryOnRequestId,
        variant_id: VariantId,
        stage: DetachedStage,
    },
    AddToCartRequested {
        request: CartRequest,
    },
}

pub(super) fn committed(
    before: &FlowView,
    after: &FlowView,
    effects: &[Effect],
) -> Vec<ExperienceEvent> {
    let before_product = before.domain.product.as_ref().map(|product| product.id);
    let Some(current_product) = after
        .domain
        .product
        .as_ref()
        .map(|product| product.id)
        .or(before_product)
    else {
        return Vec::new();
    };
    effects
        .iter()
        .filter_map(|effect| {
            let mut product_id = current_product;
            let mut step = after.journey.step;
            let fact = match effect {
                Effect::DomainEvent {
                    event:
                        DomainEvent::Session {
                            event: SessionEvent::ConsentGranted,
                        },
                } => ExperienceFact::ConsentGranted,
                Effect::DomainEvent {
                    event:
                        DomainEvent::Session {
                            event: SessionEvent::Failed { error },
                        },
                } => ExperienceFact::SessionFailed { error: *error },
                Effect::DomainEvent {
                    event: DomainEvent::Photo { event },
                } => ExperienceFact::Photo {
                    event: event.clone(),
                },
                Effect::DomainEvent {
                    event: DomainEvent::Body { event },
                } => ExperienceFact::Height {
                    event: event.clone(),
                },
                Effect::DomainEvent {
                    event:
                        DomainEvent::OperationUncertain {
                            work,
                            product_id: affected,
                            ..
                        },
                } if matches!(
                    work,
                    UncertainWork::Photo | UncertainWork::Height | UncertainWork::RequestedTryOn
                ) =>
                {
                    product_id = affected.unwrap_or(product_id);
                    ExperienceFact::OperationUncertain { work: *work }
                }
                Effect::DomainEvent {
                    event: DomainEvent::TryOn { event },
                } => {
                    let (product, fact) = try_on_event(event)?;
                    product_id = product;
                    fact
                }
                Effect::FlowEvent {
                    event: FlowEvent::Journey { event },
                } => {
                    if let JourneyEvent::Closed { step: closed, .. } = event {
                        step = (*closed)?;
                        product_id = before_product.unwrap_or(product_id);
                    }
                    ExperienceFact::Journey {
                        event: event.clone(),
                    }
                }
                Effect::FlowEvent {
                    event: FlowEvent::DeviceRecovery { event },
                } if *event != DeviceRecoveryEvent::PickerCancelled => {
                    ExperienceFact::DeviceRecovery { event: *event }
                }
                Effect::FlowEvent {
                    event:
                        FlowEvent::Selection {
                            event: SelectionEvent::AddToCartRequested { request },
                        },
                } => {
                    product_id = request.product_id;
                    ExperienceFact::AddToCartRequested {
                        request: request.clone(),
                    }
                }
                Effect::FlowEvent {
                    event:
                        FlowEvent::Presentation {
                            event:
                                PresentationEvent::TryOnRequested {
                                    product_id: product,
                                    variant_id,
                                    try_on_request_id,
                                    origin,
                                    foreign_ids,
                                },
                        },
                } => {
                    product_id = *product;
                    step = before
                        .journey
                        .last_visible_step
                        .unwrap_or(before.journey.step);
                    ExperienceFact::TryOnRequested {
                        request_id: *try_on_request_id,
                        variant_id: *variant_id,
                        origin: *origin,
                        foreign_ids: foreign_ids.clone(),
                    }
                }
                _ => return None,
            };
            Some(ExperienceEvent {
                product_id,
                step,
                fact,
            })
        })
        .collect()
}

fn try_on_event(event: &TryOnEvent) -> Option<(ProductId, ExperienceFact)> {
    match event {
        TryOnEvent::Created {
            product_id, try_on, ..
        } => Some((
            *product_id,
            ExperienceFact::TryOnRendered {
                variant_id: try_on.key.variant_id,
                try_on_id: try_on.id,
            },
        )),
        TryOnEvent::RequestResolved {
            try_on_request_id,
            context,
            try_on_id,
        } if context.origin.is_some() => Some((
            context.product_id,
            ExperienceFact::TryOnResolved {
                request_id: *try_on_request_id,
                variant_id: context.variant_id,
                try_on_id: *try_on_id,
            },
        )),
        TryOnEvent::RequestRefused {
            try_on_request_id,
            context,
            reason,
        } if context.origin.is_some() => Some((
            context.product_id,
            ExperienceFact::TryOnRefused {
                request_id: *try_on_request_id,
                variant_id: context.variant_id,
                reason: *reason,
            },
        )),
        TryOnEvent::RequestFailed {
            try_on_request_id,
            context,
            failure,
        } if context.origin.is_some() => {
            let request_id = *try_on_request_id;
            let variant_id = context.variant_id;
            let fact = match *failure {
                TryOnRequestFailure::SizeRestricted { reason } => ExperienceFact::TryOnRefused {
                    request_id,
                    variant_id,
                    reason,
                },
                failure => ExperienceFact::TryOnFailed {
                    request_id,
                    variant_id,
                    failure,
                },
            };
            Some((context.product_id, fact))
        }
        TryOnEvent::RequestDetached {
            try_on_request_id,
            context,
            stage,
        } if context.origin.is_some() => Some((
            context.product_id,
            ExperienceFact::TryOnDetached {
                request_id: *try_on_request_id,
                variant_id: context.variant_id,
                stage: *stage,
            },
        )),
        _ => None,
    }
}

/// Close projection when the host failed before the flow could commit a close.
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn experience_close_after_host_failure(before: FlowView) -> Option<ExperienceEvent> {
    let step = before.journey.last_visible_step?;
    Some(ExperienceEvent {
        product_id: before.domain.product?.id,
        step,
        fact: ExperienceFact::Journey {
            event: JourneyEvent::Closed {
                step: Some(step),
                presented: before.journey.last_presented,
            },
        },
    })
}
