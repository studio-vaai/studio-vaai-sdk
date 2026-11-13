/** @vitest-environment jsdom */

import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";

import {
  StudioVaaiProvider,
  StudioVaaiProviderError,
  useStudioVaaiActor,
  useStudioVaaiSelector,
} from "../src/index.js";
import { createMockClient, testProduct, testProductId } from "./helpers.js";

const defaultInput = {
  product: testProduct,
};

function StateProbe() {
  const { state } = useStudioVaaiActor();
  return <span data-testid="probe">{JSON.stringify(state.value)}</span>;
}

function SelectorProbe() {
  const productId = useStudioVaaiSelector((s) => s.context.product.id);
  return <span data-testid="product">{String(productId)}</span>;
}

function MissingProviderConsumer() {
  useStudioVaaiActor();
  return null;
}

describe("StudioVaaiProvider", () => {
  it("mounts and exposes state and dispatch", async () => {
    const client = createMockClient();
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <StateProbe />
      </StudioVaaiProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("probe").textContent?.length).toBeGreaterThan(0);
    });
  });

  it("useStudioVaaiSelector reads context slice", async () => {
    const client = createMockClient();
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <SelectorProbe />
      </StudioVaaiProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("product").textContent).toBe(testProductId);
    });
  });

  it("throws stable error when hooks used outside provider", () => {
    expect(() => render(<MissingProviderConsumer />)).toThrow(StudioVaaiProviderError);
  });

  it("works under React StrictMode", async () => {
    const client = createMockClient();
    const { getByTestId } = render(
      <StrictMode>
        <StudioVaaiProvider client={client} input={defaultInput}>
          <StateProbe />
        </StudioVaaiProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(getByTestId("probe").textContent?.length).toBeGreaterThan(0);
    });
  });
});
