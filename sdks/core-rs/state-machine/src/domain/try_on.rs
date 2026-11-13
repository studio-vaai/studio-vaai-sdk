//! Requests track render work. Result history and fit refusals are stored
//! separately so retiring a request cannot erase its result or restriction.

use std::collections::{BTreeMap, VecDeque};

use super::body::{BodyState, BodyTarget, HeightStatus};
use super::engine::DomainEngine;
use super::model::{BackendError, DomainEffect, DomainEvent, DomainOutput, DomainSnapshot, Job};
use super::operation::OperationStatus;
use super::product::ForeignIds;
use super::session::SessionPhase;
use super::{FitAxisScore, FitScore, SizeRecommendationScore};
use crate::error::Rejection;
use crate::ids::*;
use crate::values::*;

/// A try-on the backend created. Its inputs are fixed, and its image URL can be renewed.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TryOn {
    /// The backend's try-on identifier; one try-on never serves two keys.
    pub id: TryOnId,
    /// What it shows: the body revision and the variant.
    pub key: TryOnKey,
    /// The body's height at that revision, to label a try-on of an earlier
    /// height with.
    pub height: HeightCm,
    /// Where the image is.
    pub image_url: ImageUrl,
    /// The fit assessment associated with this exact result.
    #[cfg_attr(feature = "uniffi", uniffi(default))]
    pub fit: Option<ResultFit>,
    #[cfg_attr(feature = "uniffi", uniffi(default))]
    pub fit_anchors: Option<Vec<ResultFitAnchor>>,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ResultFitAnchor {
    pub dimension: String,
    pub side: Option<String>,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ResultFit {
    Pending,
    Failed,
    Unavailable,
    Ready {
        score: FitScore,
        axes: Vec<FitAxisScore>,
    },
}

impl ResultFit {
    pub(super) fn from_scores(scores: &[SizeRecommendationScore], variant: VariantId) -> Self {
        scores
            .iter()
            .find(|score| score.variant_ids.contains(&variant))
            .map_or(Self::Unavailable, |score| Self::Ready {
                score: score.aggregate,
                axes: score.axes.clone(),
            })
    }
}

#[derive(Clone, Debug, PartialEq)]
struct StoredTryOn {
    product: ProductId,
    operation: OperationId,
    result: TryOn,
    backend_revision: Option<String>,
}

/// Identity and current URL of an accepted result, captured before a renewal.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TryOnAsset {
    pub try_on_id: TryOnId,
    pub operation: OperationId,
    pub key: TryOnKey,
    pub image_url: ImageUrl,
    pub backend_revision: Option<String>,
}

impl StoredTryOn {
    fn asset(&self) -> TryOnAsset {
        TryOnAsset {
            try_on_id: self.result.id,
            operation: self.operation,
            key: self.result.key.clone(),
            image_url: self.result.image_url.clone(),
            backend_revision: self.backend_revision.clone(),
        }
    }
}

/// Everything a try-on depends on: equal keys produce the same image.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TryOnKey {
    /// The body's acknowledged height revision it shows; revisions are
    /// never reused, so it also names the body.
    pub body_revision: BodyRevision,
    /// The variant it shows.
    pub variant_id: VariantId,
}

/// An input failure that survives eviction from the request history.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PermanentTryOnFailure {
    pub key: TryOnKey,
    pub error: BackendError,
}

/// A try-on the backend refused; its key stays refused, so no request for
/// it reaches the backend again.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RefusedTryOn {
    /// What the backend refused: the body revision and the variant.
    pub key: TryOnKey,
    /// Why.
    pub reason: RefusalReason,
    /// Suggested replacement size in the shop's identifiers, when the backend supplied one.
    pub alternative: Option<ForeignIds>,
}

/// Why the backend refuses to try a variant on a body, as the API's
/// `TryOnGarmentTooSmall` and `TryOnGarmentTooLarge` say.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum RefusalReason {
    /// The garment is too small for the body.
    GarmentTooSmall,
    /// The garment is too large for the body.
    GarmentTooLarge,
}

/// What initiated a foreground try-on request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum TryOnRequestOrigin {
    /// The shopper requested this variant.
    Shopper,
    /// The auto-start policy requested the initial try-on.
    Automatic,
}

/// Immutable attribution for request events, even after a product change.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TryOnRequestContext {
    pub product_id: ProductId,
    pub variant_id: VariantId,
    pub origin: Option<TryOnRequestOrigin>,
}

/// One logical try-on request.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TryOnRequestSnapshot {
    /// The request's identifier.
    pub id: TryOnRequestId,
    /// The variant to try on.
    pub variant_id: VariantId,
    pub product_id: ProductId,
    pub origin: Option<TryOnRequestOrigin>,
    /// The acknowledged body revision, or the height write it is waiting for.
    pub target: BodyTarget,
    /// Where the request stands, and its try-on or failure once settled.
    pub status: TryOnRequestStatus,
}

