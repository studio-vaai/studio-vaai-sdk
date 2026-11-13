//! The try-on state machine, in two layers over one runtime.
//!
//! - [`domain`]: the headless domain engine. It decides what is admissible
//!   and to whom work and try-ons belong, whoever asks.
//! - [`experience`]: the default try-on experience. It decides the
//!   sequence and the presentation, proposing domain commands.
//! - [`runtime`]: their atomic composition. [`TryOnSession`] owns the
//!   domain, every [`DefaultTryOnFlow`] over it an experience, and one
//!   [`EffectDriver`] receives what both need the host to do, in order.
//!
//! No reducer performs I/O, reads a clock or draws randomness: the host
//! starts the effects and reports their outcomes as completions. See the
//! README for the adapter contract.
//!
//! With the `uniffi` feature, the crate exports itself through UniFFI: its
//! values, its three objects and its error, as they are.

// UniFFI's generated scaffolding is the only unsafe code.
#![cfg_attr(not(feature = "uniffi"), forbid(unsafe_code))]

pub mod domain;
mod error;
pub mod experience;
mod ids;
pub mod runtime;
mod values;

pub use domain::{
    BackendError, BodyCommand, BodyEvent, BodyIdentity, BodyJob, BodyOutcome, BodyState,
    BodyTarget, Completion, DataProcessingConsent, DetachedStage, DomainCommand, DomainEffect,
    DomainEvent, DomainInput, DomainOutput, DomainReceipt, DomainSnapshot, Fit, FitAxis,
    FitAxisScore, FitScore, ForeignIds, HeightStatus, Inadmissible, Job, MediaEffect, Outcome,
    PermanentTryOnFailure, Photo, PhotoCommand, PhotoEvent, PhotoJob, PhotoOutcome, PhotoRejection,
    PhotoSource, Product, ProductCommand, RefusalReason, RefusedTryOn, RestoredBody, ResultFit,
    ResultFitAnchor, SessionCommand, SessionConfig, SessionEffect, SessionEvent, SessionJob,
    SessionOutcome, SessionPhase, SizeRecommendation, SizeRecommendationCommand,
    SizeRecommendationEvent, SizeRecommendationJob, SizeRecommendationKey,
    SizeRecommendationOutcome, SizeRecommendationScore, TryOn, TryOnAsset, TryOnCommand,
    TryOnEvent, TryOnJob, TryOnKey, TryOnOutcome, TryOnRequestContext, TryOnRequestFailure,
    TryOnRequestSnapshot, TryOnRequestStatus, UncertainWork, Variant,
};
pub use error::{Disposition, Rejection, TryOnError};
pub use experience::{
    AutoStartPolicy, AxisControl, AxisDisplayOptions, AxisItem, AxisPlacement, AxisRole,
    BodyProgress, CameraAction, CameraDevices, CameraEffect, CameraEvent, CameraPreview,
    CameraState, Capability, CartEvent, CartRequest, DeviceEffect, DeviceError, DeviceEvent,
    DeviceRecoveryEvent, DisplayedImage, FlowAction, FlowConfig, FlowEvent, FlowUpdate, FlowView,
    ForegroundTryOn, ForegroundTryOnState, HeightAction, HostProduct, ImagePhase, ImageTarget,
    ImageView, InitialProductInstallation, Issue, ItemDisplay, ItemGlyph, JourneyEntry,
    JourneyEvent, JourneyStep, JourneyView, Modal, NavigationAction, NewPhoto, NewPhotoStatus,
    PhotoAction, PhotoChange, PhotoChangeOrigin, PhotoUploadPhase, PhotoUploadView, PickerEffect,
    PickerEvent, Presence, PresenceAction, PresentationAction, PresentationEvent, PresentationMode,
    PresentationView, PresentedAxis, PresentedAxisItem, PresentedResult, PrimaryTryOnAction,
    ProductInstallation, ProductInstallationStatus, RenderMediaAction, RenderMediaEffect,
    RenderMediaEvent, RenderMediaOutcome, RenderMediaView, ResultActionView, ScreenView,
    SelectionAction, SelectionEvent, SelectionView, SessionAction, SizeRecommendationAction,
    TryOnFailureKind, TryOnFeedback, TryOnProgress, TryOnRequestOrigin, TryOnWarning, VariantAxis,
    VariantLabelFormat, VariantRow, VariantRowItem, render_media_timeout_ms,
};
pub use ids::*;
pub use runtime::model::*;
pub use runtime::{DefaultTryOnFlow, EffectDriver, TryOnSession};
pub use values::*;

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
