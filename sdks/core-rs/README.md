# studio vaai SDK core

The part of the studio vaai SDKs that is written once, in Rust, and compiled into every SDK: the iOS and Android SDKs call it through Swift and Kotlin bindings, and the web SDK through WebAssembly, and all three bindings are generated from the same annotations. Each platform runs the same code, so they behave the same.

## Layout

The core is split into subdomains. Each one is a module of `sdk-core`, which exposes it to each platform, and its logic lives in a plain-Rust crate beside `sdk-core` when it needs no platform code. `sdk-core` holds the bindings of each subdomain, except the state machine's: that crate derives its own, behind its `uniffi` feature, so the bindings pass its types through as they are.

| Crate                               | What it is                                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`sdk-core`](sdk-core/)             | `studio-vaai-core`: exposes the core to each platform, one module per subdomain, all in one library.                                                                                                            |
| [`image-metadata`](image-metadata/) | Plain Rust with no platform code. Reads a photo's focal-length EXIF and original pixel size from its headers.                                                                                                   |
| [`formatting`](formatting/)         | Plain Rust with no platform code. Formats Unicode MessageFormat 2 messages to parts, so renderers style their markup.                                                                                           |
| [`state-machine`](state-machine/)   | Plain Rust with no platform code. The try-on session's domain, its default experience, and the ordered effects the host performs for them. Its `uniffi` feature exports it in a UniFFI namespace of its own.    |
| [`api`](api/)                       | The public API client, generated from the TypeSpec contract (`sdks/api/public`). Builds every request and reads every response; the host sends them. Its `uniffi` feature exports it in a namespace of its own. |

## Image metadata

A body's measurements are estimated from a photo, and the estimate needs the camera's focal length. Phones record it in the photo's EXIF, but an app that downscales a photo before uploading it strips that EXIF. So the SDK reads the original photo first and sends what it found with the resized upload:

- the original width and height, in pixels;
- `FocalLength`, `FocalLengthIn35mmFilm`, `FocalPlaneXResolution`, `FocalPlaneYResolution` and `FocalPlaneResolutionUnit`, whichever the photo carries.

`readImageMetadata` takes the original photo's bytes (JPEG, HEIC/HEIF, PNG, WebP or TIFF) and returns that metadata, or nothing when the photo's size can't be read. It reads headers only and never decodes pixels, and malformed input reads as absent rather than failing.

The bytes are borrowed for the call, not copied. Swift passes the `Data`'s own memory. Kotlin passes a direct `ByteBuffer`, such as a `FileChannel.map()` of the photo, so only the header pages are ever read. The web build copies the bytes into WebAssembly memory.

## State machine

