"use client";

import { useId, useMemo, useState } from "react";

import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { legalTextClassName } from "../typography/text.js";
import { ActionsSection } from "../ui/actions-section.js";
import { Button, flowPrimaryCtaClassName, flowSecondaryCtaClassName } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { cn } from "../ui/cn.js";
import { Disclosure } from "../ui/disclosure.js";
import { ErrorMessage } from "../ui/error-message.js";
import { FactList } from "../ui/fact-list.js";
import { GuideGraphic } from "../ui/guide-graphic.js";
import { IconChevronDown, IconEye, IconImage, IconTrash } from "../ui/icons.js";
import { NumberedSteps } from "../ui/numbered-steps.js";
import { PoweredBy } from "../ui/powered-by.js";
import { flowMediaColumnClassName, ResponsiveSplit } from "../ui/responsive-split.js";
import { SheetShell } from "../ui/sheet.js";
import { VStack } from "../ui/v-stack.js";

interface SessionIntroScreenProps {
  /**
   * Primary CTA — "Foto hochladen". Opens the system file picker for an existing
   * photo. Hosts wire this to dispatch `INITIATE_IMAGE_UPLOAD` (tracking) and
   * `IMAGE_SELECTED` once a file is chosen.
   */
  onConsent: () => void;
  /**
   * Secondary CTA — "mit Selbstauslöser aufnehmen". Opens the in-browser camera
   * flow (root state `photoCapture`). Optional: when omitted the secondary button
   * is hidden (e.g. for hosts that don't yet support the camera path).
   */
  onTakePhoto?: () => void;
  /**
   * Header back control. The intro is the flow's first step, so there is no earlier screen to
   * return to — hosts wire this to the same dismissal as {@link onClose}. It exists because the
   * design puts a chevron on every step: without it the title sits off-centre here and centred
   * everywhere else, and the header visibly jumps as the shopper moves through the flow.
   * Omit to hide the control.
   */
  onBack?: () => void;
  onClose: () => void;
  /**
   * When true, async work locks the sheet (create-body upload, product try-on request, etc.): consent
   * locked where shown, primary CTA disabled + spinner, header chrome disabled.
   */
  busy?: boolean;
  /**
   * Hide the consent checkbox (e.g. user already agreed; returning via “another image”).
   * Primary CTA stays enabled when not `busy` (unless consent is required).
   */
  hideConsent: boolean;
  /** Whether the consent checkbox is ticked (lifted to the flow so the error layer can see it). */
  consented: boolean;
  /** Called when the user toggles the consent checkbox. */
  onConsentChange: (checked: boolean) => void;
  /**
   * Called when a CTA is clicked while consent is required but not yet given —
   * the button stays visually enabled (always-enabled pattern) and this surfaces
   * the "please accept consent" error instead of acting.
   */
  onConsentRequired: () => void;
}