impl TryOnRequestSnapshot {
    fn context(&self) -> TryOnRequestContext {
        TryOnRequestContext {
            product_id: self.product_id,
            variant_id: self.variant_id,
            origin: self.origin,
        }
    }
}

/// Where a try-on request stands.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum TryOnRequestStatus {
    /// Not started: waiting for a SetHeight, or for the try-on being
    /// created.
    Waiting,
    /// A try-on being created serves it.
    Running {
        /// The operation creating it, possibly shared with other requests.
        operation: OperationId,
    },
    /// A try-on fulfils it.
    Resolved {
        /// The try-on that fulfils it: created for it, shared, or reused
        /// from an earlier request.
        try_on_id: TryOnId,
    },
    /// The backend refused to try the variant on the body, for it or for
    /// an earlier request: a handled outcome, not an error.
    Refused {
        /// The refused try-on: its key and why.
        try_on: RefusedTryOn,
    },
    /// It cannot be served.
    Failed {
        /// Why.
        failure: TryOnRequestFailure,
    },
    /// Its client let go of it before a try-on fulfilled it: before it
    /// started, or while its render's outcome was unknown.
    Cancelled,
}

/// How far a request had got when its client let go of it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum DetachedStage {
    /// It had not started; it is cancelled.
    Waiting,
    /// Its render was running; the render goes on and the request still
    /// settles with its try-on.
    Rendering,
    /// Its render's outcome was unknown; the render is dropped unless
    /// another request still wants it, and the request is cancelled.
    Uncertain,
}

impl TryOnRequestStatus {
    /// Whether it still awaits a try-on.
    pub fn is_open(&self) -> bool {
        matches!(self, Self::Waiting | Self::Running { .. })
    }
}

/// Why a try-on request failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum TryOnRequestFailure {
    /// Creating the try-on failed.
    Backend {
        /// What the backend reported.
        error: BackendError,
    },
    /// The SetHeight it waited for failed.
    SetHeightFailed {
        /// What the backend reported for the SetHeight.
        error: BackendError,
    },
    /// A fit gate refused the selected variant before rendering started.
    SizeRestricted {
        /// The fit gate that refused this variant.
        reason: RefusalReason,
    },
    /// It could no longer be admitted when its turn came.
    Inadmissible {
        /// Why.
        reason: Inadmissible,
    },
}

/// Why a try-on request cannot be admitted, or served once it waited.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Inadmissible {
    /// The session is not established.
    SessionNotReady,
    /// No body exists yet.
    NoBody,
    /// The body revision it reads is not current, or its SetHeight is
    /// uncertain.
    BodyRevisionUnavailable,
    /// The variant is not one of the product shown.
    VariantNotShown,
    /// The recommendation says the backend would refuse this variant.
    SizeRestricted,
    /// The storefront reports the variant as unavailable.
    VariantUnavailable,
    /// The current recommendation ruled out all sizes.
    NoSuitableSize,
}

impl std::fmt::Display for Inadmissible {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::SessionNotReady => "Session is not ready",
            Self::NoBody => "Photo is required",
            Self::BodyRevisionUnavailable => {
                "Requested body revision is unavailable, pending, or uncertain"
            }
            Self::VariantNotShown => "The variant is not one of the product shown",
            Self::VariantUnavailable => "The variant is unavailable",
            Self::NoSuitableSize => "No size is suitable",
            Self::SizeRestricted => "The variant cannot be tried on for this body",
        })
    }
}

/// What a client asks of try-ons.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum TryOnCommand {
    /// Asks for a try-on of a variant; equal requests share one try-on or
    /// one already made.
    Request {
        /// The variant to try on: one of the product shown.
        variant_id: VariantId,
        /// The body revision to read: acknowledged, or after a pending
        /// SetHeight.
        target: BodyTarget,
        /// Foreground intent, if this came from the default experience.
        #[cfg_attr(feature = "uniffi", uniffi(default))]
        origin: Option<TryOnRequestOrigin>,
    },
    /// Lets go of a request. One that has not started is cancelled; one
    /// whose render runs still settles with its try-on; one whose render's
    /// outcome is unknown is cancelled, and the render dropped unless
    /// another request wants it. A settled request is left as it is.
    DetachRequest {
        /// The request to let go of.
        try_on_request_id: TryOnRequestId,
    },
    /// Updates storefront availability for new and waiting requests.
    SetUnavailableVariants { variant_ids: Vec<VariantId> },
    /// Replaces the URL only if the accepted asset still matches the captured one.
    ReplaceImage {
        expected: TryOnAsset,
        image_url: ImageUrl,
    },
}

