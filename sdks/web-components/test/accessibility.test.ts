// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { defineSvElements, ui } from "../src/index.js";
import { initializeTestUi } from "./ui-fixture.js";

describe("shared accessibility contracts", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });
  afterEach(() => {
    document.body.replaceChildren();
    ui.configure({ locale: "en" });
    vi.restoreAllMocks();
  });

  it("updates the global language without overwriting a caller's explicit language", async () => {
    const automatic = document.createElement("sv-chip");
    const explicit = document.createElement("sv-chip");
    explicit.lang = "fr";
    document.body.append(automatic, explicit);
    await Promise.all([automatic.updateComplete, explicit.updateComplete]);
    ui.configure({ locale: "de" });
    await automatic.updateComplete;
    expect(automatic.lang).toBe("de");
    expect(explicit.lang).toBe("fr");
    automatic.lang = "it";
    ui.configure({ locale: "en" });
    await automatic.updateComplete;
    expect(automatic.lang).toBe("it");
  });

  it.each(["sv-checkbox", "sv-height-input"] as const)(
    "associates %s errors inside the native control shadow root",
    async (tag) => {
      const field = document.createElement(tag);
      field.validationError = "Please check this value";
      field.description = "Instructions for this field";
      document.body.append(field);
      await field.updateComplete;
      const native = field.shadowRoot!.querySelector("[aria-invalid]")!;
      expect(native.getAttribute("aria-invalid")).toBe("true");
      for (const id of native.getAttribute("aria-describedby")!.split(" ")) {
        expect(field.shadowRoot!.querySelector(`#${id}`)?.textContent).toMatch(
          /Instructions|Please check/,
        );
      }
      field.validationError = undefined;
      await field.updateComplete;
      expect(native.hasAttribute("aria-invalid")).toBe(false);
    },
  );

  it("explains an automatically corrected height and clears the explanation on editing", async () => {
    const field = document.createElement("sv-height-input");
    field.value = 170;
    document.body.append(field);
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = "230";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await field.updateComplete;
    expect(field.shadowRoot!.querySelector("#field-correction")?.textContent).toContain("220 cm");
    expect(input.getAttribute("aria-describedby")).toContain("field-correction");
    input.value = "180";
    input.dispatchEvent(new Event("input"));
    await field.updateComplete;
    expect(field.shadowRoot!.querySelector("#field-correction")?.textContent).toBe("");
  });

  it("describes chip statuses and lets caller-localized copy take precedence", async () => {
    const chip = document.createElement("sv-chip");
    chip.status = "recommended";
    document.body.append(chip);
    await chip.updateComplete;
    expect(chip.shadowRoot!.querySelector("#description")?.textContent).toBe("Recommended");
    ui.configure({ locale: "de" });
    await chip.updateComplete;
    expect(chip.shadowRoot!.querySelector("#description")?.textContent).toBe("Empfohlen");
    chip.description = "Recommended for a relaxed fit";
    await chip.updateComplete;
    expect(chip.shadowRoot!.querySelector("#description")?.textContent).toBe(chip.description);
  });

  it.each([
    "sv-height-setting-screen",
    "sv-photo-upload-rejected-screen",
    "sv-try-on-view-screen",
  ] as const)("names the review photo in %s", async (tag) => {
    const screen = document.createElement(tag);
    screen.photoSrc = "/uploaded-photo.webp";
    document.body.append(screen);
    await screen.updateComplete;
    const image = screen.shadowRoot!.querySelector("sv-image")!;
    await image.updateComplete;
    expect(
      image.shadowRoot!.querySelector("img")?.getAttribute("alt")?.length ?? 0,
    ).toBeGreaterThan(0);
  });

  it("keeps a live region mounted and unsuppressed across loading and completion", async () => {
    const score = document.createElement("sv-fit-score");
    document.body.append(score);
    await score.updateComplete;
    const region = score.shadowRoot!.querySelector('[role="status"]')!;
    score.loading = true;
    score.label = "Loading fit score";
    await vi.waitFor(() => {
      expect(region.textContent?.trim()).toBe("Loading fit score");
    });
    expect(region.closest('[aria-busy="true"]')).toBeNull();
    score.loading = false;
    score.label = "Fit Score";
    score.score = 87;
    score.expandable = true;
    await vi.waitFor(() => {
      expect(region.textContent?.trim()).toBe("Fit Score 87%");
    });
    expect(score.shadowRoot!.querySelector('[role="status"]')).toBe(region);
    expect(score.shadowRoot!.querySelector("button")?.disabled).toBe(false);
  });

  it("announces progress from the same screen region while navigation is busy", async () => {
    const screen = document.createElement("sv-screen");
    screen.busy = true;
    screen.statusMessage = "Uploading photo";
    document.body.append(screen);
    await screen.updateComplete;
    const region = screen.shadowRoot!.querySelector('[role="status"]')!;
    expect(region.textContent).toBe("");
    await vi.waitFor(() => {
      expect(region.textContent).toBe("Uploading photo");
    });
    expect(region.closest('[aria-busy="true"]')).toBeNull();
    screen.busy = false;
    screen.statusMessage = "";
    await vi.waitFor(() => {
      expect(region.textContent).toBe("");
    });
    expect(screen.shadowRoot!.querySelector('[role="status"]')).toBe(region);
  });
});
