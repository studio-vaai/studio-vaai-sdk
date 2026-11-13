// @vitest-environment jsdom

import { StudioVaaiProvider } from "@studio-vaai/react-headless";
import { act, render, screen } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { InteractionReason } from "../src/error/derive-error.js";
import type {
  PartialStudioVaaiUiMessagesSource,
  StudioVaaiUiLocale,
  StudioVaaiUiMessagesSource,
} from "../src/i18n/messages.js";
import type { StudioVaaiDefaultFlowHandle } from "../src/studio-vaai-default-flow.js";

import { SessionIntroScreen } from "../src/batteries/session-intro-screen.js";
import { ErrorProvider } from "../src/error/error-context.js";
import { studioVaaiUiMessagesSourceEn } from "../src/i18n/messages.js";
import { StudioVaaiDefaultFlow } from "../src/studio-vaai-default-flow.js";
import { StudioVaaiUiProvider, useStudioVaaiUi } from "../src/studio-vaai-ui-provider.js";
import { DefaultFlowSheetMount } from "../src/ui/default-flow-sheet-mount.js";
import { FitScorePanelDefault } from "../src/ui/fit-score-panel.js";
import { GuideGraphicDefault, prefersPortraitGuideArt } from "../src/ui/guide-graphic.js";
import { HeightCmPickerStepperDefault } from "../src/ui/height-cm-picker-stepper.js";
import { HeightCmPickerWheelDefault } from "../src/ui/height-cm-picker-wheel.js";
import { PoweredByDefault } from "../src/ui/powered-by.js";
import { createMockClient, testProduct } from "./helpers.js";

function renderSessionIntro(
  locale: StudioVaaiUiLocale,
  messages?: PartialStudioVaaiUiMessagesSource,
) {
  render(
    <StrictMode>
      <StudioVaaiUiProvider locale={locale} {...(messages === undefined ? {} : { messages })}>
        <DefaultFlowSheetMount open onOpenChange={vi.fn<(open: boolean) => void>()}>
          <ErrorProvider
            value={{
              error: undefined,
              setReason: vi.fn<(reason: InteractionReason) => void>(),
              clearReason: vi.fn<() => void>(),
            }}
          >
            <SessionIntroScreen
              hideConsent={false}
              productName={testProduct.displayName}
              sizeLabel={testProduct.attributeMetadata.sizes[0]?.label ?? ""}
              onClose={vi.fn<() => void>()}
              onConsent={vi.fn<() => void>()}
            />
          </ErrorProvider>
        </DefaultFlowSheetMount>
      </StudioVaaiUiProvider>
    </StrictMode>,
  );
}