/// What the host does for a try-on.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum TryOnJob {
    /// Create a try-on of exactly the key, nothing else, on the body;
    /// report `Created`, `Refused` or a failure.
    Create {
        /// The body to try the variant on.
        body_id: BodyId,
        /// The product the request was for.
        product_id: ProductId,
        /// The catalogue whose recommendation can score this result.
        catalogue_revision: CatalogueRevision,
        /// The acknowledged backend revision to read.
        backend_revision: Option<String>,
        /// Exactly what to try on.
        key: TryOnKey,
    },
}

/// How a try-on job ended.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum TryOnOutcome {
    /// The try-on was created.
    Created {
        /// The try-on's identifier; it must not come back for other inputs.
        try_on_id: TryOnId,
        /// Where the image is.
        image_url: ImageUrl,
    },
    CreatedWithAnchors {
        try_on_id: TryOnId,
        image_url: ImageUrl,
        fit_anchors: Vec<ResultFitAnchor>,
    },
    /// The backend refused to try the variant on the body.
    Refused {
        /// Why.
        reason: RefusalReason,
    },
    /// The backend refused the variant and suggested another size.
    RefusedWithAlternative {
        reason: RefusalReason,
        alternative: ForeignIds,
    },
}

/// What happened to a try-on or a request for one.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum TryOnEvent {
    /// A try-on being created now serves a request.
    RequestStarted {
        /// The request.
        try_on_request_id: TryOnRequestId,
        /// The operation creating it, possibly shared.
        operation: OperationId,
    },
    /// A try-on request was fulfilled.
    RequestResolved {
        /// The request.
        try_on_request_id: TryOnRequestId,
        context: TryOnRequestContext,
        /// The try-on that fulfils it: created for it, shared, or reused.
        try_on_id: TryOnId,
    },
    /// A try-on request was refused: the backend refused its key.
    RequestRefused {
        /// The request.
        try_on_request_id: TryOnRequestId,
        context: TryOnRequestContext,
        /// Why.
        reason: RefusalReason,
    },
    /// A try-on request cannot be served.
    RequestFailed {
        /// The request.
        try_on_request_id: TryOnRequestId,
        context: TryOnRequestContext,
        /// Why.
        failure: TryOnRequestFailure,
    },
    /// Its client let go of a request before a try-on fulfilled it. One
    /// detached while rendering still reports how it settles.
    RequestDetached {
        /// The request.
        try_on_request_id: TryOnRequestId,
        context: TryOnRequestContext,
        /// How far it had got.
        stage: DetachedStage,
    },
    /// A new try-on, once per try-on the backend creates: not for reuse.
    Created {
        operation: OperationId,
        product_id: ProductId,
        /// The try-on, with the inputs it was created from.
        try_on: TryOn,
    },
    /// A completed result left the retained history.
    Evicted { try_on_id: TryOnId },
    /// A try-on the backend refused, once per refusal it reports: not for
    /// requests refused by an earlier refusal.
    Refused {
        /// The refused try-on.
        try_on: RefusedTryOn,
    },
}

/// The try-on requests, by ID and so oldest first, with what they came to.
/// Settled request receipts and completed results have independent retention.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct TryOnRequests {
    /// The requests, by ID.
    entries: BTreeMap<TryOnRequestId, TryOnRequest>,
    results: VecDeque<StoredTryOn>,
    permanent_failures: BTreeMap<TryOnKey, BackendError>,
    refusals: BTreeMap<TryOnKey, RefusedTryOn>,
    /// How many are kept.
    capacity: usize,
}

