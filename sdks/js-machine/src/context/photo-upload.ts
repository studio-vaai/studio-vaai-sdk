import type { StandardError } from "@studio-vaai/js-client";
import type { BodyId } from "@studio-vaai/js-client";
import type { SessionHandle } from "@studio-vaai/js-client";
import type { StudioVaaiClient } from "@studio-vaai/js-client";

import type { CreateBodyLikeError, FrameLock, JsMachineInput } from "./shared.js";

export interface PhotoUploadContext {
  client: StudioVaaiClient;
  session: SessionHandle;
  /**
   * Latest image for {@link BodyApi.createBody}. `frameLock` is present when
   * the image came from the in-app camera (the composition bbox at shutter
   * time); downstream displays render the source cropped to this rect.
   */
  image?:
    | { type: "blob"; blob: Blob; previewBlob?: Blob; frameLock?: FrameLock }
    | { type: "file"; file: File; previewBlob?: Blob; frameLock?: FrameLock }
    | undefined;
  bodyId?: BodyId | undefined;
  /** Set when {@link BodyApi.createBody} succeeds; model-predicted height (cm). */
  predictedHeightCm?: number | undefined;
  lastError?: StandardError | CreateBodyLikeError | undefined;
}

export interface PhotoUploadInput extends JsMachineInput {
  session: SessionHandle;
  /** When set, skip `intro` and start upload (root passes this after `sessionIntro.awaitingImage`). */
  initialImage?: PhotoUploadContext["image"];
}
