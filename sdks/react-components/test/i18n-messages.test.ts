import { asBodyValidationCode } from "@studio-vaai/js-client";
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  bodyFailureMessage,
  compileStudioVaaiUiMessages,
  mergeStudioVaaiUiMessagesSource,
  studioVaaiUiMessagesSourceDe,
  studioVaaiUiMessagesSourceEn,
  studioVaaiUiMessagesForLocale,
} from "../src/i18n/messages.js";
import { centimeterAffixes, formatCentimeters, formatPercent } from "../src/i18n/number-format.js";

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

describe("mergeStudioVaaiUiMessagesSource", () => {
  it("merges nested sessionIntro keys without dropping siblings", () => {
    const merged = mergeStudioVaaiUiMessagesSource(studioVaaiUiMessagesSourceDe, {
      sessionIntro: { sheetTitle: "Custom title" },
    });
    expect(merged.sessionIntro.sheetTitle).toBe("Custom title");
    expect(merged.sessionIntro.primaryCtaPhoto).toBe(
      studioVaaiUiMessagesSourceDe.sessionIntro.primaryCtaPhoto,
    );
  });

  it("preserves MF2 sources when not overridden", () => {
    const merged = mergeStudioVaaiUiMessagesSource(studioVaaiUiMessagesSourceEn, {
      productOverview: { useAnotherImage: "override" },
    });
    const ui = compileStudioVaaiUiMessages("en", merged);
    expect(plainText(ui.productOverview.useAnotherImage)).toBe("override");
    expect(plainText(ui.productOverview.tryOnCta("S", "Red"))).toContain("S");
    expect(plainText(ui.productOverview.tryOnCta("M"))).toContain("M");
  });
});

describe("bodyFailureMessage", () => {
  const VALIDATION_CODES = [
    "no_human_detected",
    "human_occluded",
    "human_not_standing",
    "human_too_small",
    "inappropriate_clothing",
  ] as const;

  for (const locale of ["de", "en"] as const) {
    it(`returns a non-empty localized message for every validation code (${locale})`, () => {
      const ui = studioVaaiUiMessagesForLocale(locale);
      for (const code of VALIDATION_CODES) {
        const text = plainText(bodyFailureMessage(ui, asBodyValidationCode(code)));
        expect(text.length, `code=${code}`).toBeGreaterThan(0);
      }
    });
  }
});

describe("studioVaaiUiMessagesForLocale", () => {
  it("returns English preset for en", () => {
    expect(plainText(studioVaaiUiMessagesForLocale("en").sessionIntro.sheetTitle)).toBe(
      "Ready to try it on?",
    );
  });

  it("returns German preset for de", () => {
    expect(plainText(studioVaaiUiMessagesForLocale("de").sessionIntro.sheetTitle)).toBe(
      "Bereit zur Anprobe?",
    );
  });

  it("distinguishes German garment too-large copy from too-small copy", () => {
    // The two must not collapse into one string: the direction of the misfit is the whole
    // point of the note, and it is the only thing that differs between them.
    const ui = studioVaaiUiMessagesForLocale("de");
    expect(plainText(ui.productOverview.garmentTooSmallNote("3XL", "L"))).toContain("zu klein");
    expect(plainText(ui.productOverview.garmentTooLargeNote("3XL", "L"))).toContain("zu groß");
  });
});

