# studio vaai SDKs

The client SDKs for studio vaai virtual try-on, and the HTTP API contracts they are built on.
[`sdks/README.md`](sdks/README.md) describes the packages, how they layer, and the rules they
follow.

| Path                                         | Package                       | What                                                                  |
| -------------------------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| [`sdks/api`](sdks/api)                       | —                             | The HTTP API in TypeSpec, and the OpenAPI documents generated from it |
| [`sdks/core-rs`](sdks/core-rs)               | `@studio-vaai/core`           | Shared Rust flow, API client, and analytics                           |
| [`sdks/web-components`](sdks/web-components) | `@studio-vaai/web-components` | Try-on screens and browser experience                                 |
| [`sdks/react`](sdks/react)                   | `@studio-vaai/react`          | React integration                                                     |
| [`sdks/vue`](sdks/vue)                       | `@studio-vaai/vue`            | Vue 3 integration                                                     |

The legacy packages remain available during the transition. See the [legacy migration guide](sdks/MIGRATION.md).

## Development

With Node 26 and pnpm (`corepack enable`):

```sh
pnpm install
pnpm generate   # the OpenAPI documents, and the TypeScript generated from them
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

The web packages build the Rust core and its generated UniFFI adapter first. Install the pinned
Rust toolchain and `just`; see [`sdks/core-rs/README.md`](sdks/core-rs/README.md).

## Releases

The `Publish` workflow publishes the `@studio-vaai/*` packages to npm, with provenance. Each
package's version comes from its `package.json`.

## License

MIT
