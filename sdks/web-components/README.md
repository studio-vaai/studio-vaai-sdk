# @studio-vaai/web-components

Draft. The studio vaai try-on UI rebuilt as framework-free custom elements with
[Lit](https://lit.dev). Framework packages
(`@studio-vaai/react`, …) become thin wrappers around these elements.

Not published yet (`"private": true`).

## Use

```ts
import "@studio-vaai/web-components/define"; // registers every sv-* element
```

```html
<sv-button variant="primary">Try on M</sv-button>
<sv-badge variant="positive">Recommended M</sv-badge>
<sv-spinner label="Uploading photo"></sv-spinner>
```

`import { SvButton, type SvButtonProps } from "@studio-vaai/web-components"` gives the classes and
their typed props without registering anything.

## Rules for every element

- **Stateless.** A screen renders its properties and emits events. The experience drives the
  flow with the shared Rust state machine.
- **Typed props.** Elements with public properties export a `Sv…Props` interface and option lists
  (`SV_BUTTON_VARIANTS`, …). The docs generate their controls from these types.
- **Tokens only.** Component CSS reads the private `--_sv-*` tokens from
  [`src/styles/tokens.ts`](src/styles/tokens.ts), never literal colors or sizes.
- **Shared environment.** Extend the private `SvElement` adapter. SDK-owned copy reads its UI
  context and opts into lazy formatting with `usesMessages`; locale and appearance stay out of
  component props. Primitives that render caller-supplied text do not load the formatter.

## Naming props and events

The same idea gets the same name on every element.

**Looks**

- Each visual dimension is its own option with named values, as shadcn's `variant` and
  `size`. `variant` is the main one: what the look means or how much it stands out. Another
  dimension gets an option named for it, such as `layout="inline" | "card"` on a message, so
  a new look later is one more value, not a new prop. Yes/no options are for features, never
  for looks (`zoomable`, `mirrored`, `persistent`).
- Once two looks need clearly different structure inside, they become two elements.
- Variants that carry a meaning use the color tokens' names: `neutral`, `positive`, `caution`,
  `destructive` (a badge, a message, a fit callout). Variants that set how much an element
  stands out use shadcn's look names: `primary`, `ghost` (plain text without a box).
- `size` is `sm` | `md`.
- A different way to operate the element is `mode`, not `variant` (the height input's `wheel` or
  `stepper`). An element that picks it by itself exposes what it picked as `resolvedMode` (or
  `resolvedShape` for the dialog).

**Text.** Caller-supplied labels and slots come from the owner, translated. SDK-owned copy comes
from the shared UI context and Rust MF2 catalogs; elements hold no translated literals.

- `heading` titles a region of content the element holds: a screen, a dialog's box, a
  disclosure. It's shown as a heading.
- `label` names the thing itself: a control, a value, a measurement. It's shown where the
  element has a place for it (a fit score's "Fit Score for S", a fit callout's "Hip"), and is
  otherwise its accessible name (a dialog, an icon, the height input). An element never has both a
  visible label and a separate hidden name. An image's name is `alt`, as on `<img>`.
- `description` is the visible text under or after the heading or label.
- `<part>Label` supplies caller-owned action text (`confirmLabel`, `retryLabel`). Standard back
  and close names come from the shared `surface.backSr` and `surface.closeSr` messages.
  Back and close buttons are always shown.
- The element's main content goes in its default slot (a button's label, a message, a
  checkbox's sentence).

**State**

- `open`, `checked`, `disabled` as in HTML. `busy` means work is in flight: it sets
  `aria-busy`, shows it and blocks the element's actions (never `loading` or `pending`).
  `failed` means the element's data couldn't be loaded and it offers a retry.
- An element with a current value takes it as `value`; an item in a group says it's the chosen
  one with `selected`. `status` is a fact about an item's value (a chip's `sold-out`), not a
  look.
- Lists are `items`; the choices of a group are `options`. Both are properties only, since
  arrays can't be attributes.
- A camel-case property has a kebab-case attribute (`panelAlign` ↔ `panel-align`).

**Events.** Elements never change their own state; they ask, and the owner answers by setting
the property.

- `sv-change` asks for a new value: `detail.value` is the `value` (or `checked`) asked for.
- `sv-toggle` asks to open or close: `detail.open`.
- Other requests are named for the action: `sv-dismiss`, `sv-confirm`, `sv-cancel`, `sv-back`,
  `sv-retry`, `sv-switch-camera`. A `detail.reason` says how, where there are several ways.
- A plain press stays the native `click`.

`sv-variant-picker` renders the Rust experience's `SelectionView` directly. Its `sv-select`
request carries `{ axis, item }`, matching `SelectionAction.SelectItem`. Color swatches,
images, glyphs and text are display kinds of ordinary axis items. A row item with
`available: false` can still select its target variant, changing other axes; only an absent
target or the picker's `disabled` input prevents that choice. Refusal describes fit, not stock.

## Screens

Field validation uses `validationError` and optional `description` on `sv-checkbox` and
`sv-height-input`. The control associates that copy inside its shadow root and announces
errors. Session Intro forwards `consentError`; Height Setting forwards `heightError`.
Keep upload/save failures in the screen's separate `error` input. Height corrections are
explained in a localized status message.

Photo-guide instructions and review photos have text alternatives. SDK-generated copy follows
the UI context's language. Explicit caller `lang` attributes take precedence. Chip status
descriptions have localized defaults, which a caller's `description` overrides.

`src/screens` contains the five screens of the try-on flow and its retake confirmation dialog.
Each has its own subpage under **SDK › Web › Screens**.

