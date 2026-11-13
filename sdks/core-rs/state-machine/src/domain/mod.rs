//! The headless domain: the product shown, the backend session, which
//! implies the shopper's consent, the committed photo and the body and its
//! height, the product's size recommendation, and the try-on requests with
//! the try-ons the backend created or refused for them. It has no routes,
//! current screen, carousel cursor, camera, consent form or auto-start
//! policy, and does not know whether any UI is mounted.
//!
//! Its modules are its concerns, as the public API names them, in the
//! journey's order: [`product`], [`session`], [`photo`], [`body`],
//! [`size_recommendation`] and [`try_on`].
//! Each holds the concern's values, the state the domain keeps of it, its
//! commands, the jobs it hands the host with their outcomes, its events, and
//! what each of those does to the domain. [`model`] wraps them into the sums
//! that cross the domain's boundary. The engine (`engine`) applies inputs
//! atomically and hands each to its concern; `operation` tracks the work
//! out with the host, whatever its concern.

pub mod body;
mod engine;
pub mod model;
mod operation;
pub mod photo;
pub mod product;
pub mod session;
pub mod size_recommendation;
pub mod try_on;

pub use body::{
    BodyCommand, BodyEvent, BodyIdentity, BodyJob, BodyOutcome, BodyState, BodyTarget, HeightStatus,
};
pub use engine::DomainEngine;
pub use model::*;
pub use photo::{
    MediaEffect, Photo, PhotoCommand, PhotoEvent, PhotoJob, PhotoOutcome, PhotoRejection,
    PhotoSource,
};
pub use product::{ForeignIds, Product, ProductCommand, Variant};
pub use session::{
    DataProcessingConsent, RestoredBody, SessionCommand, SessionConfig, SessionEffect,
    SessionEvent, SessionJob, SessionOutcome, SessionPhase,
};
pub use size_recommendation::{
    Fit, FitAxis, FitAxisScore, FitScore, SizeRecommendation, SizeRecommendationCommand,
    SizeRecommendationEvent, SizeRecommendationJob, SizeRecommendationKey,
    SizeRecommendationOutcome, SizeRecommendationScore, SizeRestriction,
};
pub use try_on::{
    DetachedStage, Inadmissible, PermanentTryOnFailure, RefusalReason, RefusedTryOn, ResultFit,
    ResultFitAnchor, TryOn, TryOnAsset, TryOnCommand, TryOnEvent, TryOnJob, TryOnKey, TryOnOutcome,
    TryOnRequestContext, TryOnRequestFailure, TryOnRequestOrigin, TryOnRequestSnapshot,
    TryOnRequestStatus,
};

pub(crate) use body::validate_height;
pub(crate) use try_on::validate_request;
