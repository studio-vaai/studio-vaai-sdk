# state-machine

The try-on state machine, in two layers over one runtime:

```text
platform UI                        headless integration
     |                                    |
DefaultTryOnFlow (experience)             |
     | domain commands                    |
     +-----------------+------------------+
                       |
                 TryOnSession (domain)
                       |
              ordered effect batches
                       |
                one EffectDriver
                       |
   HTTP, storage, camera, picker, timers (the host)
                       |
              correlated completions
```

- **The domain** (`TryOnSession`) owns the product shown (only that one), the backend session, the committed photo and body with its acknowledged height revisions, the product's size recommendation, and render work, completed result history, and fit refusals. It runs one render at a time. It has no screens, carousel cursor, camera, consent or auto-start policy: only the shopper's consent creates a session (`SessionCommand::Create` carries `DataProcessingConsent::Granted`, as the API's `dataProcessingConsent: true`), so having one implies it.
- **The default experience** (`DefaultTryOnFlow`) owns the shopper's consent on its introduction, which it attests when it creates the session, screens and modals, photo changes, the editable height, the selected variant and which of its items were chosen, the rows the product's axes are shown as, the displayed try-on and the request it follows, the self-timer, how the size recommendation is presented, and auto-start. A session has one client: its flow, or an experience of the host's that drives the domain directly instead. A new flow replaces the session's flow, which is disposed and whose handle then refuses every call (`TryOnError::FlowReplaced`), and shows its own product.
- **The host** owns real media, streams, storage, networking and timers.

No reducer performs I/O, reads a clock or draws randomness. Every transition runs on a copy of the state and commits whole, with its effects as one batch; a refused call commits nothing, in the domain or any experience.

## Layout

Both layers are split by concern, and each concern's module holds everything of it: its values, the state kept of it, its part of the protocol, and what each input does.

- **The domain's concerns** are named after what the domain keeps, in the public API's terms and the journey's order: `product` (the one product shown), `session`, `photo`, `body`, `size_recommendation` and `try_on`. The snapshot has one field for each, in that order. Each has its commands (`ProductCommand`, `SessionCommand`, …), the jobs it hands the host (`SessionJob`, `PhotoJob`, …) with their outcomes (`SessionOutcome`, `PhotoOutcome`, …), and its events (`SessionEvent`, `PhotoEvent`, …). `model` wraps them into the sums that cross the boundary, so a host matches `DomainCommand::Photo { command: PhotoCommand::Process { … } }`. Only what every concern shares is defined there: completions, the outcomes any operation can have (`Failed`, `SessionExpired`, `Unknown`), cancellation, snapshots and receipts. A `Photo` (its `MediaId` and `PhotoSource`) is apart from the body created from it. The photo side processes one photo at a time, commits it and releases photos; the body side holds the estimated height and the height revisions. The engine hands each input to its concern and applies it atomically, and `operation` tracks the work out with the host, whatever its concern.
- **The experience's concerns** are the parts of a flow's state: `presence`, `navigation`, `session`, `photo`, `camera`, `height`, `selection`, `size_recommendation` and `presentation`. The flow's state has one field per part, in that order, but what only one screen keeps lives in that screen and goes when the shopper leaves it: the camera in the camera screen, the height draft in the height screen, which starts from the failed input or the body's height and is preserved through a cancelled photo change, and the rejected photo in the rejected-photo screen, which releases it. What the domain keeps, the flow reads there instead of keeping a copy: the pending SetHeight is the body's, and the selection and a dismissal name the size recommendation they concern, so a new one replaces them. A `FlowView` holds the domain's snapshot, the presence, the screen the flow shows with exactly that screen's data (`ScreenView`: the try-on screen's `selection` and `presentation`, the camera screen's `camera`, the height screen's `draft`, the rejected photo and why, the introduction's `consent_given`), any modal over it, the photo change, whose new photo any screen may show being processed, and the issue. One admission decides whether a try-on can start: `presentation.can_request_try_on` (`Capability::Available`, or `Unavailable` with the reason), `RequestTryOn` and auto-start all use it. Each of the shopper's actions needs a visible flow, and one of a screen's controls needs that screen. A `FlowView` carries the domain's snapshot once (`FlowView.domain`, from the same revision) and names its try-ons and requests by ID, so nothing the domain holds is copied into it. Each has its actions (`PresenceAction`, `PhotoAction`, …). Where a part drives a device, it also has that device's effects and events (`PickerEffect`, `CameraEvent`, …), and where a part tells the host something, its events (`JourneyEvent`, `SelectionEvent`, `PresentationEvent`). Each part also reacts to the domain's events of its concern. `FlowAction`, `DeviceEffect`, `DeviceEvent` and `FlowEvent` are their sums.
- **The runtime** is split the same way, with the minting of identifiers and the delivery of effects kept apart.

In Rust, every concern's enum converts into its sum: `SessionCommand::Reset.into()`.

Every module reads in the same order:

1. its values, the main one first and the types it is made of after it;
2. its protocol: commands or actions, then jobs, outcomes, effects and events (for a flow: device effects, device events, then flow events);
3. the state kept of it;
4. its additions to shared types, and its functions;
5. last, what each input does to the engine or the flow: commands, then outcomes and failures, then what drives queued work.

The sums in `model` and the runtime follow the same rule: the public objects and envelopes first, then what they are made of, and each impl's methods in the order a call reaches them.

## Types

Every value with a meaning of its own has its own type, and names follow the API's: a `TryOn` is a try-on the backend created (`TryOnId`), a `TryOnRequest…` a request for one, a `RefusedTryOn` one the backend refused, and `SizeRecommendation…` how well each size fits. Identifiers are UUIDs (`ProductId`, `TryOnId`, `TryOnRequestId`, `MediaId`, `InteractionToken`, …), counters are unsigned integers (`BodyRevision`, `RuntimeRevision`), and text and quantities are strings and numbers (`ImageUrl`, `HexColor`, `AxisKey`, `ForeignId`, `HeightCm`, `FitMatch`, `MonotonicMillis`). Free-form text for people, such as an image's alt text, stays a plain string. A refused input says why with a `Rejection`, one variant per reason, never a message.

With its `uniffi` feature, the crate exports itself through UniFFI in its own namespace: its values, its three objects and its error, as they are. Each of the types above is its string or number in the bindings, under its own name.

## Variants

A product is what the backend lists: its variants, each a `VariantId` placed on every axis by the shop's own identifiers (`ForeignIds`, such as `{ colorway: "IX7055-259", size: "XS" }`). The backend lists only the variants it can try on and supplies no names, labels, images or stock. The host shows each axis as a `VariantAxis`: its items in its own order, each keyed by the same foreign ID and displayed as text, as a color (`#rrggbb`) or as an image, the last two with their alt text. Try-ons and requests name a variant, and a size recommendation scores sizes by the variants in them, so no axis has to be called `size`.

The flow turns the host's axes into rows (`ScreenView::TryOn`'s `selection.rows`): each item says whether it is selected, whether a variant combines it with the selection's other items, which variant choosing it selects, and why the backend refused to try that variant on, if it did. Choosing an item (`SelectionAction::SelectItem`) selects the variant with it that keeps the most of the selection's items, chosen ones first, and counts its axis as chosen. The host describes what it shows as a `HostProduct`: the product, its axes, the variant selected and the axes chosen on purpose, in `FlowConfig` and again in `SelectionAction::HostProductUpdated` whenever it changes; sent again unchanged, it changes nothing, so the shopper's own choices stay. The size recommendation picks the items on the axes nobody chose (`chosen_axes`), so a host's colorway stays and its default size does not; with every axis chosen, the selection is explicit. `AddToCartRequested` carries the variant's foreign IDs so the host can find its own variant; stock is the shop's to check.