export function SessionIntroScreen({
  onConsent,
  onTakePhoto,
  onBack,
  onClose,
  busy = false,
  hideConsent,
  consented,
  onConsentChange,
  onConsentRequired,
}: SessionIntroScreenProps) {
  const { messages, responsive } = useStudioVaaiUi();
  const m = messages.sessionIntro;
  const isModal = responsive.layout === "modal";
  const consentInputId = useId();
  const withdrawalBodyId = useId();
  const checkboxChecked = busy ? true : consented;
  // The withdrawal notice is collapsed by default: it is a legal detail the shopper can open,
  // not something to read before deciding. Local state — nothing else needs to know.
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [photoFactsOpen, setPhotoFactsOpen] = useState(false);
  // Precondition gate for the always-enabled CTAs: consent is required but not
  // yet ticked. `busy` is handled separately (it truly disables — see Button).
  const consentMissing = !hideConsent && !consented;
  const photoFactItems = useMemo(
    () => [
      { icon: IconImage, text: m.photoFacts.onlyForTryOn },
      { icon: IconEye, text: m.photoFacts.nobodyElseSees },
      { icon: IconTrash, text: m.photoFacts.deletedAfter },
    ],
    [m.photoFacts],
  );
  const stepItems = useMemo(
    () => [m.steps.uploadPhoto, m.steps.enterHeight, m.steps.trySizes],
    [m.steps],
  );
  const consent = hideConsent ? null : (
    <div className="sv:flex sv:min-w-0 sv:flex-col sv:gap-0">
      <label
        htmlFor={consentInputId}
        className={cn(
          "sv:flex sv:min-w-0 sv:gap-3",
          busy ? "sv:cursor-default" : "sv:cursor-pointer",
        )}
      >
        <Checkbox.Root
          id={consentInputId}
          checked={checkboxChecked}
          disabled={busy}
          onCheckedChange={(v) => {
            if (busy) {
              return;
            }
            onConsentChange(typeof v === "boolean" ? v : false);
          }}
        >
          <Checkbox.Indicator />
        </Checkbox.Root>
        <div className="sv:min-w-0 sv:flex-1">
          <p className={legalTextClassName}>{m.consentLegal}</p>
        </div>
      </label>
      {/* Sits under the consent sentence it qualifies, indented past the checkbox so it reads
          as part of that block rather than a new one. Outside the <label> — a button nested in
          a label would toggle the checkbox on every click. */}
      {/* `1rem` = the 16px checkbox, `--sv-space-3` = the label's gap — the link starts
          exactly where the consent text does. */}
      <div className="sv:-mt-1 sv:pl-[calc(var(--sv-space-3)+1rem)]">
        <button
          type="button"
          aria-expanded={withdrawalOpen}
          aria-controls={withdrawalBodyId}
          onClick={() => {
            setWithdrawalOpen((open) => !open);
          }}
          className="sv:inline-flex sv:cursor-pointer sv:appearance-none sv:items-center sv:gap-1 sv:border-0 sv:bg-transparent sv:p-0 sv:text-left sv:font-sans sv:text-[11px] sv:font-normal sv:leading-snug sv:text-[var(--sv-color-link)] sv:outline-none sv:hover:text-[var(--sv-color-link-hover)]"
        >
          {m.withdrawalDisclosureLabel}
          <IconChevronDown
            className={cn(
              "sv:size-2.5 sv:shrink-0 sv:transition-transform sv:duration-200",
              withdrawalOpen && "sv:-rotate-180",
            )}
          />
        </button>
        <div
          className={cn(
            "sv:grid sv:transition-[grid-template-rows] sv:duration-250 sv:ease-out",
            withdrawalOpen ? "sv:grid-rows-[1fr]" : "sv:grid-rows-[0fr]",
          )}
        >
          <div
            id={withdrawalBodyId}
            inert={!withdrawalOpen}
            className="sv:min-h-0 sv:overflow-hidden"
          >
            <p className={cn(legalTextClassName, "sv:pt-1")}>{m.withdrawalDisclosureBody}</p>
          </div>
        </div>
      </div>
    </div>
  );

  // Desktop swaps the intro paragraph for the three-step list plus the collapsible
  // photo-handling reassurances — the modal has the width for a structured column, and the
  // sheet does not.
  const photoFacts = (
    <Disclosure
      data-studio-vaai="session-intro-photo-facts"
      label={m.photoFactsTitle}
      open={photoFactsOpen}
      onOpenChange={setPhotoFactsOpen}
      // A pale blue panel: enough to mark the reassurance block as its own thing on an
      // otherwise white screen, light enough that the card keeps its normal dark type. No
      // token remapping — the defaults already read correctly on this background.
      className="sv:bg-[#EBEFF5]"
    >
      <div className="sv:px-3.5 sv:pb-3">
        <FactList items={photoFactItems} />
      </div>
    </Disclosure>
  );

  // Modal stacks its CTAs full-width at the foot of the right-hand column (as the design draws
  // them) rather than as a right-aligned pill row in the shell footer; the sheet keeps the
  // footer. `ActionsSection` already flips between those two arrangements, so the only override
  // needed is the button shape.
  const primaryCta = (
    <Button
      type="button"
      className={isModal ? flowPrimaryCtaClassName : undefined}
      disabled={consentMissing}
      busy={busy}
      busyLabel={m.busyUploadSr}
      onClick={onConsent}
      onClickDisabled={onConsentRequired}
    >
      {m.primaryCtaPhoto}
    </Button>
  );
  const secondaryCta =
    onTakePhoto === undefined ? undefined : (
      <Button
        type="button"
        variant="ghost"
        className={isModal ? flowSecondaryCtaClassName : undefined}
        disabled={consentMissing || busy}
        onClick={onTakePhoto}
        onClickDisabled={onConsentRequired}
      >
        {m.secondaryCtaCamera}
      </Button>
    );
  const actions = isModal ? (
    <VStack gap="sm" className="sv:min-w-0">
      <ErrorMessage />
      {primaryCta}
      {secondaryCta}
    </VStack>
  ) : (
    <ActionsSection
      primary={primaryCta}
      {...(secondaryCta === undefined ? {} : { secondary: secondaryCta })}
    />
  );

  return (
    <SheetShell
      title={m.sheetTitle}
      // The subtitle says what the flow will do; the brand attribution sits on the artwork
      // instead (see the sheet's `end` slot), which is where the reference puts it. It is not
      // the shell subfooter either — this screen passes no `subfooter`.
      subtitle={
        isModal ? (
          <PoweredBy className="sv:text-[var(--sv-color-foreground-secondary)]" />
        ) : (
          m.sheetSubtitle
        )
      }
      busy={busy}
      // Every step of the flow fills the sheet, so the panel never changes height between
      // steps — and the intro's privacy disclosure can expand without moving the sheet.
      fillHeight
      // Full-screen like every other step: the sheet's top edge must not change mid-flow.
      fillViewport
      // The shell's SCROLLABLE body is a plain block (`min-h-0 flex-1 overflow-y-auto`), so a
      // `flex-1` child inside it has nothing to grow against — the split sized to its content
      // and the sheet's leftover height simply sat below it as white space. Making the body a
      // flex column is what lets the split, and therefore the guide graphic, claim that height.
      classNames={{ body: "sv:flex sv:flex-col" }}
      {...(onBack === undefined ? {} : { onBack })}
      onClose={onClose}
      // Modal keeps everything in the two-column body — consent, legal and the CTAs all live in
      // the right-hand column — so it renders no footer bar at all.
      {...(isModal
        ? {}
        : {
            footer: (
              // The legal line CLINGS to the CTA (mb-2) with the consent block just above it —
              // any slack in the sheet belongs to the photo area, not to this cluster.
              <div className="sv:flex sv:flex-col">
                {/* The same "what happens to your photo" card the modal shows. It is the one
                    answer a shopper wants before handing over a photo of themselves, and
                    keeping it desktop-only hid it from most of them. */}
                <div className="sv:mb-2.5">{photoFacts}</div>
                {hideConsent ? null : (
                  <>
                    <div className="sv:mb-2.5">{consent}</div>
                    <p className={cn(legalTextClassName, "sv:mb-2")}>{m.legalFooter}</p>
                  </>
                )}
                <ErrorMessage />
                {actions}
              </div>
            ),
          })}
    >
      <ResponsiveSplit
        // Modal (row): guide graphic on the left, the steps + consent column on the right.
        // Bottom-sheet (column): copy on top, graphic below — text leads the eye, image grounds.
        start={
          // Fills the column and sits ON its foot (`object-bottom`), so the artwork's bottom
          // edge lands on the same line as the CTA stack opposite. Sized by `max-*` instead it
          // floated mid-column, leaving a band of white between the models' feet and that line
          // that no other step has.
          isModal ? (
            <GuideGraphic aria-hidden className="sv:h-full sv:w-full sv:object-bottom" />
          ) : null
        }
        end={
          isModal ? (
            // `justify-between` + `mt-auto` on the actions pins the CTAs to the bottom of the
            // column, so the dialog's fixed height reads as a deliberate frame instead of the
            // content floating in dead space. The steps stay anchored to the top.
            <div className="sv:flex sv:h-full sv:min-h-0 sv:min-w-0 sv:flex-col sv:gap-4 sv:overflow-y-auto">
              {/* `my-auto` on the CONTENT (not `mt-auto` on the CTA) is what reproduces the
                  reference's geometry: the cluster centres in the space above the CTA block,
                  which itself sits flush at the column's foot. Splitting the free space around
                  the CTA instead left a hole between content and buttons on the short variants
                  (consent hidden). */}
              <div className="sv:my-auto sv:flex sv:min-w-0 sv:flex-col sv:gap-4">
                <NumberedSteps steps={stepItems} />
                {photoFacts}
              </div>
              {/* Consent + legal ride WITH the CTA block (legal clinging via mb-2), so the
                  free space distributes above them — as the reference composes the column. */}
              <div>
                {hideConsent ? null : (
                  <>
                    <div className="sv:mb-2.5">{consent}</div>
                    <p className={cn(legalTextClassName, "sv:mb-2")}>{m.legalFooter}</p>
                  </>
                )}
                {actions}
              </div>
            </div>
          ) : (
            // Sheet: the graphic takes the whole body, so it grows into a tall phone instead of
            // sitting at its intrinsic size above a slab of white.
            //
            // The wrapper carries the artwork's OWN aspect ratio rather than filling the slot,
            // which is what lets the attribution sit at the models' feet the way the reference
            // draws it. With a full-bleed wrapper the `object-contain` artwork letterboxes
            // inside it, and a `bottom-0 right-0` attribution lands in that empty band instead —
            // drifting further from the feet the more the viewport's aspect differs from the
            // art's. Driven from WIDTH, the binding constraint on a phone, with `max-h-full` as
            // the guard on a short viewport. Driving it from height instead computes a width
            // wider than the column — `max-w-full` cannot claw that back once `h-full` has fixed
            // the height — and the artwork spilled out of the sheet, clipping the arrow.
            <div className="sv:relative sv:mx-auto sv:my-auto sv:aspect-[569/600] sv:max-h-full sv:w-full">
              {/* `object-bottom`: when the viewport is too SHORT for the art's aspect the box
                  squashes and the `object-contain` art letterboxes inside it. Anchoring to the
                  bottom keeps the models' feet on the box's bottom edge, so the attribution
                  below-right of them still reads as sitting at their feet rather than floating
                  in a band of empty space. */}
              <GuideGraphic aria-hidden className="sv:h-full sv:w-full sv:object-bottom" />
              {/* Stacked and right-aligned: it tucks into the narrow gap beside the feet without
                  widening the art's footprint, which a single line does. */}
              <PoweredBy className="sv:absolute sv:right-0 sv:bottom-0 sv:flex-col sv:items-end sv:gap-0.5 sv:text-[var(--sv-color-foreground-secondary)]" />
            </div>
          )
        }
        {...(isModal
          ? { startClassName: flowMediaColumnClassName, endClassName: "sv:min-h-0" }
          : // `flex-1 min-h-0` is what actually hands the leftover height to the graphic column;
            // without it the split's spare space piles up unused at the bottom of the body.
            { startClassName: "sv:shrink-0", endClassName: "sv:min-h-0 sv:flex-1" })}
      />
    </SheetShell>
  );
}
