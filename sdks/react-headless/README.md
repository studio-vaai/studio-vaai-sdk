# @studio-vaai/react-headless

React hooks and a provider for the studio vaai **virtual try-on** flow — the headless layer:
all behaviour, no UI.

Want prebuilt, styled UI instead? Use
[`@studio-vaai/react-components`](https://www.npmjs.com/package/@studio-vaai/react-components).

## Install

```bash
npm install @studio-vaai/react-headless
```

Peer dependencies: `react` and `react-dom` (`^18` or `^19`).

Import **this package only** in application code; its lower layers (`@studio-vaai/js-client`,
`@studio-vaai/js-machine`) are regular transitive dependencies — import their domain
types/helpers directly from those packages when you need them.

## Quick start

1. Obtain a **`StudioVaaiClient`** (e.g. `createFetchStudioVaaiClient` from
   `@studio-vaai/js-client`).
2. Wrap your tree with **`StudioVaaiProvider`**, passing `client` and `input`.
3. In children, call **`useStudioVaaiActor()`**.

```tsx
"use client";

import {
  StudioVaaiProvider,
  useStudioVaaiActor,
  type DefaultRootInput,
  type StudioVaaiClient,
} from "@studio-vaai/react-headless";

function App({ client }: { client: StudioVaaiClient }) {
  const input: Omit<DefaultRootInput, "client"> = {
    product, // from `buildTryOnFlowProduct` in @studio-vaai/js-machine
    selection: { colorway: "A100-259", size: "M" },
  };

  return (
    <StudioVaaiProvider client={client} input={input}>
      <Step />
    </StudioVaaiProvider>
  );
}

function Step() {
  const { state, dispatch } = useStudioVaaiActor();
  return <pre>{JSON.stringify(state.value, null, 2)}</pre>;
}
```

`useStudioVaaiActor()` returns:

| Field          | Role                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| **`state`**    | Current snapshot of the flow — which step you're on, plus context data.  |
| **`dispatch`** | Send a typed event (e.g. `{ type: "…" }`) to advance or branch the flow. |
| **`actor`**    | The underlying actor, for advanced use and debugging.                    |

Use **`useStudioVaaiSelector`** when you only need a slice of `state`, to limit re-renders.

## Custom root machine

`createStudioVaaiContext(yourMachine)` returns a `StudioVaaiProvider` and hooks typed for
your own machine. The default export is built on `defaultRootMachine`, which is also
re-exported for composition.

## Errors

| Error                                     | When                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| **`StudioVaaiProviderError`**             | A hook is used outside `StudioVaaiProvider`.                             |
| **`StudioVaaiClientNotImplementedError`** | `createClient()` was called without a transport.                         |
| **`ApiFailureError`**                     | An actor threw after a failed API result; `failure` holds the API error. |

## Next.js / SSR

Mount the provider and hooks under a `"use client"` boundary. This library does not assume
`window` in its module scope.

## License

MIT