## Size recommendations and refusals

A `SizeRecommendation` scores every size of the product for the body: `SizeRecommendationScore` has the size's variants, an aggregate `FitScore` (its `FitMatch`, from 0 to 1, and its `Fit`, from `TooSmall` to `TooLoose`) and a `FitAxisScore` for each measurement compared: which one (`FitAxis::Chest`, `Waist`, `Inseam`, …) and its `Fit`. A size-chart column of any other measurement is left out. The backend reports the scores in any order; the domain orders them by fit match, a tie by the product's order of their variants. There is no rank, no text and no measurements: the fits carry what a rationale would say, for the host to put in the shopper's language.

Whether the backend will try a variant on is learned only from a refused try-on: `TryOnOutcome::Refused` (the API's `TryOnGarmentTooSmall` and `TryOnGarmentTooLarge`). The refused request keeps the refused key, the body revision and the variant (`TryOnRequestStatus::Refused { try_on: RefusedTryOn }`); the domain announces it (`TryOnEvent::Refused`) and refuses every later request for that key at once, without a job. A new height revision is a new key, and a new photo or a reset forgets every refusal. The flow then marks the item in its row, refuses to try it on, as `can_request_try_on` says and `RequestTryOn` agrees (`Rejection::TryOnRefused`), and seeds the next best size instead: a size with any refused variant is skipped, since the backend refuses a size for the body whatever its colorway. Auto-start still starts at most once.

## Try-on requests

A request receipt tracks waiting, running, failure, refusal, or the ID of a completed result.
`DomainSnapshot.try_ons` stores completed results in creation order, independently of request
receipts. The same variant and body revision reuse a cached result. An older height's results
remain browsable, with their original height.

`SessionConfig.max_try_on_requests` bounds each history. Oldest settled receipts leave the
request history first. An open request stays until it settles. Results leave their history
in creation order, while fit refusals remain effective for their body revision.

The default experience follows one foreground request at a time. The shopper can change the
draft variant or browse cached results during a render. `PresentationView.foreground` reports
the work and its failure. `primary_action` describes the picker’s action. `retry_variant_id` and `can_request_try_on` report which direct actions are
available. The result toolbar may prepare a companion in the background. Leaving a render (Back, a new request, another product) detaches the followed request; a companion whose render becomes uncertain is detached too.

A browser renderer attaches with its foreground and cart availability. The flow returns a
renderer token that scopes its actions and device observations. The renderer reports the current
image version and whether it decoded. The flow requests recovery or download work and ignores
reports for earlier renderers, displays, or image versions. URLs, camera streams, and native
work handles stay in the host. The effect driver delivers each committed batch with its revision
and its before and after flow views.

## Delivering effects

Claim one `EffectDriver` per session. `next_batch` refuses another batch until the current one is acknowledged:

```text
batch = driver.next_batch()
for effect in batch.effects, in order:
    start it with the right adapter
    report any immediate outcome through the session or flow
driver.acknowledge(batch.id)
```

Acknowledging means the effects were **started**: do not wait for network work to finish. Report it later with `session.complete(Completion { operation, outcome })`. Synchronous completions are fine (no host code runs under the runtime's lock); their effects queue behind the current batch. Use one serial executor; do not acknowledge early and start effects on other threads.

If an adapter fails partway through a batch, call `driver.halt(batch.id)`; dropping a driver with a batch in flight does the same. Delivery then stops rather than replaying effects whose execution is uncertain: release resources and create a new runtime. The queue is in memory, not a durable outbox.

`QueueFull` leaves the call uncommitted: drain the queued batches and retry it.

## Outcomes

Every operation starts with `DomainEffect::Start { operation, job }`; report how it ended with `session.complete(Completion { operation, outcome })`, with the outcome of the job's concern or one any operation can have. No job carries the session's secret: the host keeps it, as a cookie the browser manages or a token in secure storage, and attaches it to every request. A reset cancels the old session's operations, so their requests must not outlive it.

| Job                            | Adapter                                               | Outcome                                                          |
| ------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `SessionJob::Restore`          | Restore and verify the session and any committed body | `Absent`, `Ready`, a restored body, `SessionExpired` or `Failed` |
| `SessionJob::Create`           | create one with the job's consent                     | `SessionOutcome::Ready` or a failure                             |
| `PhotoJob::Process`            | upload and process; hold the media's lease            | `PhotoOutcome::Accepted`, `PhotoOutcome::Rejected` or a failure  |
| `BodyJob::SetHeight`           | one write of the body's height                        | `BodyOutcome::HeightSet` or a failure                            |
| `SizeRecommendationJob::Fetch` | score the key's product's sizes for a body            | `SizeRecommendationOutcome::Fetched` or a failure                |
| `TryOnJob::Create`             | create exactly the job's key                          | `TryOnOutcome::Created`, `TryOnOutcome::Refused` or a failure    |

The other domain effects need no outcome. `Cancel` asks for best-effort cancellation: still report the operation's own terminal outcome once it is established. `Session` effects store the established session's secret (`Persist`), forget it (`Clear`), or release the runtime's credentials while retaining restorable storage (`Release`), and `Media` effects are the domain's interest in a photo (see Media). A restore answered with `SessionExpired` clears the stored session, so the next runtime does not try it again.

`Failed` means the remote operation has ended. Use `Unknown` when a timeout or disconnection leaves that uncertain: an unknown session creation counts as failed, so the next photo source creates a fresh session; an unknown `SetHeight` blocks further body work until an authoritative outcome settles it, a session reset, or a photo with a fresh body identity. An accepted replacement photo must come with a new body ID. An unknown render stays uncertain only while a request still holds it: `TryOnCommand::DetachRequest` lets go of a request (a waiting one is cancelled, a rendering one still settles with its try-on), and a render no request holds any more is dropped and cancelled. `TryOnEvent::RequestDetached` reports how far the request had got.

A new photo retires the work that read or wrote the old body, and a reset retires all work: their late completions find nothing and are ignored. Browser cookie outcomes also carry the opaque cookie generation. An invalidation can expire that generation or prevent its in-flight restoration from establishing a session. Showing another product, or a changed one, likewise retires the size recommendation being fetched, and waiting try-on requests for any other product fail.

The state machine mints its own identifiers (operations, try-on requests, flows, batches, drivers and interaction tokens) deterministically from `SessionConfig.runtime_id`: give every runtime a new random UUID, so a recreated runtime ignores an older one's completions.

## Device effects

Device effects are the flow's: `DeviceEffect::Picker`, `Camera` or `Media`. Report each outcome through the flow's `complete_device`, as the device's event (`PickerEvent`, `CameraEvent`) with the effect's token. Keep the flow alive while a native request can still answer, even after disposing it: a late camera lease or picked photo comes back as a release effect instead of being installed. Once a newer flow replaced it, release such late resources yourself.

`CameraEffect::ScheduleTimer` carries a monotonic deadline; report `CameraEvent::TimerElapsed` with time from the same clock, never wall-clock time. An early callback is rescheduled, and a retired token cannot capture.

In a browser, start a picker effect synchronously inside the user's gesture: dispatch the action and drain its batch before awaiting anything. The flow can hold a picked photo while the session is still being created, and sends it once the session is ready, even if the flow was closed or suspended meanwhile. The camera screen opens the camera whenever it waits for one: when the flow is open and in the foreground, the session ready, and no new photo waits or is processed.

## Photo changes

The default experience offers camera and library for every replacement. A `PhotoChange` keeps
the originating screen and any new photo until the shopper cancels or the backend accepts it.
The photo can wait for a ready session, be processed, or fail with a reason. Cancelling restores
the originating screen and releases the candidate. A rejected photo opens the rejection screen,
which offers another source or the photo guide. A confirmed transient upload failure can retry
the staged photo.

## Media

Only a photo's `MediaId` crosses into the state machine; the host's registry keeps the bytes, previews and capture metadata. `MediaEffect::Retain` and `MediaEffect::Release` are per owner: the domain (`DomainEffect::Media`), each flow (`DeviceEffect::Media`), and the adapters' own transport leases. Releasing one owner's interest must not revoke another's, so an upload in flight survives a session reset.

## Consistency of the body

The snapshot's `body` is a `BodyState`: `NoBody` before a photo is accepted and after a reset; `Live` with the body's `BodyIdentity` and its `HeightStatus` (`Unset`, `Pending`, `Uncertain` or `Acknowledged`, which alone carries the backend's opaque revision of the height); or `Missing` once the backend answered `BodyNotFound` for it, which only a new photo or a reset leaves.

A `SetHeight` never overlaps a read of the same body: it waits for try-ons and size recommendations being fetched, and no new reader starts while it waits. Try-on requests made meanwhile wait for the write and then read its revision. This coordination holds within one runtime; every surface editing one body must share it.

## Events

Besides work, a batch carries what happened: `DomainEvent` effects with the domain's events, and `FlowEvent` effects with the flow's own. Each names its concern, as `DomainEvent::TryOn { event: TryOnEvent::Created { … } }` does. `TryOnEvent::Created` carries the try-on and its originating operation, once per new one: a request reusing it resolves (`TryOnEvent::RequestResolved`) without another. `TryOnEvent::Evicted` identifies the result that left the bounded history so adapters can release its cached metadata. `TryOnEvent::Refused` likewise carries a refused try-on once, and a request refused by an earlier refusal settles with `TryOnEvent::RequestRefused` alone. `DeviceEffect::Cart` gives the storefront a token, product, variant, and exact result. Report the token and outcome as `DeviceEvent::Cart`. The flow owns duplicate prevention and closes only the opening that requested the cart action. `SelectionEvent::AddToCartRequested` records admission. `FlowEvent::Journey` reports the effective step and the last result the renderer confirmed with `PresentationAction::ImageReady`. `FlowEvent::DeviceRecovery` reports accepted picker and camera recovery outcomes. `DomainEvent::OperationUncertain` identifies the work and its original product. Map events to analytics in an adapter, and keep media out of them.