The try-on journey's logic, shared by every platform: a session's domain (`TryOnSession`: the product shown, the session, the photo and body with its height, the product's size recommendation, and the try-on requests with their try-ons) and its default experience (`DefaultTryOnFlow`: consent, screens, photo changes, selection, camera, presentation). Neither performs I/O. Each committed transition queues the work it needs as one batch of effects, which the host delivers through the session's single `EffectDriver`, reporting outcomes back as completions; a refused call commits nothing. The adapter contract is in the [crate's README](state-machine/README.md).

## API client

`api` is the client of the public HTTP API, the same in every SDK. `sdks/api/emitters/rust-client.js`, a TypeSpec emitter that `pnpm --filter @studio-vaai/api generate` runs with the OpenAPI one, writes `api/src/generated.rs` from the contract itself: every model and error the client's operations reach, and per operation a request builder, a response parser and an async method on `ApiClient`. CI regenerates it and fails when the committed file differs.

The client never opens a connection. It builds the whole request (URL, `X-Client-Api-Key`, `X-Api-Version`, the bearer token or cookie credentials, the JSON body) and hands it to an `HttpTransport` the host implements with its own HTTP stack: `URLSession` on iOS, OkHttp on Android, `fetch` on the web. Proxies, certificates and background sessions stay the platform's, and no HTTP or TLS stack ships in the core. The host returns every response, whatever its status; the client turns it into the operation's result or an `ApiError`:

- `Problem { status, problem }`: an `application/problem+json` body, as the `ApiProblem` variant of the error model it matches. Where a status allows several models (the 422 of `createTryOn`), the literals each model fixes (`kind`, `reason`) tell them apart; a body no model matches is `ApiProblem::Other`.
- `UnexpectedStatus`, `Decode`, `Transport` and `InvalidRequest` for the rest.

**Versions.** The API is versioned by date (`YYYY-MM-DD`; see the API docs' versioning page). The client speaks the one version its contract names, `@OpenAPI.info`'s `version` in `sdks/api/public/core.tsp`. It sends that version as `X-Api-Version` with every request and exposes it as `api_version()` (`apiVersion()` in the bindings). The emitter refuses a version that isn't a calendar date, and a contract versioned with `@typespec/versioning`, which it can't yet narrow to one date. A new date is a breaking contract change: bump it in `core.tsp`, regenerate, and release the SDKs.

Strings the contract limits to a set of literals are enums with an `Unknown { value }` case, so a client keeps decoding values a newer server adds. `x-internal` operations and fields are not generated, nor the `experiments` (OpenFeature) operations, which go through an OFREP provider.

In Swift:

```swift
final class URLSessionTransport: HttpTransport {
    func send(request: HttpRequest) async throws -> HttpResponse { /* URLSession.shared.data(for:) */ }
}
let client = ApiClient(config: ClientConfig(baseUrl: "https://api.studio-vaai.com", clientApiKey: key, clientName: "studio-vaai-swift"),
                       transport: URLSessionTransport())
let product = try await client.getProductDetails(productId: id)
```

## Building

`rust-toolchain.toml` pins a stable toolchain and lists the platform targets. The release profile is tuned for binary size.

- **Swift and Kotlin:** build `sdk-core` as a library for the target platform, then generate the bindings from it with the bundled generator: `cargo run -p studio-vaai-core --features cli --bin uniffi-bindgen -- generate --library <library> --language swift|kotlin --out-dir <dir>`.
- **Web:** `just wasm` builds `sdk-core` for `wasm32-unknown-unknown` and generates its TypeScript with [uniffi-bindgen-react-native](https://github.com/jhugman/uniffi-bindgen-react-native)'s `wasm2` flavour, into `build/wasm2`. The bindings run the module through the generic `@ubjs/wasm` player, so there is no hand-written glue: the TypeScript comes from the same annotations as the Swift and Kotlin. Call `uniffiInitAsync` with the `.wasm` once before the first call.

`just ci` checks the vendored crates against their patches, then runs rustfmt, clippy and the tests.

### The pinned uniffi-bindgen-react-native

Released uniffi-bindgen-react-native pins UniFFI 0.31, which has no zero-copy `&[u8]` argument. So the Justfile pins the head of [its UniFFI 0.32 bump](https://github.com/jhugman/uniffi-bindgen-react-native/pull/468), which is not merged yet, and `just ubrn` builds the CLI and both TypeScript runtimes from that commit (the published runtimes predate 0.32). Move to a release once one supports 0.32.

## Dependencies

The crates here depend on each other, on published crates, and on one vendored library:

- **[rust-mf2](https://github.com/EvanCarroll/rust-mf2)**, Evan Carroll's implementation of Unicode MessageFormat 2, MIT. Its crates live in [`vendor/mf2`](vendor/mf2/): the crates.io packages with the changes recorded in [`patches/mf2`](patches/mf2/), whose README also says how to rebuild them, record a change, or move to a new version.
- **Unicode CLDR** data, © Unicode, Inc., under the Unicode License v3: the message catalogs carry CLDR-derived plural rules and number symbols, and ICU4X's `icu_list` carries CLDR's list patterns.
- uniffi-bindgen-react-native's runtimes and `uniffi-runtime-wasm`, which the web build links, are MPL-2.0.

Everything else here is MIT.

## License

MIT. See [LICENSE](LICENSE).

## Web package

`pnpm --filter @studio-vaai/core build` runs `just wasm`, bundles the generated UniFFI bindings
and their pinned runtimes, and writes a self-contained ESM adapter, declarations, and the WASM
asset to `dist/`. These are build artifacts. The small `wasm-url.js` asset locator stays unbundled so a consuming
application can copy and fingerprint the WASM asset.

Web builds use Binaryen 133 (`wasm-opt` on `PATH`). After generating the bindings, the build
removes UniFFI's build metadata exports and optimizes the WASM for distribution.

`src/runtime.ts` owns one asynchronous WASM initialization. `src/formatting/` owns the stable web
part types, generated-binding conversion, shipped catalog lookup and compiled overrides.
`src/index.ts` is the public entry point. MF2 evaluation, locale data and message text remain in
Rust; the adapter does not parse messages or maintain another translation catalog.

`src/experience/` exposes the Rust selection, presentation, product and try-on records and
their enum constructors directly from the generated bindings. Its pure label helpers summarize
any variant in the host's axis order, using the text or alternative text of each item; no axis
key is interpreted as a size, color or style. `ItemDisplay.Glyph` uses the shared `ItemGlyph`
semantics with a host-localized name, and each platform maps the glyph to its own drawing.
Prices and stock belong to the storefront and are absent from these records. Enum construction
and label helpers do not require WASM initialization; invoking Rust still does.

`VariantAxis.display_options` carries optional `AxisDisplayOptions`: a chip or segmented
control, placed in the picker or result toolbar. These are semantic hints, with responsive
layout owned by each platform. `PresentationView.axis_rows` projects toolbar choices against
the displayed try-on's exact other items and body revision. `ShowAxisItem` switches an existing
companion immediately or follows its request without modifying selection. Background companion
preparation is serial, uses only free request capacity, and never follows or displays its own
results. Failed preparation is retried only on an explicit request. The implementation lives
in `state-machine/src/experience/presentation/axes.rs`.

```ts
import { initializeCore, availableLocales, createMessageFormatter } from "@studio-vaai/core";

await initializeCore(); // A host may supply its own WASM URL or bytes.
const messages = createMessageFormatter("de-CH");
messages.format("sessionIntro.legalFooter"); // MF2 parts, including the link markup.
messages.dispose();
```

The bundled UniFFI runtimes are MPL-2.0, from the unmodified source at the `ubrn_rev` pinned in the
Justfile: https://github.com/Dzejkop/uniffi-bindgen-react-native/tree/06f0a30d257573ffcc852e84e814670d53085979.