impl TryOnRequests {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: BTreeMap::new(),
            results: VecDeque::new(),
            permanent_failures: BTreeMap::new(),
            refusals: BTreeMap::new(),
            capacity,
        }
    }

    pub fn views(&self) -> Vec<TryOnRequestSnapshot> {
        self.entries.values().map(|r| r.view.clone()).collect()
    }

    pub fn results(&self) -> Vec<TryOn> {
        self.results
            .iter()
            .map(|stored| stored.result.clone())
            .collect()
    }

    fn created(&self, key: &TryOnKey) -> Option<&TryOn> {
        self.results
            .iter()
            .map(|stored| &stored.result)
            .find(|result| &result.key == key)
    }

    fn remember(&mut self, stored: StoredTryOn) -> Option<TryOnId> {
        let evicted = if self.results.len() == self.capacity {
            self.results.pop_front().map(|old| old.result.id)
        } else {
            None
        };
        self.results.push_back(stored);
        evicted
    }

    pub(super) fn asset(&self, id: TryOnId) -> Option<TryOnAsset> {
        self.results
            .iter()
            .find(|stored| stored.result.id == id)
            .map(StoredTryOn::asset)
    }

    fn replace_image(&mut self, expected: TryOnAsset, image_url: ImageUrl) {
        if !image_url.0.trim().is_empty()
            && let Some(stored) = self.results.iter_mut().find(|stored| {
                stored.result.id == expected.try_on_id
                    && stored.operation == expected.operation
                    && stored.result.image_url == expected.image_url
            })
        {
            stored.result.image_url = image_url;
        }
    }

    pub(super) fn update_fit(
        &mut self,
        product: ProductId,
        revision: BodyRevision,
        update: impl Fn(VariantId) -> ResultFit,
    ) {
        for stored in &mut self.results {
            let result = &mut stored.result;
            if stored.product == product
                && result.key.body_revision == revision
                && !matches!(
                    result.fit,
                    Some(ResultFit::Ready { .. } | ResultFit::Unavailable)
                )
            {
                result.fit = Some(update(result.key.variant_id));
            }
        }
    }

    /// A refusal remains effective even after its request leaves history.
    pub fn refused(&self, key: &TryOnKey) -> Option<&RefusedTryOn> {
        self.refusals.get(key)
    }

    pub fn refusals(&self) -> Vec<RefusedTryOn> {
        self.refusals.values().cloned().collect()
    }

    fn result(&self, id: TryOnId) -> Option<&TryOn> {
        self.results
            .iter()
            .map(|stored| &stored.result)
            .find(|result| result.id == id)
    }

    /// Keep open requests and retire the oldest settled receipt when full.
    pub fn make_room(&mut self) -> Result<(), Rejection> {
        if self.entries.len() < self.capacity {
            return Ok(());
        }
        let victim = self
            .entries
            .values()
            .find(|request| !request.view.status.is_open())
            .ok_or(Rejection::RequestLimit)?
            .view
            .id;
        self.entries.remove(&victim);
        Ok(())
    }

    pub fn insert(&mut self, request: TryOnRequest) {
        self.entries.insert(request.view.id, request);
    }

    /// The open request `id`, unless its client already let go of it.
    pub fn held(&self, id: TryOnRequestId) -> Option<&TryOnRequest> {
        self.entries
            .get(&id)
            .filter(|request| request.view.status.is_open() && !request.detached)
    }

    /// Records that the client let go of request `id` at `stage`: one
    /// rendering stays open and settles with its try-on; any other is
    /// cancelled.
    pub fn detach(
        &mut self,
        id: TryOnRequestId,
        stage: DetachedStage,
        events: &mut Vec<DomainEvent>,
    ) {
        let Some(request) = self.entries.get_mut(&id) else {
            return;
        };
        if stage == DetachedStage::Rendering {
            request.detached = true;
        } else {
            request.view.status = TryOnRequestStatus::Cancelled;
        }
        events.push(
            TryOnEvent::RequestDetached {
                try_on_request_id: id,
                context: request.view.context(),
                stage,
            }
            .into(),
        );
    }

    /// The open requests not yet started, oldest first.
    pub fn waiting(&self) -> Vec<TryOnRequest> {
        self.entries
            .values()
            .filter(|r| r.view.status == TryOnRequestStatus::Waiting)
            .cloned()
            .collect()
    }

    /// The requests waiting for SetHeight `operation` now read `revision`.
    pub fn retarget(&mut self, operation: OperationId, revision: BodyRevision) {
        let pending = BodyTarget::Pending { operation };
        for request in self.entries.values_mut() {
            if request.view.target == pending {
                request.view.target = BodyTarget::Acknowledged { revision };
            }
        }
    }

    /// Fails the requests waiting for SetHeight `operation`, which failed.
    pub fn fail_waiting_on(
        &mut self,
        operation: OperationId,
        error: BackendError,
        events: &mut Vec<DomainEvent>,
    ) {
        let pending = BodyTarget::Pending { operation };
        let waiting: Vec<_> = self
            .entries
            .values()
            .filter(|r| r.view.target == pending)
            .map(|r| r.view.id)
            .collect();
        for id in waiting {
            self.fail(id, TryOnRequestFailure::SetHeightFailed { error }, events);
        }
    }

    /// The operation creating a try-on now serves the request, which reads
    /// the body at `height`.
    pub fn start(
        &mut self,
        id: TryOnRequestId,
        operation: OperationId,
        height: HeightCm,
        events: &mut Vec<DomainEvent>,
    ) {
        if let Some(request) = self.entries.get_mut(&id) {
            request.view.status = TryOnRequestStatus::Running { operation };
            request.height = Some(height);
        }
        events.push(
            TryOnEvent::RequestStarted {
                try_on_request_id: id,
                operation,
            }
            .into(),
        );
    }

    /// A try-on fulfils the request.
    pub fn resolve(
        &mut self,
        id: TryOnRequestId,
        try_on_id: TryOnId,
        events: &mut Vec<DomainEvent>,
    ) {
        if let Some(request) = self.entries.get_mut(&id) {
            request.view.status = TryOnRequestStatus::Resolved { try_on_id };
            events.push(
                TryOnEvent::RequestResolved {
                    try_on_request_id: id,
                    context: request.view.context(),
                    try_on_id,
                }
                .into(),
            );
        }
    }

    /// Settles an open request as refused: a handled outcome.
    pub fn refuse(
        &mut self,
        id: TryOnRequestId,
        try_on: RefusedTryOn,
        events: &mut Vec<DomainEvent>,
    ) {
        if let Some(request) = self.entries.get_mut(&id)
            && request.view.status.is_open()
        {
            let reason = try_on.reason;
            request.view.status = TryOnRequestStatus::Refused { try_on };
            events.push(
                TryOnEvent::RequestRefused {
                    try_on_request_id: id,
                    context: request.view.context(),
                    reason,
                }
                .into(),
            );
        }
    }

    /// Settles an open request as failed.
    pub fn fail(
        &mut self,
        id: TryOnRequestId,
        failure: TryOnRequestFailure,
        events: &mut Vec<DomainEvent>,
    ) {
        if let Some(request) = self.entries.get_mut(&id)
            && request.view.status.is_open()
        {
            request.view.status = TryOnRequestStatus::Failed { failure };
            events.push(
                TryOnEvent::RequestFailed {
                    try_on_request_id: id,
                    context: request.view.context(),
                    failure,
                }
                .into(),
            );
        }
    }

    /// The body's height the requests `operation` serves read, captured
    /// when they started: a SetHeight queued meanwhile hides it.
    pub fn inputs_read_by(&self, operation: OperationId) -> Option<(HeightCm, ProductId)> {
        let running = TryOnRequestStatus::Running { operation };
        self.entries
            .values()
            .find(|r| r.view.status == running)
            .and_then(|r| Some((r.height?, r.view.product_id)))
    }

    /// Whether a request its client still holds is served by `operation`.
    /// A render nobody holds is not worth waiting for.
    pub fn wanted(&self, operation: OperationId) -> bool {
        let running = TryOnRequestStatus::Running { operation };
        self.entries
            .values()
            .any(|request| request.view.status == running && !request.detached)
    }

    /// Whether a foreground request is served by `operation`.
    pub fn has_foreground_request(&self, operation: OperationId) -> bool {
        let running = TryOnRequestStatus::Running { operation };
        self.entries
            .values()
            .any(|request| request.view.status == running && request.view.origin.is_some())
    }

    /// Cancels the requests `operation` serves, without events: its render
    /// was dropped, and none of them is wanted any more.
    pub fn cancel_consumers(&mut self, operation: OperationId) {
        for id in self.consumers(operation) {
            if let Some(request) = self.entries.get_mut(&id) {
                request.view.status = TryOnRequestStatus::Cancelled;
            }
        }
    }

    fn consumers(&self, operation: OperationId) -> Vec<TryOnRequestId> {
        let running = TryOnRequestStatus::Running { operation };
        self.entries
            .values()
            .filter(|r| r.view.status == running)
            .map(|r| r.view.id)
            .collect()
    }

    /// Resolves the requests `operation` serves with the try-on it created.
    pub fn resolve_consumers(
        &mut self,
        operation: OperationId,
        try_on_id: TryOnId,
        events: &mut Vec<DomainEvent>,
    ) {
        for id in self.consumers(operation) {
            self.resolve(id, try_on_id, events);
        }
    }

    /// Refuses the requests `operation` serves: the backend refused its
    /// key.
    pub fn refuse_consumers(
        &mut self,
        operation: OperationId,
        try_on: &RefusedTryOn,
        events: &mut Vec<DomainEvent>,
    ) {
        for id in self.consumers(operation) {
            self.refuse(id, try_on.clone(), events);
        }
    }

    /// Fails the requests `operation` serves: creating the try-on failed.
    pub fn fail_consumers(
        &mut self,
        operation: OperationId,
        error: BackendError,
        events: &mut Vec<DomainEvent>,
    ) {
        for id in self.consumers(operation) {
            self.fail(id, TryOnRequestFailure::Backend { error }, events);
        }
    }

    /// Drops every request, as a new photo or session does.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.results.clear();
        self.clear_terminal_outcomes();
    }

    pub fn clear_terminal_outcomes(&mut self) {
        self.permanent_failures.clear();
        self.refusals.clear();
    }

    pub fn permanent_failures(&self) -> Vec<PermanentTryOnFailure> {
        self.permanent_failures
            .iter()
            .map(|(key, error)| PermanentTryOnFailure {
                key: key.clone(),
                error: *error,
            })
            .collect()
    }
}

