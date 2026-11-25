# Migrate to the Rust-based web SDK

Use `@studio-vaai/react` for React storefronts and `@studio-vaai/web-components/experience`
for other browser hosts. Pass the product's API ID and present its variants using the storefront's
labels, prices, and stock.

Use the experience's typed event feed for storefront callbacks. Analytics uses
`@studio-vaai/core/analytics` and the generated API client. Existing valid browser cookie sessions
can resume and recover a saved body. A shopper using a legacy browser-stored bearer token starts a
new session and grants consent again.
