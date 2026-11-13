import "./core.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace StudioVaai {
  // Bodies and height

  @error
  @doc("Some request fields are missing, invalid, or conflicting.")
  model BodyBadRequestProblem extends ProblemDetails {
    kind:
      | CommonBadRequestProblemKind
      | UploadBadRequestProblemKind
      | BodyIdBadRequestProblemKind
      | "invalid-height"
      | "invalid-staging-key"
      | "invalid-image-metadata";
  }

  @error
  @doc("The body or uploaded image is not available in this session. This also applies to bodies and uploads from another session.")
  model BodyNotFoundProblem extends ProblemDetails {
    kind: BodyNotFoundProblemKind | "upload-not-found";
  }

  @error
  @doc("The image could not be used to create a body. Upload a different image.")
  model BodyUnusableProblem extends ProblemDetails {
    kind: "body-unusable";
  }

  @error
  @doc("The body could not be adjusted to this height. No changes were saved.")
  model BodyHeightUnusableProblem extends ProblemDetails {
    kind: "height-calibration-failed";
  }

  @doc("Some request fields are missing, invalid, or conflicting.")
  model BodyBadRequestResponse
    is NoStoreProblemResponse<400, BodyBadRequestProblem>;

  @doc("The body or uploaded image was not found in this session.")
  model BodyNotFoundResponse
    is NoStoreProblemResponse<404, BodyNotFoundProblem>;

  @doc("The image was rejected. Use `reason` to explain what needs to change.")
  model BodyValidationFailedResponse
    is NoStoreProblemResponse<422, BodyValidationFailed>;

  @doc("The image could not be used to create a body.")
  model BodyUnusableResponse
    is NoStoreProblemResponse<422, BodyUnusableProblem>;

  @doc("The body could not be adjusted to the requested height.")
  model BodyHeightUnusableResponse
    is NoStoreProblemResponse<422, BodyHeightUnusableProblem>;

  @doc("Details of the image to upload.")
  model PrepareBodyUploadBody {
    @doc("MIME type of the image, for example `image/jpeg`.")
    @example("image/jpeg")
    contentType: string;

    @doc("Exact size of the image file in bytes. Upload these same bytes without re-encoding them.")
    @minValue(1)
    @maxValue(52428800)
    @example(1024000)
    byteSize: int64;

    @doc("Image file name, if available.")
    fileName?: string;
  }

  @doc("An HTTP header required for the image upload.")
  model UploadHeader {
    @doc("Header name.")
    name: string;

    @doc("Header value.")
    value: string;
  }

  @doc("Instructions for uploading an image. Complete the upload before calling `createBody`.")
  model PrepareBodyUploadResponse {
    @doc("Upload the image bytes to this URL using `method` and `requiredHeaders`.")
    uploadUrl: string;

    @doc("HTTP method for the upload.")
    method: string;

    @doc("Identifier for this upload. Pass it unchanged to `createBody` after uploading the image.")
    stagingKey: string;

    @doc("Headers to send with the upload. Use the returned names and values exactly.")
    requiredHeaders: UploadHeader[];

    @doc("When the upload URL expires (UTC). Call `prepareBodyUpload` for a new URL after expiry.")
    expiresAt: utcDateTime;
  }

  @doc("""
    Image dimensions and optional EXIF values. When resizing an image before upload,
    send its original dimensions and any EXIF values that would be lost. If this
    object is omitted, the API reads metadata embedded in the uploaded image.
    """)
  model ImageMetadata {
    @doc("Width of the original image in pixels, before resizing.")
    @minValue(1)
    originalWidth: int32;

    @doc("Height of the original image in pixels, before resizing.")
    @minValue(1)
    originalHeight: int32;

    @doc("Width of the uploaded image in pixels. Supply together with `uploadedHeight` when resizing the image; otherwise omit both.")
    @minValue(1)
    @maxValue(16384)
    uploadedWidth?: int32;

    @doc("Height of the uploaded image in pixels. Supply together with `uploadedWidth` when resizing the image; otherwise omit both.")
    @minValue(1)
    @maxValue(16384)
    uploadedHeight?: int32;

    @doc("Camera focal length in millimetres (`EXIF FocalLength`).")
    focalLengthMm?: float32;

    @doc("35 mm equivalent focal length in millimetres (`EXIF FocalLengthIn35mmFilm`).")
    focalLength35mm?: float32;

    @doc("Horizontal focal-plane resolution (`EXIF FocalPlaneXResolution`), in pixels per `focalPlaneResolutionUnit`.")
    focalPlaneXResolution?: float32;

    @doc("Vertical focal-plane resolution (`EXIF FocalPlaneYResolution`), in pixels per `focalPlaneResolutionUnit`.")
    focalPlaneYResolution?: float32;

    @doc("Unit for the focal-plane resolutions: `2` for inches or `3` for centimetres (`EXIF FocalPlaneResolutionUnit`).")
    focalPlaneResolutionUnit?: int32;
  }

  @doc("The uploaded still JPEG, PNG, WebP, HEIC/HEIF or JPEG XL image to use when creating a body. The decoded image must have at most 16,384 pixels per edge and 64,000,000 pixels in total, whether or not `imageMetadata` is supplied.")
  model FinalizeBodyUploadBody {
    @doc("Upload identifier returned by `prepareBodyUpload`.")
    stagingKey: string;

    @doc("MIME type of the uploaded image. Use the same value sent to `prepareBodyUpload`.")
    mimeType: string;

    @doc("Image dimensions and EXIF values supplied separately from the uploaded image.")
    imageMetadata?: ImageMetadata;
  }

  @doc("A newly created body, with its initial height estimate and source image.")
  model InitialBodySummary {
    @doc("Stable body identifier. Use it to set height, request size recommendations, and create try-ons.")
    bodyId: string;

    @doc("When the body was created (UTC).")
    createdAt: utcDateTime;

    @doc("Initial height estimate from the source image, in centimetres.")
    estimatedHeightCm: float32;

    @doc("Temporary signed URL for the image used to create the body. Use it before `sourceImageUrlExpiresAt`; call `listBodies` for a fresh URL after expiry.")
    sourceImageUrl: string;

    @doc("When `sourceImageUrl` expires (UTC). Each `createBody` or `listBodies` response includes a valid URL and its expiry.")
    sourceImageUrlExpiresAt: utcDateTime;
  }

  @doc("A body in the current session. Includes `userProvidedHeightCm` after height is set.")
  model BodySummary extends InitialBodySummary {
    @doc("Identifier of the immutable revision represented by this summary. Pass it when requesting a try-on or size recommendation for this height.")
    bodyRevisionId?: string;
    @doc("Height set by `setBodyHeight`, in centimetres. Omitted until height is set.")
    userProvidedHeightCm?: float32;
  }

  @doc("The body was created successfully. Use `setBodyHeight` to set its height.")
  model BodyReady {
    @doc("Body creation has completed.")
    status: "ready";

    @doc("The created body.")
    body: InitialBodySummary;
  }

  @doc("Reasons an image cannot be used to create a body.")
  union BodyValidationCode {
    noHumanDetected: "no_human_detected",
    humanOccluded: "human_occluded",
    humanNotStanding: "human_not_standing",
    humanTooSmall: "human_too_small",
    inappropriateClothing: "inappropriate_clothing",
  }

  @error
  @doc("The image was rejected and no body was created. Use `title` or `detail` as a fallback explanation if no localized message is available.")
  model BodyValidationFailed extends ProblemDetails {
    kind: "body-validation-failed";

    @doc("Why the image was rejected. Use this code to choose a localized message.")
    reason: BodyValidationCode;
  }

  @doc("Bodies in the current session.")
  model ListBodiesResponse {
    @doc("Includes bodies whose height has not been set. Empty when the session has no bodies.")
    bodies: BodySummary[];
  }

  @doc("Height to apply to the body, with an optional product to prepare for the next try-on.")
  model SetBodyHeightBody {
    @doc("Height to set, in centimetres.")
    @example(173)
    heightCm: float32;

    @doc("Product for the next try-on. Providing it lets the server start speculative background computation to prepare the body for this product and make the next try-on faster. The height update does not wait for this computation. Omit when no product is selected.")
    productId?: string;

    @doc("Return the exact immutable revision written by this request as a 200 response.")
    returnRevision?: boolean;
  }

  model BodyHeightRevision {
    @doc("Identifier of the immutable body revision written by this request.")
    bodyRevisionId: string;
  }

  @doc("Create bodies from uploaded images, list them, and set their height. All operations require a client API key and a session. All responses include `Cache-Control: no-store`. Errors use `application/problem+json`.")
  @tag("body")
  interface Body {
    @post
    @route("/bodies/upload-urls")
    @operationId("prepareBodyUpload")
    @summary("Prepare a body image upload")
    @doc("Get a temporary URL for uploading an image. Upload the image bytes using the returned `method` and `requiredHeaders`, then pass `stagingKey` to `createBody`.")
    prepareBodyUpload(
      ...ApiVersionHeader,
      ...ClientApiKeyHeader,
      @body body: PrepareBodyUploadBody,
    ):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @body upload: PrepareBodyUploadResponse;
        }
      | BodyBadRequestResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | NoStoreInternalServerErrorResponse;

    @post
    @route("/bodies")
    @operationId("createBody")
    @summary("Create a body")
    @doc("Create a body from an uploaded image. This request waits for processing to finish. On success, use `body.bodyId` for height updates, size recommendations, and try-ons. The response also includes the height estimate and source image URL. Unsuitable images return `422` without creating a body. Missing, expired, or inaccessible uploads return `404`.")
    createBody(
      ...ApiVersionHeader,
      ...ClientApiKeyHeader,
      @body body: FinalizeBodyUploadBody,
    ):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 201;
          @body result: BodyReady;
        }
      | BodyBadRequestResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | BodyNotFoundResponse
      | BodyValidationFailedResponse
      | BodyUnusableResponse
      | NoStoreInternalServerErrorResponse;

    @get
    @route("/bodies")
    @operationId("listBodies")
    @summary("List bodies")
    @doc("List the bodies in the current session. Includes bodies whose height has not been set; these omit `userProvidedHeightCm`. Each body includes a valid source image URL and its expiry, so this operation can also refresh expired URLs. Returns an empty `bodies` array when there are no bodies.")
    listBodies(...ApiVersionHeader, ...ClientApiKeyHeader):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @body result: ListBodiesResponse;
        }
      | BodyBadRequestResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | NoStoreInternalServerErrorResponse;

    @patch
    @route("/bodies/{bodyId}/height")
    @operationId("setBodyHeight")
    @summary("Set Body Height")
    @doc("Set the body's height in centimetres. A successful update returns `204` with no response body by default. With `returnRevision` it returns `200` with the exact revision written. Invalid input returns `400`. If the body cannot be adjusted to the requested height, the API returns `422` and keeps the previous values. Missing or inaccessible bodies return `404`.")
    setBodyHeight(
      ...ApiVersionHeader,
      ...ClientApiKeyHeader,
      @path bodyId: string,
      @body body: SetBodyHeightBody,
    ):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 204;
        }
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @body revision: BodyHeightRevision;
        }
      | BodyBadRequestResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | BodyNotFoundResponse
      | BodyHeightUnusableResponse
      | NoStoreInternalServerErrorResponse;
  }
}