/// One try-on request, with the body revision it reads.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct TryOnRequest {
    /// What a snapshot shows of the request.
    pub view: TryOnRequestSnapshot,
    /// The body's height at that revision, once the request started; the
    /// try-on it creates records it.
    pub height: Option<HeightCm>,
    /// Its client let go of it while it was rendering; it still settles.
    pub detached: bool,
}

impl DomainSnapshot {
    pub fn try_on_request(&self, id: TryOnRequestId) -> Option<&TryOnRequestSnapshot> {
        self.try_on_requests.iter().find(|r| r.id == id)
    }

    /// Completed try-ons in creation order.
    pub fn try_ons(&self) -> Vec<&TryOn> {
        self.try_ons.iter().collect()
    }

    pub fn try_on(&self, id: TryOnId) -> Option<&TryOn> {
        self.try_ons.iter().find(|result| result.id == id)
    }

    /// Why the backend refused `key` for the current body revision.
    pub fn refusal(&self, key: &TryOnKey) -> Option<RefusalReason> {
        self.try_on_refusals
            .iter()
            .find(|try_on| &try_on.key == key)
            .map(|try_on| try_on.reason)
            .or_else(|| self.restriction(key))
    }

    /// A settled variant error that needs different inputs.
    pub(crate) fn permanent_try_on_failure(
        &self,
        variant_id: VariantId,
        target: &BodyTarget,
    ) -> Option<BackendError> {
        let BodyTarget::Acknowledged { revision } = target else {
            return None;
        };
        self.permanent_try_on_failures
            .iter()
            .find(|failure| {
                failure.key.variant_id == variant_id && failure.key.body_revision == *revision
            })
            .map(|failure| failure.error)
    }

