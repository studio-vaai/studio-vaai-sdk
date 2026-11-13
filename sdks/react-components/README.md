# @studio-vaai/react-components

Prebuilt, styled React UI for the studio vaai **virtual try-on** flow — drop it in and get a
complete try-on experience.

It builds on [`@studio-vaai/react-headless`](https://www.npmjs.com/package/@studio-vaai/react-headless)
and ships **vendored CSS** (Tailwind with an `sv-` prefix, no preflight), so you don't need
to run a Tailwind pipeline of your own.

## Install

```bash
npm install @studio-vaai/react-components @studio-vaai/react-headless
```

Import the stylesheet once (SSR-safe):

```ts
import "@studio-vaai/react-components/studio-vaai-components.css";
```

## Quick start

Wrap your tree with `StudioVaaiProvider`, then render `StudioVaaiDefaultFlow`:

```tsx
"use client";

import { StudioVaaiDefaultFlow } from "@studio-vaai/react-components";
import { StudioVaaiProvider, type StudioVaaiClient } from "@studio-vaai/react-headless";

export function TryOn({ client }: { client: StudioVaaiClient }) {
  return (
    <StudioVaaiProvider client={client} input={{ productId, selection }}>
      <StudioVaaiDefaultFlow />
    </StudioVaaiProvider>
  );
}
```

In the Next.js App Router, put `"use client"` on the file that uses the hooks/components.
Components that call hooks or use browser APIs are marked `"use client"`; purely
presentational primitives are not, so they can render in a Server Component.

## Language

`locale` takes any BCP 47 tag (`de`, `de-AT`, `en-GB`, `fr`; default `en`). The tag's language
picks the built-in text: German for `de-*`, English for everything else. Numbers, units,
percentages and lists are formatted for the full tag. For another language, pass your own complete
`StudioVaaiUiMessagesSource` as `messages`; a partial one fills the missing keys from English.

```tsx
<StudioVaaiDefaultFlow locale="fr" messages={frenchMessages} />
```

## Subpath entrypoints

| Import                                     | Contents                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@studio-vaai/react-components`            | The full flow and styled components.                                                                                                                                     |
| `@studio-vaai/react-components/primitives` | Unstyled layout building blocks (`ActionsSection`, `ImageView`, `VStack`, …) — no Base UI, no bundled styles.                                                            |
| `@studio-vaai/react-components/ui`         | Styled UI elements.                                                                                                                                                      |
| `@studio-vaai/react-components/debug`      | Dev-only `DebugSheetButton` — a drop-in `SheetDebugButton` override that bridges the flow snapshot to the `<studio-vaai-debugger>` element (`@studio-vaai/js-debugger`). |

Types and the client come from `@studio-vaai/react-headless` — a single import surface for
your app code.

## Errors

Prefer `ApiResult` checks at the HTTP layer; flows may throw `ApiFailureError`. Using a
component or hook outside `StudioVaaiProvider` throws `StudioVaaiProviderError`.

## License

MIT
