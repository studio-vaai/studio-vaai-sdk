import type { BodyId } from "@studio-vaai/js-client";

import { assign, setup, type SnapshotFrom } from "xstate";

import type { PhotoUploadContext, PhotoUploadInput } from "../context/index.js";

import {
  createBodyActor,
  isCreateBodyDomainError,
  toCreateBodyLikeError,
  transportErrorFromActor,
  type CreateBodyActorOutput,
} from "../actors.js";

export type PhotoUploadEvent =
  | {
      type: "IMAGE_SELECTED";
      image: NonNullable<PhotoUploadContext["image"]>;
    }
  /**
   * Attach a JPEG `previewBlob` to the in-flight image. Sent once HEIC→JPEG conversion
   * (kicked off in parallel with `IMAGE_SELECTED`) finishes. `previewFor` identifies the
   * source Blob/File the conversion was run on; the handler ignores the event if the
   * current image points at a different source (user picked another file mid-flight).
   */
  | { type: "ATTACH_PREVIEW_BLOB"; previewFor: Blob | File; previewBlob: Blob }
  | { type: "RETRY" };

export type PhotoUploadOutput = {
  bodyId: BodyId;
  /** Model-predicted height (cm) from create-body; seeds height calibration. */
  heightCm: number;
  /** Same image the user submitted; kept on the root for UI preview (e.g. height calibration). */
  image: NonNullable<PhotoUploadContext["image"]>;
};

export const photoUploadMachine = setup({
  types: {
    context: {} as PhotoUploadContext,
    events: {} as PhotoUploadEvent,
    input: {} as PhotoUploadInput,
    output: {} as PhotoUploadOutput,
  },
  actors: {
    createBody: createBodyActor,
  },
}).createMachine({
  id: "photoUpload",
  initial: "intro",
  context: ({ input }) => ({
    client: input.client,
    session: input.session,
    image: input.initialImage,
    bodyId: undefined,
    predictedHeightCm: undefined,
    lastError: undefined,
  }),
  states: {
    intro: {
      always: [
        {
          guard: ({ context }) => context.image !== undefined,
          target: "uploading",
        },
      ],
      on: {
        IMAGE_SELECTED: {
          target: "uploading",
          actions: assign({
            image: ({ event }) => event.image,
            lastError: undefined,
          }),
        },
      },
    },
    uploading: {
      invoke: {
        src: "createBody",
        input: ({ context }) => {
          const image = context.image;
          if (!image) {
            throw new Error("photoUpload: missing image");
          }
          return {
            client: context.client,
            session: context.session,
            image,
          };
        },
        onDone: {
          target: "accepted",
          actions: assign({
            bodyId: ({ event }) => (event.output as CreateBodyActorOutput).bodyId,
            predictedHeightCm: ({ event }) => (event.output as CreateBodyActorOutput).heightCm,
          }),
        },
        onError: [
          {
            // Domain errors (invalid photo content/format) → show the rejection screen.
            guard: ({ event }) => isCreateBodyDomainError(event.error),
            target: "rejected",
            actions: assign({
              lastError: ({ event }) => toCreateBodyLikeError(event.error),
            }),
          },
          {
            // Transport/server errors → stay on the intro screen with an inline error.
            target: "uploadFailed",
            actions: assign({
              lastError: ({ event }) => transportErrorFromActor(event.error),
            }),
          },
        ],
      },
    },
    uploadFailed: {
      on: {
        IMAGE_SELECTED: {
          target: "uploading",
          actions: assign({ image: ({ event }) => event.image, lastError: undefined }),
        },
      },
    },
    rejected: {
      on: {
        RETRY: {
          target: "intro",
          actions: assign({
            image: undefined,
            predictedHeightCm: undefined,
            lastError: undefined,
          }),
        },
      },
    },
    accepted: {
      type: "final",
    },
  },
  on: {
    ATTACH_PREVIEW_BLOB: {
      actions: assign({
        image: ({ context, event }) => {
          const { image } = context;
          if (image === undefined) {
            return;
          }
          if (image.type === "blob") {
            return image.blob === event.previewFor
              ? { ...image, previewBlob: event.previewBlob }
              : image;
          }
          return image.file === event.previewFor
            ? { ...image, previewBlob: event.previewBlob }
            : image;
        },
      }),
    },
  },
  output: ({ context }): PhotoUploadOutput => {
    const image = context.image;
    if (image === undefined) {
      throw new Error("photoUpload: missing image in output");
    }
    const heightCm = context.predictedHeightCm;
    if (heightCm === undefined || !Number.isFinite(heightCm) || heightCm <= 0) {
      throw new Error("photoUpload: missing predictedHeightCm in output");
    }
    return {
      bodyId: context.bodyId!,
      heightCm,
      image,
    };
  },
});

export type PhotoUploadSnapshot = SnapshotFrom<typeof photoUploadMachine>;