describe("StudioVaaiUiProvider", () => {
  it("renders SessionIntroScreen in English when locale is en", () => {
    renderSessionIntro("en");
    expect(screen.getByRole("heading", { level: 2, name: /Ready to try it on\?/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("names the header's close button in German when locale is de", () => {
    renderSessionIntro("de");
    expect(screen.getByRole("button", { name: "Schließen" })).toBeTruthy();
  });
});

describe("StudioVaaiDefaultFlow locale", () => {
  it("uses English sheet title when locale is en", () => {
    const client = createMockClient();
    const ref = createRef<StudioVaaiDefaultFlowHandle>();
    render(
      <StrictMode>
        <StudioVaaiProvider
          client={client}
          input={{
            product: testProduct,
          }}
        >
          <StudioVaaiDefaultFlow ref={ref} locale="en" />
        </StudioVaaiProvider>
      </StrictMode>,
    );
    act(() => {
      ref.current?.open();
    });
    expect(screen.getByRole("heading", { level: 2, name: /Ready to try it on\?/i })).toBeTruthy();
  });
});

/** The artwork URL `GuideGraphic` resolves for a locale. */
function artworkFor(locale: StudioVaaiUiLocale): string | null | undefined {
  const { container } = render(
    <StudioVaaiUiProvider locale={locale}>
      <GuideGraphicDefault />
    </StudioVaaiUiProvider>,
  );
  return container.querySelector("img")?.getAttribute("src");
}

describe("GuideGraphic locale", () => {
  // The labels are baked into per-locale artwork, so locale selection means serving the
  // right file rather than rendering translated <text> nodes.
  it("serves the English artwork when locale is en", () => {
    expect(artworkFor("en")).toContain("guide-graphic-annotated-en");
  });

  it("serves the German artwork when locale is de", () => {
    expect(artworkFor("de")).toContain("guide-graphic-annotated-de");
  });

  it("serves the artwork of the tag's language", () => {
    expect(artworkFor("de-AT")).toContain("guide-graphic-annotated-de");
    expect(artworkFor("fr")).toContain("guide-graphic-annotated-en");
  });
});

describe("GuideGraphic frame", () => {
  // The modal's picture column on a tall desktop viewport (~480 x 670): the landscape frame is
  // width-bound there and left a band of white above the models.
  it("picks the portrait frame for a column much taller than it is wide", () => {
    expect(prefersPortraitGuideArt(480, 670)).toBe(true);
  });

  // The sheet's `aspect-[569/600]` wrapper, and a short desktop viewport whose column is near
  // square: the landscape frame is the larger there, so nothing changes.
  it("keeps the landscape frame where it already fills the box", () => {
    expect(prefersPortraitGuideArt(569, 600)).toBe(false);
    expect(prefersPortraitGuideArt(390, 411)).toBe(false);
    expect(prefersPortraitGuideArt(444, 451)).toBe(false);
  });

  it("serves the locale's portrait artwork when the box calls for it", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 480, height: 670 } as DOMRect);
    try {
      expect(artworkFor("en")).toContain("guide-graphic-annotated-en-portrait");
      expect(artworkFor("de")).toContain("guide-graphic-annotated-de-portrait");
    } finally {
      rect.mockRestore();
    }
  });
});

/** A complete host catalog for a language the SDK does not ship. */
const FRENCH: StudioVaaiUiMessagesSource = {
  ...studioVaaiUiMessagesSourceEn,
  sessionIntro: { ...studioVaaiUiMessagesSourceEn.sessionIntro, sheetTitle: "Prêt à l'essayer ?" },
  productOverview: {
    ...studioVaaiUiMessagesSourceEn.productOverview,
    selectionRequired: "Veuillez choisir {$missing :list}.",
  },
  surface: { backSr: "Retour", closeSr: "Fermer" },
};

const FRENCH_AXES = ["taille", "couleur"];

function MissingAxes({ missing }: { missing: string[] }) {
  const { messages } = useStudioVaaiUi();
  return <p>{messages.productOverview.selectionRequired(missing)}</p>;
}

describe("host catalogs", () => {
  it("renders a full host catalog for fr, formatted as French", () => {
    render(
      <StudioVaaiUiProvider locale="fr" messages={FRENCH}>
        <MissingAxes missing={FRENCH_AXES} />
      </StudioVaaiUiProvider>,
    );
    expect(screen.getByText("Veuillez choisir taille et couleur.")).toBeTruthy();
  });

  it("fills keys a partial fr catalog leaves out from English", () => {
    renderSessionIntro("fr", { surface: { backSr: "Retour", closeSr: "Fermer" } });
    expect(screen.getByRole("button", { name: "Fermer" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /Ready to try it on\?/i })).toBeTruthy();
  });

  it("renders the full fr catalog through the default flow", () => {
    const ref = createRef<StudioVaaiDefaultFlowHandle>();
    render(
      <StudioVaaiProvider client={createMockClient()} input={{ product: testProduct }}>
        <StudioVaaiDefaultFlow ref={ref} locale="fr" messages={FRENCH} />
      </StudioVaaiProvider>,
    );
    act(() => {
      ref.current?.open();
    });
    expect(screen.getByRole("heading", { level: 2, name: "Prêt à l'essayer ?" })).toBeTruthy();
  });

  it("renders German for de-AT", () => {
    renderSessionIntro("de-AT");
    expect(screen.getByRole("button", { name: "Schließen" })).toBeTruthy();
  });
});

function renderIn(
  locale: StudioVaaiUiLocale,
  node: React.ReactNode,
  messages?: PartialStudioVaaiUiMessagesSource,
) {
  return render(
    <StudioVaaiUiProvider locale={locale} {...(messages === undefined ? {} : { messages })}>
      {node}
    </StudioVaaiUiProvider>,
  );
}

/** A host's (here empty) catalog for a language the SDK does not ship turns on its formatting. */
const HOST_CATALOG: PartialStudioVaaiUiMessagesSource = {};

describe("localized primitives", () => {
  it("names the height stepper's controls in the locale and shows its unit", () => {
    const { container } = renderIn(
      "de",
      <HeightCmPickerStepperDefault valueCm={175} onChange={vi.fn<(cm: number) => void>()} />,
    );
    expect(screen.getByRole("spinbutton", { name: "Körpergröße in cm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Körpergröße erhöhen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Körpergröße verringern" })).toBeTruthy();
    expect(container.textContent).toContain("cm");
  });

  it("names the height stepper's controls in English", () => {
    renderIn(
      "en",
      <HeightCmPickerStepperDefault valueCm={175} onChange={vi.fn<(cm: number) => void>()} />,
    );
    expect(screen.getByRole("spinbutton", { name: "Height in cm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Increase height" })).toBeTruthy();
  });

  it("formats the height wheel's rows for the locale", () => {
    renderIn(
      "ar",
      <HeightCmPickerWheelDefault valueCm={175} onChange={vi.fn<(cm: number) => void>()} />,
      HOST_CATALOG,
    );
    expect(
      screen.getByText(
        new Intl.NumberFormat("ar", { style: "unit", unit: "centimeter" }).format(175),
      ),
    ).toBeTruthy();
  });

  it("translates the attribution's lead-in but keeps the brand name", () => {
    const { container } = renderIn("de", <PoweredByDefault />);
    const lockup = container.querySelector('[data-studio-vaai="powered-by"]');
    expect(lockup?.getAttribute("aria-label")).toBe("bereitgestellt von studio vaai");
    expect(lockup?.textContent).toBe("bereitgestellt von");
  });

  for (const [locale, expected] of [
    ["de", "85 %"],
    ["en", "85%"],
  ] as const) {
    it(`formats the fit score as a ${locale} percentage`, () => {
      renderIn(
        locale,
        <FitScorePanelDefault
          label="Fit Score"
          pct={85}
          open={false}
          onOpenChange={vi.fn<(open: boolean) => void>()}
          toggleSrLabel="Fit Score"
        />,
      );
      // The default text matcher folds the no-break space German uses into a plain one.
      expect(screen.getByText(expected)).toBeTruthy();
    });
  }
});