describe("locale tags", () => {
  // The SDK picks its catalog by the tag's language, so a regional tag needs no catalog of
  // its own.
  it("serves the German catalog for de-AT and de-CH", () => {
    for (const tag of ["de-AT", "de-CH", "de_AT"]) {
      const ui = studioVaaiUiMessagesForLocale(tag);
      expect(plainText(ui.sessionIntro.sheetTitle), `tag=${tag}`).toBe("Bereit zur Anprobe?");
    }
  });

  it("serves the English catalog for a language the SDK does not ship", () => {
    const ui = studioVaaiUiMessagesForLocale("fr");
    expect(plainText(ui.sessionIntro.sheetTitle)).toBe("Ready to try it on?");
    // The text is English, so its lists must not take French conjunctions.
    expect(plainText(ui.productOverview.selectionRequired(["size", "color"]))).toBe(
      "Please select size and color.",
    );
  });

  it("falls back to English for a tag that is not BCP 47", () => {
    const ui = studioVaaiUiMessagesForLocale("not a tag!");
    expect(ui.locale).toBe("en");
    expect(plainText(ui.sessionIntro.sheetTitle)).toBe("Ready to try it on?");
  });

  it("keeps the host's exact tag for formatting", () => {
    expect(studioVaaiUiMessagesForLocale("de-AT").locale).toBe("de-AT");
    expect(studioVaaiUiMessagesForLocale("en-GB").locale).toBe("en-GB");
  });

  it("formats numbers with the exact tag, not only its language", () => {
    const n = 1234.5;
    for (const tag of ["de", "de-AT", "de-CH", "en-US"]) {
      const text = studioVaaiUiMessagesForLocale(tag).photoCapture.countdownSr(n);
      expect(text, `tag=${tag}`).toContain(new Intl.NumberFormat(tag).format(n));
    }
    // The regional variants really do differ, so the assertions above are not vacuous.
    expect(new Intl.NumberFormat("de-CH").format(n)).not.toBe(
      new Intl.NumberFormat("de").format(n),
    );
  });

  it("formats lists with the exact tag", () => {
    const missing = ["size", "color", "length"];
    const us = studioVaaiUiMessagesForLocale("en-US").productOverview.selectionRequired(missing);
    const gb = studioVaaiUiMessagesForLocale("en-GB").productOverview.selectionRequired(missing);
    expect(plainText(us)).toBe(
      `Please select ${new Intl.ListFormat("en-US", { type: "conjunction" }).format(missing)}.`,
    );
    expect(plainText(gb)).toBe(
      `Please select ${new Intl.ListFormat("en-GB", { type: "conjunction" }).format(missing)}.`,
    );
  });
});

describe("height picker and attribution copy", () => {
  it("ships the height picker and attribution labels in German", () => {
    const ui = studioVaaiUiMessagesForLocale("de");
    expect(ui.heightCalibration.heightInputSr).toBe("Körpergröße in cm");
    expect(ui.heightCalibration.increaseHeightSr).toBe("Körpergröße erhöhen");
    expect(ui.heightCalibration.decreaseHeightSr).toBe("Körpergröße verringern");
    expect(ui.surface.poweredBy).toBe("bereitgestellt von");
    expect(ui.surface.poweredBySr).toBe("bereitgestellt von studio vaai");
  });

  it("ships the height picker and attribution labels in English", () => {
    const ui = studioVaaiUiMessagesForLocale("en");
    expect(ui.heightCalibration.heightInputSr).toBe("Height in cm");
    expect(ui.heightCalibration.increaseHeightSr).toBe("Increase height");
    expect(ui.heightCalibration.decreaseHeightSr).toBe("Decrease height");
    expect(ui.surface.poweredBy).toBe("powered by");
    expect(ui.surface.poweredBySr).toBe("powered by studio vaai");
  });
});

/** Intl separates number and unit with no-break spaces in some locales; compare them as spaces. */
function spaced(text: string): string {
  return text.replaceAll(/\s/gu, " ");
}

describe("unit and percent formatting", () => {
  it("formats percentages for the locale", () => {
    expect(formatPercent("en", 85)).toBe("85%");
    expect(spaced(formatPercent("de", 85))).toBe("85 %");
    expect(formatPercent("de-CH", 85)).toBe(
      new Intl.NumberFormat("de-CH", { style: "percent" }).format(0.85),
    );
  });

  it("formats whole centimetres for the locale", () => {
    expect(spaced(formatCentimeters("en", 171.4))).toBe("171 cm");
    expect(spaced(formatCentimeters("de", 171.6))).toBe("172 cm");
    expect(formatCentimeters("ar", 171)).toContain("سم");
  });

  it("splits the unit text from the number for a control that draws the number itself", () => {
    expect(centimeterAffixes("en", 175)).toEqual({ prefix: "", suffix: "cm" });
    expect(centimeterAffixes("he", 175).suffix).toBe("ס״מ");
  });
});
