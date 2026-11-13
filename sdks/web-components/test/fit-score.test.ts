// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createUiContext, defineSvElements } from "../src/index.js";
import { fitScoreGradient, fitScoreTint } from "../src/internal/fit-ramp.js";
import { measureRestingPanel } from "../src/internal/panel-layout.js";
import { contrast, svAppearanceDefaults } from "../src/internal/theme/index.js";

async function mount<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]>,
): Promise<HTMLElementTagNameMap[K]> {
  const el = document.createElement(tag);
  Object.assign(el, props);
  document.body.append(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

function part(el: Element, selector: string): HTMLElement {
  const found = el.shadowRoot?.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`${selector} not rendered`);
  }
  return found;
}

describe("fit score ramp", () => {
  it("lands on today's amber at 50 and clamps outside 0–100", () => {
    expect(fitScoreTint(50)).toBe("rgb(239 216 115)");
    expect(fitScoreTint(-20)).toBe(fitScoreTint(0));
    expect(fitScoreTint(140)).toBe(fitScoreTint(100));
    expect(fitScoreTint(0)).not.toBe(fitScoreTint(100));
  });

  it("fades the tint in from translucent white", () => {
    expect(fitScoreGradient(92)).toBe(
      `linear-gradient(90deg, rgb(255 255 255 / 0.72) 0%, ${fitScoreTint(92)} 100%)`,
    );
  });

  it("keeps dark score tints readable throughout the hue ramp", () => {
    const { seeds } = svAppearanceDefaults("dark");
    for (let score = 0; score <= 100; score += 1) {
      const channels = fitScoreTint(score, "dark").match(/\d+/gu) ?? [];
      expect(channels).toHaveLength(3);
      const hex = `#${channels.map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}`;
      expect(contrast(seeds.foreground, hex)).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("fit score elements", () => {
  beforeAll(() => {
    defineSvElements();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("shows the label and the rounded, clamped score", async () => {
    const el = await mount("sv-fit-score", { label: "Fit Score for S", score: 91.6 });
    expect(part(el, ".label").textContent).toBe("Fit Score for S");
    expect(part(el, ".score").textContent?.trim()).toBe("92%");
  });

  it("updates the score surface when its shared appearance changes", async () => {
    const el = await mount("sv-fit-score", { label: "Fit Score", score: 87 });
    const lightGradient = part(el, ".bar").style.backgroundImage;
    const context = createUiContext({ appearance: "dark" });
    const detach = context.attach(el);
    await el.updateComplete;
    expect(part(el, ".bar").style.backgroundImage).toContain(fitScoreTint(87, "dark"));
    context.configure({ appearance: "light" });
    await el.updateComplete;
    expect(part(el, ".bar").style.backgroundImage).toBe(lightGradient);
    detach();
  });

  it("asks to open when it has a description, and waits for the owner", async () => {
    const el = await mount("sv-fit-score", {
      label: "Fit Score for S",
      score: 92,
      description: "Intended fit: relaxed cut.",
    });
    const asked: boolean[] = [];
    el.addEventListener("sv-toggle", (event) => {
      asked.push(event.detail.open);
    });
    const bar = part(el, ".bar");
    expect(bar.getAttribute("aria-expanded")).toBe("false");
    bar.click();
    expect(asked).toEqual([true]);
    expect(el.open).toBe(false);
  });

  it("can't open without a description", async () => {
    const el = await mount("sv-fit-score", { label: "Fit Score", score: 54 });
    expect(part(el, ".bar").hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot?.querySelector(".chevron")).toBeNull();
  });

  it("holds the place with a retry when the score failed", async () => {
    const el = await mount("sv-fit-score", {
      failed: true,
      label: "Fit score unavailable",
      retryLabel: "Try again",
    });
    const retried = vi.fn<() => void>();
    el.addEventListener("sv-retry", retried);
    expect(part(el, "[role=status]")).not.toBeNull();
    const retry = part(el, ".retry");
    expect(retry.getAttribute("aria-label")).toBe("Try again");
    retry.click();
    expect(retried).toHaveBeenCalledOnce();
    el.busy = true;
    await el.updateComplete;
    expect(part(el, ".retry").hasAttribute("disabled")).toBe(true);
  });

  it("shows a noninteractive loading bar without a stale score, retry, or details", async () => {
    const el = await mount("sv-fit-score", {
      loading: true,
      failed: true,
      label: "Loading fit information",
      score: 92,
      description: "Previous result's description",
      open: true,
    });
    const toggled = vi.fn<() => void>();
    const retried = vi.fn<() => void>();
    el.addEventListener("sv-toggle", toggled);
    el.addEventListener("sv-retry", retried);
    const bar = part(el, ".bar");
    expect(bar.tagName).toBe("DIV");
    expect(part(el, "[role=status]")).not.toBeNull();
    expect(bar.hasAttribute("aria-busy")).toBe(false);
    expect(part(el, ".label").textContent).toBe("Loading fit information");
    expect(el.shadowRoot?.querySelector("sv-spinner")?.size).toBe("sm");
    expect(el.shadowRoot?.querySelector("button, .score, .retry, .detail, .chevron")).toBeNull();
    expect(el.shadowRoot?.textContent).not.toContain("Previous result's description");
    bar.click();
    expect(toggled).not.toHaveBeenCalled();
    expect(retried).not.toHaveBeenCalled();
  });

  it("keeps the same resting geometry through ready, loading, and failure", async () => {
    const el = await mount("sv-fit-score", {
      label: "Fit score",
      score: 87,
      description: "Intended fit",
    });
    const size = () => {
      const bar = part(el, ".bar");
      const label = part(el, ".label");
      bar.style.paddingBlockStart = "10px";
      bar.style.paddingBlockEnd = "10px";
      label.style.height = "17.5px";
      label.style.boxSizing = "border-box";
      return measureRestingPanel([el]).blockSize;
    };
    expect(size()).toBe(37.5);
    el.loading = true;
    await el.updateComplete;
    expect(size()).toBe(37.5);
    el.loading = false;
    el.failed = true;
    await el.updateComplete;
    expect(size()).toBe(37.5);
  });

  it("draws a callout with its label, description and variant", async () => {
    const el = await mount("sv-fit-callout", {
      label: "Sleeve length",
      description: "runs long",
      variant: "caution",
    });
    expect(part(el, ".label").textContent).toBe("Sleeve length");
    expect(part(el, ".verdict").textContent).toBe("runs long");
    expect(el.getAttribute("variant")).toBe("caution");
  });
});