`sv-session-intro-screen` composes the guide, steps, privacy disclosures, consent, and actions.
The host owns consent, disclosure state, errors, and busy state. It accepts requests from
`sv-session-intro-change` and handles `sv-session-intro-action`. English/German defaults and
localized text/link overrides are available without a framework dependency. Its screen-specific
sections are private render helpers.

`sv-photo-capture-screen` composes permission and failure states, a live `sv-camera`, timer
controls, and the captured still in `sv-image`. The host owns the stream, countdown, screen state,
upload, and object URLs. `sv-photo-capture-action` requests host actions; `capture()` delegates
to the camera without changing state. Logic, message mapping, and composition styles live
under `src/screens/sv-photo-capture-screen.ts` and `src/screens/photo-capture/`.

`sv-photo-upload-rejected-screen` renders the rejected photo and a single inline error above
upload/guide actions. Its four inputs are `photoSrc`, `photoCrop`, `error`, and `busy`; the host
handles guide navigation and photo selection through `sv-photo-upload-rejected-action`.

`sv-height-setting-screen` composes the photo and existing height input, requesting
`heightCm` changes and confirm/upload actions. The host must supply the initial height;
the screen never invents one and cannot confirm a missing or invalid value.
`sv-try-on-view-screen` combines variant selection, generation, and result exploration in one
screen. It takes Rust `SelectionView` and `PresentationView` records, together with domain `Product` and immutable
`TryOn` records. The presentation's try-on IDs determine the displayed image and history;
the selection determines the next request. All axis kinds share the picker, with generic
variant summaries in the host's axis order. Cart requests name the displayed variant,
and download requests name its try-on. Storefront metadata in `commerce`, keyed by variant ID,
supplies already-formatted price and stock; these never enter the Rust selection model.
Axis `displayOptions` select chips or a segmented control and place the axis in the picker
or result toolbar. Selection screens keep every axis in their picker. The result toolbar
uses `presentation.axisRows`, projected against the displayed variant and body revision;
cached choices request their actual try-on immediately. An uncached choice requests
`ShowAxisItem` through the host. Rust prepares companions serially when cache space is free,
without changing the next selection or replacing the displayed image in the background.
Its UI-specific types, message mapping, and composition
styles have separate modules under `src/screens/try-on-view/`.
Fit data is a single `fit` value tied to a `tryOnId`, with mutually exclusive loading,
ready, and error states. Only the displayed result's fit data is rendered. The host owns
`fitDetailsOpen` and `activeCalloutKey`; disclosures remain readable during busy work.
For screen errors, omission uses the state default where available; an empty string hides
the message. Busy work does not clear host-supplied error text.

`sv-photo-retake-dialog` composes the existing alert dialog with localized confirmation copy.
The host owns `open`; retake/cancel requests never delete a photo or close the dialog themselves.

`src/media/image-crop.ts` defines `SvImageCrop`, the fractional rectangle returned by camera
capture and accepted by `sv-image.crop`. Cropping and pinch zoom share the same geometry;
captured JPEGs do not need to be encoded again to preserve the framing. The image's `overlay`
slot anchors screen-specific callouts and image actions to that visible frame, while the shared
screen's `heading` slot allows composed titles without duplicating its heading/navigation markup.

Component stories live in `web-sdk/stories/components`, with their wrappers in `wrapper`;
screen stories use the same structure under `web-sdk/stories/screens`.

## Theming

Shops set public `--sv-*` custom properties on any ancestor:

```css
sv-button {
  --sv-primary: #6e59f7;
  --sv-primary-foreground: #ffffff;
  --sv-radius: 4px;
  --sv-font-sans: "Inter", system-ui, sans-serif;
}
```

- **Colors:** seven seeds (`background`, `foreground`, `primary`, `primary-foreground`,
  `positive`, `caution`, `destructive`). Grays, lines and status tints are derived with
  `color-mix()`; the defaults are shadcn's Neutral theme.
- **Font:** Inter, else the system font, as today's try-on; the SDK doesn't load it. Name
  another family in `--sv-font-sans` to change it.
- **Sizes:** two inputs. `--sv-root` is the text size; `--sv-density` is a plain number
  (default `1`) that scales padding and gaps. Spacing is root × 0.25 × density times Tailwind's
  numbers, and a button's height is its label's line height plus padding, so nothing sets a
  height on its own.
- **Dark:** `svAppearanceStyle("dark")` returns the public properties for the dark appearance.

## Develop

```bash
pnpm --filter @studio-vaai/web-components test
pnpm --filter @studio-vaai/web-components build
```

The elements are explored on the docs site's **SDK › Web components** page (Fumadocs Story,
`just dev-docs`).

## UI context

```ts
import { ui, createUiContext } from "@studio-vaai/web-components";

ui.configure({ locale: "de", appearance: "dark" });
await ui.ready();

const scopedUi = createUiContext({ locale: "en", appearance: "light" });
const detach = scopedUi.attach(document.querySelector("#try-on")!);
await scopedUi.ready();
```

The nearest scope applies across shadow roots; otherwise elements use the shared `ui` default.
Locale and appearance are never component props or browser preferences. Configuration changes
rerender connected elements and preserve host-owned business state. Custom CSS tokens still
work as explicit overrides. Call `detach()` when removing a scope.

`src/ui/` holds the public context API, observable state, and DOM scope registry. The private
`src/internal/ui-element.ts` adapts that environment to Lit. Screen-local message compositions
stay under their screen, while `src/internal/messages.ts` renders safe MF2 parts. Rust formatting
and its web adapter live in `@studio-vaai/core`; there is no second translation engine.

Build the core before developing these components: `pnpm --filter @studio-vaai/core build`.
The first core build requires the Rust toolchain and UniFFI generator described in
`../core-rs/README.md`.
