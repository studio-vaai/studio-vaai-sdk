"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRef } from "react";

import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { Button } from "../ui/button.js";
import { ModalBackdrop, ModalContent, ModalPortal, ModalViewport } from "../ui/modal.js";

interface PhotoRetakeDialogProps {
  open: boolean;
  onCancel: () => void;
  onContinue: () => void;
}

/** Leave the current flow untouched until the shopper confirms the camera retake. */
export function PhotoRetakeDialog({ open, onCancel, onContinue }: PhotoRetakeDialogProps) {
  const m = useStudioVaaiUi().messages.photoCapture;
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onCancel();
        }
      }}
    >
      <ModalPortal>
        <ModalBackdrop forceRender className="sv:z-[60]" />
        <ModalViewport className="sv:z-[70]">
          <ModalContent
            initialFocus={cancelRef}
            // Flow modals hold a fixed height; this short confirmation sizes to its content.
            style={{ height: "auto" }}
            className="sv:min-h-0 sv:max-w-md sv:gap-4 sv:p-6 sv:font-sans sv:text-[var(--sv-color-foreground)]"
          >
            <AlertDialog.Title className="sv:m-0 sv:text-xl sv:font-medium">
              {m.retakeTitle}
            </AlertDialog.Title>
            <AlertDialog.Description className="sv:m-0 sv:text-sm sv:leading-relaxed">
              {m.retakeBody}
            </AlertDialog.Description>
            <div className="sv:flex sv:flex-wrap sv:justify-end sv:gap-3">
              <Button
                ref={cancelRef}
                type="button"
                variant="ghost"
                className="sv:w-auto sv:px-4"
                onClick={onCancel}
              >
                {m.retakeCancel}
              </Button>
              <Button type="button" className="sv:w-auto sv:px-4" onClick={onContinue}>
                {m.retakeContinue}
              </Button>
            </div>
          </ModalContent>
        </ModalViewport>
      </ModalPortal>
    </AlertDialog.Root>
  );
}
