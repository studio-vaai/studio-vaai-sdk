import type { SvFact } from "../../components/fact-list/sv-fact-list.js";
import type { SvUiContext } from "../../ui/index.js";

/** Screen-local composition of shared MF2 message IDs; no translated literals live here. */
export function sessionIntroMessages(ui: SvUiContext) {
  return {
    title: ui.text("sessionIntro.sheetTitle"),
    subtitle: ui.text("sessionIntro.sheetSubtitle"),
    steps: ["uploadPhoto", "enterHeight", "trySizes"].map((key) =>
      ui.text(`sessionIntro.steps.${key}`),
    ),
    photoFactsTitle: ui.text("sessionIntro.photoFactsTitle"),
    photoFacts: [
      { icon: "image", text: ui.text("sessionIntro.photoFacts.onlyForTryOn") },
      { icon: "eye", text: ui.text("sessionIntro.photoFacts.nobodyElseSees") },
      { icon: "trash", text: ui.text("sessionIntro.photoFacts.deletedAfter") },
    ] satisfies SvFact[],
    consent: ui.text("sessionIntro.consentLegal"),
    withdrawalLabel: ui.text("sessionIntro.withdrawalDisclosureLabel"),
    withdrawalBody: ui.format("sessionIntro.withdrawalDisclosureBody"),
    legal: ui.format("sessionIntro.legalFooter"),
    uploadLabel: ui.text("sessionIntro.primaryCtaPhoto"),
    cameraLabel: ui.text("sessionIntro.secondaryCtaCamera"),
    busyLabel: ui.text("sessionIntro.busyUploadSr"),
  };
}
export type SvSessionIntroMessages = ReturnType<typeof sessionIntroMessages>;
