import type { PhotoUploadContext } from "@studio-vaai/js-machine";

import { inspectImageHeader } from "@studio-vaai/js-client";
import { useEffect, useState } from "react";

/** Validate a bounded header before creating any local pixel preview. */
export function usePhotoPreviewUrl(
  image: PhotoUploadContext["image"] | undefined,
  active: boolean,
): string | undefined {
  const source = image?.previewBlob ?? (image?.type === "blob" ? image.blob : image?.file);
  const [preview, setPreview] = useState<{ source: Blob; url: string } | null>(null);
  useEffect(() => {
    setPreview(null);
    if (!active || !source) {
      return;
    }
    const selected = source;
    const controller = new AbortController();
    let url: string | null = null;
    async function validate(): Promise<void> {
      try {
        const dimensions = await inspectImageHeader(selected, controller.signal);
        if (dimensions && !controller.signal.aborted) {
          url = URL.createObjectURL(selected);
          setPreview({ source: selected, url });
        }
      } catch {
        /* Invalid/unsupported inputs have no local pixel preview. */
      }
    }
    void validate();
    return () => {
      controller.abort();
      if (url !== null) {
        URL.revokeObjectURL(url);
      }
    };
  }, [active, source]);
  let result: string | undefined;
  if (active && preview?.source === source) {
    result = preview?.url;
  }
  return result;
}