    fn restriction(&self, key: &TryOnKey) -> Option<RefusalReason> {
        self.size_recommendation
            .as_ref()
            .filter(|recommendation| recommendation.key.body_revision == key.body_revision)
            .and_then(|recommendation| {
                recommendation
                    .restrictions
                    .iter()
                    .find(|entry| entry.variant_id == key.variant_id)
            })
            .map(|entry| entry.reason)
    }
}

/// The admission the domain and the experience's view projection share.
pub(crate) fn validate_request(
    snapshot: &DomainSnapshot,
    variant_id: VariantId,
    target: &BodyTarget,
) -> Result<(), Inadmissible> {
    if snapshot.session != SessionPhase::Ready {
        return Err(Inadmissible::SessionNotReady);
    }
    if snapshot.unavailable_variants.contains(&variant_id) {
        return Err(Inadmissible::VariantUnavailable);
    }
    if snapshot.body == BodyState::NoBody {
        return Err(Inadmissible::NoBody);
    }
    // A missing body has no height, so no target is available on it.
    let height = snapshot.body.height();
    let target_available = match target {
        BodyTarget::Acknowledged { revision } => {
            height.and_then(HeightStatus::acknowledged) == Some(*revision)
        }
        BodyTarget::Pending { operation } => {
            matches!(height, Some(HeightStatus::Pending { operation: pending, .. }) if pending == operation)
        }
    };
    if !target_available {
        return Err(Inadmissible::BodyRevisionUnavailable);
    }
    if snapshot
        .size_recommendation
        .as_ref()
        .is_some_and(|recommendation| recommendation.no_suitable_size)
    {
        return Err(Inadmissible::NoSuitableSize);
    }
    snapshot
        .product
        .as_ref()
        .and_then(|p| p.variant(variant_id))
        .ok_or(Inadmissible::VariantNotShown)?;
    Ok(())
}

/// The try-on `job` creates, if it creates one.
fn creating(job: &Job) -> Option<&TryOnKey> {
    match job {
        Job::TryOn {
            job: TryOnJob::Create { key, .. },
        } => Some(key),
        _ => None,
    }
}

impl DomainEngine {
    pub(crate) fn try_on_asset(&self, id: TryOnId) -> Option<TryOnAsset> {
        self.requests.asset(id)
    }

    pub(crate) fn try_on_request_capacity(&self) -> usize {
        self.requests.capacity
    }

