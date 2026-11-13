# studio vaai SDKs

Customer-facing SDKs published as `@studio-vaai/*` connect applications to hosted APIs for
virtual try-on, size guidance and optional storefront analytics.

Identify your SDK release by its package name, installed version and target platform.
The package version identifies installed code; the API contract date identifies the wire contract.

## Manufacturer

**studio vaai GmbH**

Freddie-Mercury-Straße 5, 80797 München, Germany.

Contact: [info@studio-vaai.com](mailto:info@studio-vaai.com) · [studio-vaai.com](https://studio-vaai.com).

## Security and support

See [Security support](SECURITY_SUPPORT.md) for the support policy, SDK update instructions
and vulnerability reporting.

## Web packages

| Package                                          | Purpose                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| [`@studio-vaai/core`](core-rs/)                  | Rust state machine, generated API client, analytics, and localized messages. |
| [`@studio-vaai/web-components`](web-components/) | Standalone screens and a browser try-on experience.                          |
| [`@studio-vaai/react`](react/)                   | React lifecycle and storefront integration for the web experience.           |
| [`@studio-vaai/vue`](vue/)                       | Vue 3 lifecycle and storefront integration for the web experience.           |

The TypeSpec sources in [`api/`](api/) define the business API and analytics collector.
Run `pnpm --filter @studio-vaai/api generate` to regenerate the OpenAPI documents and the Rust
client. The same client is used from the web through WASM.

## Rust core

[`core-rs`](core-rs/README.md) is the platform-independent core written once in Rust: Swift and
Kotlin call it through UniFFI, and the web through generated TypeScript and WebAssembly.
Formatting (MF2 messages and locale data), image metadata, the try-on state machine, and the
public API client are Rust subdomains. `sdk-core` exposes their platform bindings. The API
client is generated from the TypeSpec contract and uses the platform's HTTP transport.

The `@studio-vaai/core` web adapter owns initialization, catalog access and typed MF2 parts.
`@studio-vaai/web-components` depends on it for SDK-owned copy and renders stateless UI. Its shared
UI context owns locale and appearance; session and interaction state stay with the host. The
framework-free UI is also used by the React wrapper:

```text
@studio-vaai/react → @studio-vaai/web-components → @studio-vaai/core (Rust/WASM)
```

Build the core web adapter with `pnpm --filter @studio-vaai/core build`. Package builds then follow
the declared dependency order; the pinned Rust toolchain and `just` must be available.

The legacy web SDK remains available during the transition. See the [legacy migration guide](MIGRATION.md).
