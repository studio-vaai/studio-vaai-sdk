/** A failed image HTTP response. Use its status to report a rejected signed URL. */
export class ImageFetchError extends Error {
  override readonly name = "ImageFetchError";

  readonly status: number;

  constructor(status: number) {
    super("Could not download the try-on image.");
    this.status = status;
  }
}
