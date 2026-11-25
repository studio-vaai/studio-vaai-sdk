# Migrate to the Rust-based web SDK

The legacy packages are no longer maintained. Replace them as follows:

| Legacy package                  | Use instead                                                             |
| ------------------------------- | ----------------------------------------------------------------------- |
| `@studio-vaai/react-components` | `@studio-vaai/react`                                                    |
| `@studio-vaai/react-headless`   | `@studio-vaai/react`                                                    |
| `@studio-vaai/js-machine`       | `@studio-vaai/web-components/experience`, or `@studio-vaai/vue` for Vue |
| `@studio-vaai/js-client`        | `@studio-vaai/core`, which includes the generated API client            |
| `@studio-vaai/js-tracking`      | `@studio-vaai/core/analytics`                                           |
| `@studio-vaai/js-debugger`      | No replacement: use the experience's typed events and the network panel |

Use `@studio-vaai/react` for React storefronts, `@studio-vaai/vue` for Vue 3 storefronts and
`@studio-vaai/web-components/experience` for other browser hosts. Pass the product's API ID and
present its variants using the storefront's labels, prices, and stock.

Use the experience's typed event feed for storefront callbacks. Analytics uses
`@studio-vaai/core/analytics` and the generated API client. Existing valid browser cookie sessions
can resume and recover a saved body. A shopper using a legacy browser-stored bearer token starts a
new session and grants consent again.

The fit score is off by default. To show it, as the legacy components could, opt in with `fitScore`
(React), `fit-score` (Vue) or the `fit-score` attribute on `<sv-try-on-experience>`.

See the [web SDK documentation](https://docs.studio-vaai.com/sdk/web) for each framework's guide.
