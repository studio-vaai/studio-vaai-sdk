import type { Outcome } from "@studio-vaai/core";
import type { ApiClient } from "@studio-vaai/core/api";

import { BackendError } from "@studio-vaai/core";
import { uploadExperiencePhoto } from "@studio-vaai/core/api";

import { imageInputToBlob } from "../browser/photo/image-input.js";
import { prepareImageForUpload } from "../browser/photo/prepare-upload.js";
import { failed } from "./outcomes.js";

export async function processPhoto(
  client: ApiClient,
  credentialRevision: () => bigint | undefined,
  fetchImpl: typeof fetch,
  image: Blob,
  signal: AbortSignal,
): Promise<Outcome> {
  let prepared: Awaited<ReturnType<typeof prepareImageForUpload>>;

  try {
    const input =
      image instanceof File
        ? { type: "file" as const, file: image }
        : { type: "blob" as const, blob: image };
    prepared = await prepareImageForUpload(input, undefined, signal);
  } catch {
    return failed(signal.aborted ? BackendError.Unavailable : BackendError.InvalidRequest);
  }

  const metadata = prepared.imageMetadata;
  const photo = imageInputToBlob(prepared.image);
  const mimeType = photo.type || "application/octet-stream";
  return await uploadExperiencePhoto(
    client,
    {
      credentialRevision,
      async transfer(upload) {
        try {
          signal.throwIfAborted();
          const response = await fetchImpl(upload.uploadUrl, {
            method: upload.method,
            headers: upload.requiredHeaders.map(({ name, value }) => [name, value]),
            credentials: "omit",
            body: photo,
            signal,
          });
          void discardUploadResponse(response);
          return response.ok && !signal.aborted;
        } catch {
          return false;
        }
      },
    },
    mimeType,
    BigInt(photo.size),
    metadata === undefined ? undefined : photoMetadata(metadata),
  );
}

function photoMetadata({
  uploadedWidth,
  uploadedHeight,
  ...original
}: NonNullable<Awaited<ReturnType<typeof prepareImageForUpload>>["imageMetadata"]>) {
  if (uploadedWidth === undefined || uploadedHeight === undefined) {
    return { original };
  }
  return { original, uploaded: { width: uploadedWidth, height: uploadedHeight } };
}

async function discardUploadResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The signed upload's status is sufficient.
  }
}