    pub(super) fn try_on_command(
        &mut self,
        command: TryOnCommand,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        match command {
            TryOnCommand::Request {
                variant_id,
                target,
                origin,
            } => {
                validate_request(&self.snapshot(), variant_id, &target)?;
                let product_id = self.product.as_ref().ok_or(Rejection::NoProductShown)?.id;
                self.requests.make_room()?;
                let id = self.request_ids.next()?;
                self.requests.insert(TryOnRequest {
                    view: TryOnRequestSnapshot {
                        id,
                        variant_id,
                        product_id,
                        origin,
                        target,
                        status: TryOnRequestStatus::Waiting,
                    },
                    height: None,
                    detached: false,
                });
                output.receipt.try_on_request_id = Some(id);
            }
            TryOnCommand::DetachRequest { try_on_request_id } => {
                self.detach_request(try_on_request_id, output)
            }
            TryOnCommand::SetUnavailableVariants { variant_ids } => {
                self.unavailable_variants = variant_ids.into_iter().collect();
                for request in self.requests.waiting() {
                    if self.unavailable_variants.contains(&request.view.variant_id) {
                        self.requests.fail(
                            request.view.id,
                            TryOnRequestFailure::Inadmissible {
                                reason: Inadmissible::VariantUnavailable,
                            },
                            &mut output.events,
                        );
                    }
                }
            }
            TryOnCommand::ReplaceImage {
                expected,
                image_url,
            } => {
                self.requests.replace_image(expected, image_url);
            }
        }
        Ok(())
    }

    /// The client lets go of request `id`: what happens depends on how far
    /// it got, which only the domain knows.
    fn detach_request(&mut self, id: TryOnRequestId, output: &mut DomainOutput) {
        let Some(request) = self.requests.held(id) else {
            return;
        };
        let stage = match request.view.status {
            TryOnRequestStatus::Running { operation }
                if self
                    .operations
                    .get(operation)
                    .is_some_and(|work| work.status == OperationStatus::Uncertain) =>
            {
                self.requests
                    .detach(id, DetachedStage::Uncertain, &mut output.events);
                if !self.requests.wanted(operation) {
                    self.drop_render(operation, output);
                }
                return;
            }
            TryOnRequestStatus::Running { .. } => DetachedStage::Rendering,
            _ => DetachedStage::Waiting,
        };
        self.requests.detach(id, stage, &mut output.events);
    }

    /// Removes a render whose outcome is unknown and that no request wants:
    /// the host stops it, its requests are cancelled, and a late
    /// completion finds nothing.
    pub(super) fn drop_render(&mut self, operation: OperationId, output: &mut DomainOutput) {
        self.operations.remove(operation);
        output.effects.push(DomainEffect::Cancel { operation });
        self.requests.cancel_consumers(operation);
    }

    pub(super) fn fit_for_render(&self, key: &TryOnKey) -> Option<ResultFit> {
        self.size_recommendation
            .as_ref()
            .filter(|rec| rec.key.body_revision == key.body_revision)
            .map(|rec| ResultFit::from_scores(&rec.scores, key.variant_id))
    }

    pub(super) fn try_on_ended(
        &mut self,
        operation: OperationId,
        job: TryOnJob,
        outcome: TryOnOutcome,
        captured_fit: Option<ResultFit>,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        let TryOnJob::Create {
            key,
            catalogue_revision,
            backend_revision,
            ..
        } = job;
        let (outcome, fit_anchors) = match outcome {
            TryOnOutcome::CreatedWithAnchors {
                try_on_id,
                image_url,
                fit_anchors,
            } => (
                TryOnOutcome::Created {
                    try_on_id,
                    image_url,
                },
                Some(fit_anchors),
            ),
            outcome => (outcome, None),
        };
        match outcome {
            TryOnOutcome::Created {
                try_on_id,
                image_url,
            } => {
                // A render without an image is a failed render, not a
                // rejected completion: rejecting would leave it running.
                if image_url.is_empty() {
                    self.try_on_failed(operation, key, BackendError::Unavailable, output);
                    return Ok(());
                }
                // A key a kept request holds is reused, never created again:
                // the same try-on for another key is the backend's error.
                if let Some(existing) = self.requests.result(try_on_id) {
                    if existing.key != key {
                        return Err(Rejection::TryOnIdentityReused);
                    }
                    self.requests
                        .resolve_consumers(operation, try_on_id, &mut output.events);
                    return Ok(());
                }
                let (height, product_id) = self
                    .requests
                    .inputs_read_by(operation)
                    .ok_or(Rejection::HeightNotAcknowledged)?;
                let fit = if catalogue_revision == self.catalogue_revision {
                    self.fit_for_render(&key).unwrap_or_else(|| {
                        if self
                            .operations
                            .iter()
                            .any(|op| matches!(op.job, Job::SizeRecommendation { .. }))
                        {
                            ResultFit::Pending
                        } else {
                            ResultFit::Failed
                        }
                    })
                } else {
                    captured_fit.unwrap_or(ResultFit::Failed)
                };
                let try_on = TryOn {
                    id: try_on_id,
                    key,
                    height,
                    image_url,
                    fit: Some(fit),
                    fit_anchors,
                };
                output.events.push(
                    TryOnEvent::Created {
                        operation,
                        product_id,
                        try_on: try_on.clone(),
                    }
                    .into(),
                );
                if let Some(try_on_id) = self.requests.remember(StoredTryOn {
                    product: product_id,
                    operation,
                    result: try_on,
                    backend_revision,
                }) {
                    output.events.push(TryOnEvent::Evicted { try_on_id }.into());
                }
                self.requests
                    .resolve_consumers(operation, try_on_id, &mut output.events);
            }
            refusal => {
                let (reason, alternative) = match refusal {
                    TryOnOutcome::Refused { reason } => (reason, None),
                    TryOnOutcome::RefusedWithAlternative {
                        reason,
                        alternative,
                    } => (reason, Some(alternative)),
                    TryOnOutcome::Created { .. } | TryOnOutcome::CreatedWithAnchors { .. } => {
                        unreachable!()
                    }
                };
                let try_on = RefusedTryOn {
                    key,
                    reason,
                    alternative,
                };
                if self.body.state.acknowledged() == Some(try_on.key.body_revision) {
                    self.requests
                        .refusals
                        .insert(try_on.key.clone(), try_on.clone());
                }
                output.events.push(
                    TryOnEvent::Refused {
                        try_on: try_on.clone(),
                    }
                    .into(),
                );
                self.requests
                    .refuse_consumers(operation, &try_on, &mut output.events);
            }
        }
        Ok(())
    }

