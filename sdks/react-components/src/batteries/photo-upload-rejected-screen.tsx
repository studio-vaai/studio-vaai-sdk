"use client";

import type { FrameLock } from "@studio-vaai/js-machine";

import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { ActionsSection } from "../ui/actions-section.js";
import { Button } from "../ui/button.js";
import { ErrorMessage } from "../ui/error-message.js";
import { IconAlertCircle } from "../ui/icons.js";
import { ResponsiveSplit } from "../ui/responsive-split.js";
import { SheetShell } from "../ui/sheet.js";
import {
  NaturalAspectPreviewFrame,
  useNaturalAspectPreviewFrame,
} from "./natural-aspect-preview-frame.js";

interface PhotoUploadRejectedScreenProps {
  /** Object URL or remote URL for the rejected upload preview. */
  previewSrc: string;
  /**
   * Sub-rect of `previewSrc` to display — set for camera captures (the bbox
   * the user composed within at shutter time). Absent for file-picked uploads,
   * in which case the image renders at its full natural aspect.
   */
  frameLock?: FrameLock;
  onRetry: () => void;
  /** “Guide to a great photo” — e.g. navigate to session intro with consent hidden. */
  onGuideToGreatPhoto: () => void;
  onBack: () => void;
  onClose: () => void;
  /**
   * When true, a retry upload is in flight: header chrome and actions locked,
   * primary CTA shows a spinner, error text hidden.
   */
  busy?: boolean;
}

/**
 * Invalid-image / server errors after the user has chosen a file (session intro upload rejected).
 * Re-upload progress after the user taps retry is shown here via `busy`.
 */
export function PhotoUploadRejectedScreen({
  previewSrc,
  frameLock,
  onRetry,
  onGuideToGreatPhoto,
  onBack,
  onClose,
  busy = false,
}: PhotoUploadRejectedScreenProps) {
  const m = useStudioVaaiUi().messages.photoUpload;
  const isModal = useStudioVaaiUi().responsive.layout === "modal";
  const previewFrame = useNaturalAspectPreviewFrame(previewSrc, frameLock);

  return (
    <SheetShell
      title={
        <span className="sv:flex sv:justify-center sv:items-center sv:gap-2 sv:w-full">
          <IconAlertCircle className="sv:h-4 sv:w-4" />
          <span className="sv:min-w-0 sv:truncate">{m.title}</span>
        </span>
      }
      footer={
        // The message rides WITH the actions, not in the scrollable body. Left in the body it
        // sat directly under the photo while the CTAs stayed pinned to the shell's foot, so
        // every pixel of leftover height opened up between the failure and the button that
        // acts on it — 16px on a short viewport but 124px at 390x844 and 252px at 500x1100.
        // As one bottom cluster the spacing is constant at every height, which is how the
        // reference draws it.
        <div className="sv:flex sv:min-w-0 sv:flex-col sv:gap-4">
          {/* Sheet only. In the modal the message stays in the split's right-hand column, where
              it has always been and where there is room for it; moving it here would leave that
              column empty. */}
          {isModal || busy ? null : <ErrorMessage />}
          <ActionsSection
            className="sv:shrink-0"
            primary={
              <Button
                type="button"
                variant="default"
                busy={busy}
                busyLabel={m.busyRetryUploadSr}
                onClick={onRetry}
              >
                {m.primaryRetry}
              </Button>
            }
            secondary={
              <Button type="button" variant="ghost" disabled={busy} onClick={onGuideToGreatPhoto}>
                {m.guideLink}
              </Button>
            }
          />
        </div>
      }
      busy={busy}
      // The shell's body is a plain block, so the split's `flex-1` has nothing to grow against
      // and the leftover height pools BELOW it — which is what wedged a growing gap between the
      // photo and the failure message. Making the body a flex column lets the split fill it and
      // its `justify-end` bottom-anchor actually take effect. Same fix the intro screen uses.
      classNames={{ body: "sv:flex sv:flex-col" }}
      fillHeight
      fillViewport
      onBack={onBack}
      onClose={onClose}
    >
      <ResponsiveSplit
        // Bottom-anchored: the frame is aspect-locked so it cannot grow to fill a tall body, and
        // the leftover has to land SOMEWHERE. Above the photo it is invisible (the header floats
        // over white either way); below it, it wedges a gap between the photo and the failure
        // message that grows with the viewport. This keeps photo, message and CTA as one tight
        // cluster at every height.
        // `gap-0` because the split's second column is a zero-height measurement spacer — its
        // default `gap-4` was pure padding, making photo→message 32px against the message→CTA
        // 16px. Now both are 16 and the cluster reads as one rhythm.
        className="sv:justify-end sv:gap-0"
        start={
          <NaturalAspectPreviewFrame
            {...previewFrame}
            previewSrc={previewSrc}
            alt=""
            data-studio-vaai="photo-upload-rejected-preview"
            {...(frameLock === undefined ? {} : { frameLock })}
          />
        }
        // The ref must stay MOUNTED even when it wraps nothing: `useNaturalAspectPreviewFrame`
        // sizes the frame from it, and with no element the hook bails and the photo falls back
        // to its natural size. On the sheet it is an empty spacer (the message is in the footer);
        // in the modal it still carries the message.
        end={
          <div ref={previewFrame.contentBelowRef}>
            {/* Boxed: this screen IS the failure — the photo above it can't be used — so the
                message reads as the state of the screen, not a footnote to a control. */}
            {isModal && !busy ? <ErrorMessage /> : null}
          </div>
        }
      />
    </SheetShell>
  );
}
