//! How the runtime refuses a call, and how the pure domain classifies an input.

use std::fmt;

use crate::domain::{Inadmissible, RefusalReason};

/// Why a runtime call was refused. A refused call commits nothing: neither
/// the domain nor any experience changes.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
pub enum TryOnError {
    /// Malformed configuration.
    InvalidInput {
        /// What is wrong with it.
        reason: Rejection,
    },
    /// The transition is not allowed in the current state.
    Rejected {
        /// Why not.
        reason: Rejection,
    },
    /// A thread panicked while holding the runtime lock.
    Poisoned,
    /// An identifier or revision counter ran out.
    Exhausted,
    /// The session already has an effect driver.
    DriverAlreadyClaimed,
    /// This driver no longer owns the session's effect delivery.
    InvalidDriver,
    /// The previous batch has not been acknowledged.
    BatchNotAcknowledged,
    /// The batch ID is not the one in flight.
    WrongBatch,
    /// A partially delivered batch was abandoned; recreate the runtime.
    DeliveryHalted,
    /// Too many batches await delivery; drain them and retry the same call.
    QueueFull,
    /// A newer flow replaced this one over its session; this one refuses
    /// every call.
    FlowReplaced,
}

impl fmt::Display for TryOnError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput { reason } | Self::Rejected { reason } => write!(f, "{reason}"),
            other => write!(f, "{other:?}"),
        }
    }
}

impl std::error::Error for TryOnError {}

/// What an input did to the pure domain.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Disposition {
    /// The input changed state or produced output.
    Applied,
    /// A stale, duplicate or already-satisfied input: nothing changed.
    Ignored,
    /// The input is not allowed now; nothing changed.
    Rejected {
        /// Why not.
        reason: Rejection,
    },
}

/// Why the state machine refused an input. A refused input changes nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Rejection {
    // Configuration.
    /// The session configuration is out of range: a nil runtime ID, or
    /// kept try-on requests outside 1..=1024.
    InvalidConfig,
    /// An identifier, revision or clock value ran out.
    Exhausted,
    /// One transition took more steps than it may.
    SettlementBudgetExceeded,

    // Product.
    /// A product has no variants, or more than 4096.
    InvalidVariantCount,
    /// An axis key or foreign ID is empty.
    EmptyAxisKey,
    /// The product's variants do not all sit on the same axes.
    InconsistentAxes,
    /// Two variants share an ID or foreign IDs.
    DuplicateVariant,
    /// No product is shown.
    NoProductShown,

    // Session.
    /// The session was disposed for good.
    SessionDisposed,
    /// Restoring the stored session has not settled yet.
    SessionRestoring,
    /// Restoring the stored session failed; retry it, or reset.
    SessionRestoreFailed,
    /// The session has no failure to retry.
    NothingToRetry,
    /// The session is not established.
    SessionNotReady,

    // Photo and body.
    /// No photo was committed yet.
    NoPhoto,
    /// A photo is being processed; cancel or settle it first.
    PhotoProcessing,
    /// The backend returned the current body's identity for a new photo.
    BodyIdentityReused,

    // Height.
    /// The height is not finite and positive.
    InvalidHeight,
    /// The body's height is not acknowledged.
    HeightNotAcknowledged,
    /// A SetHeight is pending or uncertain; writes do not overlap.
    HeightWritePending,
    /// A SetHeight completion names no pending write.
    SetHeightMismatch,

    // Size recommendation.
    /// A recommended size names no variant.
    EmptyRecommendedSize,
    /// A recommended size names a variant the product shown does not have.
    RecommendedSizeNotShown,
    /// A variant is in two recommended sizes.
    VariantInTwoSizes,
    /// A size's fit match is not from 0 to 1.
    InvalidFitMatch,

    // Try-ons.
    /// The try-on request cannot be admitted.
    Inadmissible {
        /// Why.
        reason: Inadmissible,
    },
    /// The session keeps as many try-on requests as it allows, and none
    /// of them has settled.
    RequestLimit,
    /// The backend returned one try-on ID for different inputs.
    TryOnIdentityReused,

    // Operations.
    /// The outcome does not fit the operation it names.
    OutcomeMismatch,
    /// As many operations are outstanding as allowed.
    OperationLimit,

    // The default experience, by part.
    // Presence.
    /// The flow was disposed.
    FlowDisposed,
    /// The experience is not shown, or the app is in the background.
    NotVisible,

    // Navigation.
    /// A modal is open; dismiss it first.
    ModalOpen,

    // Consent and the session.
    /// The shopper has not consented.
    ConsentRequired,
    /// The consent form is unavailable.
    ConsentFormInactive,

    // Photo.
    /// No photo change is under way.
    NoPhotoChange,
    /// There is no new photo to retry.
    NoNewPhoto,
    /// The staged photo needs to be replaced before another attempt.
    PhotoRetryUnavailable,
    /// The photo cannot be replaced on this screen.
    PhotoReplacementUnavailable,

    // Camera.
    /// The camera cannot be used now.
    CameraUnavailable,
    /// The camera is not live.
    CameraNotLive,
    /// The camera has not failed: there is nothing to retry.
    NoCameraFailure,

    // Height input.
    /// No height was entered.
    HeightMissing,
    /// The height input is not shown.
    HeightInputInactive,

    // Selection.
    /// The host shows an axis of the product twice, or not at all.
    AxesNotShownOnce,
    /// The host shows an item of an axis twice.
    ItemsNotShownOnce,
    /// Only the product's own axes can be chosen.
    AxisNotOfProduct,
    /// The variant is not one of the product's.
    UnknownVariant,
    /// No variant has the chosen item.
    NoVariantForItem,
    /// The variant cannot be selected now.
    SelectionUnavailable,

    // Size recommendation.
    /// The size recommendation is not shown on this screen.
    SizeRecommendationUnavailable,
    /// There is no size recommendation to dismiss.
    NoSizeRecommendation,

    // Presentation.
    /// The try-on screen is not active.
    TryOnUnavailable,
    /// This exact variant and body revision need different inputs before retrying.
    TryOnInputsUnavailable { error: crate::domain::BackendError },
    /// The requested cart variant is unavailable or does not match the displayed result.
    CartVariantUnavailable,
    /// The backend refused to try the variant on this body revision.
    TryOnRefused {
        /// Why.
        reason: RefusalReason,
    },
    /// The try-on is not kept any more.
    TryOnNotAvailable,
    /// The try-on is of another product.
    TryOnOfAnotherProduct,
}

impl fmt::Display for Rejection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Inadmissible { reason } => write!(f, "{reason}"),
            Self::TryOnRefused { reason } => write!(f, "The try-on is refused: {reason:?}"),
            other => write!(f, "{other:?}"),
        }
    }
}

impl From<Inadmissible> for Rejection {
    fn from(reason: Inadmissible) -> Self {
        Self::Inadmissible { reason }
    }
}
