export type ImageInput =
  | { type: "blob"; blob: Blob }
  | { type: "file"; file: File }
  | {
      type: "bytes";
      data: ArrayBuffer | Uint8Array;
      mimeType: string;
    };

export type { ImageMetadata as ImageMetadataInput } from "@studio-vaai/core/api";
