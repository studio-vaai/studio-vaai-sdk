/** @vitest-environment jsdom */

import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  StudioVaaiProvider,
  useStudioVaaiActor,
  useStudioVaaiExternalSelection,
} from "../src/index.js";
import { createMockClient, testProduct } from "./helpers.js";

/** Stable across rerenders: the provider reads it once, at mount. */
const providerInput = { product: testProduct, selection: { size: "m" } };

function Harness({ size }: { size: string }) {
  useStudioVaaiExternalSelection({ product: testProduct, selection: { size } });
  const { state } = useStudioVaaiActor();
  return <span data-testid="selected">{state.context.selection.size ?? ""}</span>;
}

function FlagHarness({ isDefault }: { isDefault: boolean }) {
  useStudioVaaiExternalSelection({
    product: testProduct,
    selection: { size: "m" },
    selectedSizeIsDefault: isDefault,
  });
  const { state } = useStudioVaaiActor();
  return <span data-testid="default">{String(state.context.sizeIsDefaultSelection)}</span>;
}

describe("useStudioVaaiExternalSelection", () => {
  it("adopts the host's size wherever the flow is parked", async () => {
    const client = createMockClient();
    const { getByTestId, rerender } = render(
      <StudioVaaiProvider client={client} input={providerInput}>
        <Harness size="m" />
      </StudioVaaiProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("selected").textContent).toBe("m");
    });

    // The shop's own size chip moves while the flow is parked OFF the product screen — which is
    // where it sits after a render, and where it sits while the shopper is back on the page.
    // Re-entering the try-on has to adopt the size the SHOP is showing rather than resume the
    // size of the last try-on. Both halves of the old drop are covered here: the hook withheld
    // the push unless the flow was on the product screen, and the machine handled the event only
    // there.
    rerender(
      <StudioVaaiProvider client={client} input={providerInput}>
        <Harness size="l" />
      </StudioVaaiProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("selected").textContent).toBe("l");
    });
  });

  it("carries the page's size-default flag, and pushes when only the flag changes", async () => {
    const client = createMockClient();
    const input = { ...providerInput, selectedSizeIsDefault: false };
    const { getByTestId, rerender } = render(
      <StudioVaaiProvider client={client} input={input}>
        <FlagHarness isDefault={false} />
      </StudioVaaiProvider>,
    );
    expect(getByTestId("default").textContent).toBe("false");
    // Same product and size: the page now says the size is only its default.
    rerender(
      <StudioVaaiProvider client={client} input={input}>
        <FlagHarness isDefault />
      </StudioVaaiProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("default").textContent).toBe("true");
    });
  });
});
