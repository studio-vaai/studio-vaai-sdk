import type { TryOnFlowProduct, VariantAttributes } from "@studio-vaai/js-machine";
import type { DefaultRootViewModel } from "@studio-vaai/react-headless";

import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  deriveError,
  isReasonResolved,
  type DeriveErrorInputs,
} from "../src/error/derive-error.js";
import { studioVaaiUiMessagesForLocale } from "../src/i18n/messages.js";
import { testProduct } from "./helpers.js";

function plainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "number" || typeof node === "bigint") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((n) => plainText(n as ReactNode)).join("");
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return plainText(props.children);
  }
  return "";
}

const ui = studioVaaiUiMessagesForLocale("en");

function vmWith(canStartTryOn: boolean): DefaultRootViewModel {
  return {
    phase: "product",
    productPhase: "active",
    variant: canStartTryOn ? "selected" : "selecting",
    recommendation: "hidden",
    tryOnPipeline: "idle",
    canStartTryOn,
  };
}

function inputs(over: Partial<DeriveErrorInputs>): DeriveErrorInputs {
  return {
    reason: undefined,
    consented: false,
    vm: vmWith(false),
    product: testProduct,
    selection: {},
    ui,
    machineError: undefined,
    ...over,
  };
}

describe("deriveError", () => {
  it("passes the machine error through as a failure when no reason is pending", () => {
    expect(deriveError(inputs({ machineError: "boom" }))).toEqual({
      message: "boom",
      kind: "failure",
    });
  });

  it("is undefined when there is nothing to say", () => {
    expect(deriveError(inputs({}))).toBeUndefined();
  });

  it("tags an interaction nudge as such, so it is not drawn like a failure", () => {
    // The nudge and the failure share one slot; only this tag separates a boxed
    // "upload failed" from a plain "pick a size first".
    expect(deriveError(inputs({ reason: "selectionRequired" }))?.kind).toBe("interaction");
  });

  it("shows the consent message while consent is missing, then yields once given", () => {
    expect(
      plainText(deriveError(inputs({ reason: "consentRequired", consented: false }))?.message),
    ).toBe("Please accept the consent to continue.");
    // Resolved → the stored reason is suppressed and the machine error (if any) shows.
    expect(
      deriveError(inputs({ reason: "consentRequired", consented: true, machineError: "m" })),
    ).toEqual({ message: "m", kind: "failure" });
  });

  it("lists every unpicked axis, shrinking as the user selects", () => {
    const both = deriveError(inputs({ reason: "selectionRequired", selection: {} }));
    expect(plainText(both?.message)).toBe("Please select a size and a color.");

    const sizeOnly = deriveError(
      inputs({
        reason: "selectionRequired",
        selection: { colorway: "black" } satisfies VariantAttributes,
      }),
    );
    expect(plainText(sizeOnly?.message)).toBe("Please select a size.");

    const colorOnly = deriveError(
      inputs({ reason: "selectionRequired", selection: { size: "m" } }),
    );
    expect(plainText(colorOnly?.message)).toBe("Please select a color.");
  });

  it("suppresses the selection error once a full variant is selected (canStartTryOn)", () => {
    const resolved = deriveError(
      inputs({ reason: "selectionRequired", vm: vmWith(true), machineError: "fallback" }),
    );
    expect(resolved).toEqual({ message: "fallback", kind: "failure" });
  });

  it("lets the interaction error win over a concurrent machine error", () => {
    const out = deriveError(
      inputs({ reason: "consentRequired", consented: false, machineError: "machine" }),
    );
    expect(plainText(out?.message)).toBe("Please accept the consent to continue.");
  });

  it("only counts axes the product actually exposes", () => {
    const colorlessProduct: TryOnFlowProduct = {
      ...testProduct,
      attributeMetadata: { ...testProduct.attributeMetadata, colorways: [] },
    };
    const out = deriveError(
      inputs({ reason: "selectionRequired", product: colorlessProduct, selection: {} }),
    );
    expect(plainText(out?.message)).toBe("Please select a size.");
  });
});

describe("isReasonResolved", () => {
  it("tracks the same precondition that drives the button's disabled state", () => {
    expect(isReasonResolved("consentRequired", inputs({ consented: false }))).toBe(false);
    expect(isReasonResolved("consentRequired", inputs({ consented: true }))).toBe(true);
    expect(isReasonResolved("selectionRequired", inputs({ vm: vmWith(false) }))).toBe(false);
    expect(isReasonResolved("selectionRequired", inputs({ vm: vmWith(true) }))).toBe(true);
  });
});
