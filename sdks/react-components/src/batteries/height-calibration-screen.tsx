"use client";

import type { FrameLock } from "@studio-vaai/js-machine";

import { useEffect, useId, useState } from "react";

import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { Text } from "../typography/text.js";
import { ActionsSection } from "../ui/actions-section.js";
import { Button, flowPrimaryCtaClassName, flowSecondaryCtaClassName } from "../ui/button.js";
import { cn } from "../ui/cn.js";
import { ErrorMessage } from "../ui/error-message.js";
import { HeightCmPicker } from "../ui/height-cm-picker.js";
import { flowMediaColumnClassName, ResponsiveSplit } from "../ui/responsive-split.js";
import { SheetShell } from "../ui/sheet.js";
import { VStack } from "../ui/v-stack.js";
import {
  NaturalAspectPreviewFrame,
  useNaturalAspectPreviewFrame,
} from "./natural-aspect-preview-frame.js";

interface HeightCalibrationScreenProps {
  heightCm: number;
  onHeightChange: (heightCm: number) => void;
  onConfirm: () => void;
  onUseAnotherImage: () => void;
  /** Captured full-body photo (object URL or https URL). */
  previewSrc: string;
  /**
   * Sub-rect of `previewSrc` to display — set for camera captures (the bbox
   * the user composed within at shutter time). Absent for file-picked uploads,
   * in which case the image renders at its full natural aspect.
   */
  frameLock?: FrameLock;
  onBack: () => void;
  onClose: () => void;
  /** When true, height save is in flight (header/footer locked, primary shows spinner). */
  busy?: boolean;
}

export function HeightCalibrationScreen({
  heightCm,
  onHeightChange,
  onConfirm,
  onUseAnotherImage,
  previewSrc,
  frameLock,
  onBack,
  onClose,
  busy = false,
}: HeightCalibrationScreenProps) {
  const { messages, responsive } = useStudioVaaiUi();
  const m = messages.heightCalibration;
  const isModal = responsive.layout === "modal";
  const labelId = useId();
  const [valueCm, setValueCm] = useState(heightCm);
  const previewFrame = useNaturalAspectPreviewFrame(previewSrc, frameLock);

  useEffect(() => {
    setValueCm(heightCm);
  }, [heightCm]);

  useEffect(() => {
    onHeightChange(valueCm);
  }, [onHeightChange, valueCm]);

  // Built once, placed by layout: the modal stacks these full-width at the foot of the column
  // beside the photo, the sheet puts them in the shell footer.
  const primaryCta = (
    <Button
      type="button"
      className={isModal ? flowPrimaryCtaClassName : undefined}
      busy={busy}
      busyLabel={m.busyCalibrateSr}
      onClick={onConfirm}
    >
      {m.confirm}
    </Button>
  );
  const secondaryCta = (
    <Button
      type="button"
      variant="ghost"
      className={isModal ? flowSecondaryCtaClassName : undefined}
      disabled={busy}
      onClick={onUseAnotherImage}
    >
      {m.useOtherImage}
    </Button>
  );
  const actions = isModal ? (
    <VStack gap="sm" className="sv:min-w-0">
      <ErrorMessage />
      {primaryCta}
      {secondaryCta}
    </VStack>
  ) : (
    <VStack gap="sm">
      <ErrorMessage />
      <ActionsSection primary={primaryCta} secondary={secondaryCta} />
    </VStack>
  );

  return (
    <SheetShell
      title={m.title}
      subtitle={m.subtitle}
      busy={busy}
      fillHeight
      fillViewport
      // Same reason as the intro: the scrollable body is a plain block, so the split needs it
      // turned into a flex column before it can claim the sheet's leftover height.
      classNames={{ body: "sv:flex sv:flex-col" }}
      onBack={onBack}
      onClose={onClose}
      // Modal keeps its actions in the right-hand column beside the photo; only the sheet
      // uses the shell footer.
      {...(isModal ? {} : { footer: actions })}
    >
      <ResponsiveSplit
        start={
          <NaturalAspectPreviewFrame
            {...previewFrame}
            previewSrc={previewSrc}
            alt=""
            data-studio-vaai="height-calibration-preview"
            {...(frameLock === undefined ? {} : { frameLock })}
          />
        }
        end={
          // `my-auto` floats the picker in the free space, `mt-auto` pins the actions to the
          // bottom, so the column stays composed at whatever height the dialog holds.
          <div
            ref={previewFrame.contentBelowRef}
            className={cn(
              isModal && "sv:flex sv:h-full sv:min-h-0 sv:min-w-0 sv:flex-col sv:gap-4",
            )}
          >
            <VStack gap="sm" className={cn(isModal && "sv:my-auto")}>
              {/* The sheet draws this as a quiet 12px caption over the input (per the reference);
                  the modal keeps the larger section label beside the photo. */}
              <Text
                id={labelId}
                variant={isModal ? "sectionLabel" : "bodySecondary"}
                {...(isModal ? {} : { className: "sv:text-[12px]" })}
              >
                {m.heightPickerLabel}
              </Text>
              <HeightCmPicker
                aria-labelledby={labelId}
                valueCm={valueCm}
                disabled={busy}
                onChange={(cm) => {
                  setValueCm(cm);
                }}
              />
            </VStack>
            {/* No `mt-auto` here: the picker's own `my-auto` absorbs the free space, centring
                it between the header and the CTA block — which therefore sits flush at the
                foot, on the same baseline as every other step. */}
            {isModal ? <div className="sv:w-full">{actions}</div> : null}
          </div>
        }
        // Sheet: the photo column takes the free space and centres in it (`flex-1`, the column
        // already carries `justify-center`), matching the try-on step; the picker column pins
        // to the FOOT so it sits directly above the CTA. Together they fix a short — landscape —
        // upload, where the photo hugged the header and the picker floated mid-screen with a
        // void beneath it. With a tall photo there is no slack and neither moves.
        {...(isModal
          ? { startClassName: flowMediaColumnClassName }
          : { startClassName: "sv:flex-1" })}
        endClassName={isModal ? "sv:min-h-0" : "sv:mt-auto sv:min-h-auto"}
      />
    </SheetShell>
  );
}