    pub(super) fn try_on_failed(
        &mut self,
        operation: OperationId,
        key: TryOnKey,
        error: BackendError,
        output: &mut DomainOutput,
    ) {
        if matches!(
            error,
            BackendError::InvalidRequest | BackendError::NotFound | BackendError::Unusable
        ) {
            self.requests.permanent_failures.insert(key, error);
        }
        self.requests
            .fail_consumers(operation, error, &mut output.events);
    }

    /// Serves the waiting requests, oldest first.
    pub(super) fn drive_requests(&mut self, output: &mut DomainOutput) -> Result<(), Rejection> {
        for request in self.requests.waiting() {
            self.drive_request(request, output)?;
        }
        Ok(())
    }

    /// Serves one waiting request: refused if its key is, otherwise from a
    /// try-on a kept request came to, by sharing one being created, or by
    /// creating one when none is being created.
    fn drive_request(
        &mut self,
        request: TryOnRequest,
        output: &mut DomainOutput,
    ) -> Result<(), Rejection> {
        let id = request.view.id;
        let events = &mut output.events;
        let snapshot = self.snapshot();
        if snapshot.product.as_ref().map(|product| product.id) != Some(request.view.product_id) {
            self.requests.fail(
                id,
                TryOnRequestFailure::Inadmissible {
                    reason: Inadmissible::VariantNotShown,
                },
                events,
            );
            return Ok(());
        }
        if let Err(reason) =
            validate_request(&snapshot, request.view.variant_id, &request.view.target)
        {
            self.requests
                .fail(id, TryOnRequestFailure::Inadmissible { reason }, events);
            return Ok(());
        }
        let BodyTarget::Acknowledged { revision } = request.view.target else {
            return Ok(());
        };
        // Admitted: the target revision is the acknowledged one.
        let Some(&HeightStatus::Acknowledged { height, .. }) = self.body.height_status() else {
            return Ok(());
        };
        let key = TryOnKey {
            body_revision: revision,
            variant_id: request.view.variant_id,
        };
        if let Some(refused) = self.requests.refused(&key).cloned() {
            self.requests.refuse(id, refused, events);
            return Ok(());
        }
        if let Some(try_on_id) = self.requests.created(&key).map(|result| result.id) {
            self.requests.resolve(id, try_on_id, events);
            return Ok(());
        }
        if let Some(error) =
            snapshot.permanent_try_on_failure(request.view.variant_id, &request.view.target)
        {
            self.requests
                .fail(id, TryOnRequestFailure::Backend { error }, events);
            return Ok(());
        }
        if let Some(reason) = snapshot.restriction(&key) {
            self.requests
                .fail(id, TryOnRequestFailure::SizeRestricted { reason }, events);
            return Ok(());
        }
        let shared = self
            .operations
            .iter()
            .find(|o| creating(&o.job) == Some(&key))
            .map(|o| o.id);
        let operation = if let Some(operation) = shared {
            operation
        } else {
            // One try-on is created at a time.
            if self.operations.iter().any(|o| creating(&o.job).is_some()) {
                return Ok(());
            }
            let job = TryOnJob::Create {
                body_id: self.body.ready()?.body_id,
                product_id: request.view.product_id,
                catalogue_revision: self.catalogue_revision,
                backend_revision: self.body.ready()?.backend_revision.clone(),
                key,
            };
            self.start(job, false, output)?
        };
        self.requests
            .start(id, operation, height, &mut output.events);
        Ok(())
    }
}
