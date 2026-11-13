import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { API_VERSION } from "../src/index.js";

// The date the contract names (`@OpenAPI.info` in sdks/api/public/core.tsp), from the OpenAPI
// document generated from it. The generated Rust client takes its date from the same contract.
const contract = readFileSync(new URL("../../api/generated/openapi.yaml", import.meta.url), "utf8");
const contractVersion = /^info:\n(?:[ ]{2}.*\n)*?[ ]{2}version: '?([^'\n]+)'?$/m.exec(
  contract,
)?.[1];

describe("API_VERSION", () => {
  it("is the contract's date, so a new contract date can't leave the client on the old one", () => {
    expect(contractVersion).toBeDefined();
    expect(API_VERSION).toBe(contractVersion);
  });

  it("is a YYYY-MM-DD date", () => {
    expect(API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${API_VERSION}T00:00:00Z`).toISOString().startsWith(API_VERSION)).toBe(true);
  });
});
