import type {
  AxisKey,
  BodyRevision,
  ForeignId,
  PresentationView,
  Product,
  SelectionView,
  TryOn,
  TryOnId,
  VariantId,
} from "@studio-vaai/core";

import type { SvStockNotice, SvVariantCommerce } from "../../commerce/types.js";
import type { SvScreenNavigation } from "../../components/screen/sv-screen.js";
import type { SvImageCrop } from "../../media/image-crop.js";
import type { SvImageFraming } from "../../media/image-framing.js";
import type { SvTryOnFit } from "./fit.js";

export const SV_TRY_ON_VIEW_STATES = ["ready", "generating", "error"] as const;
export type SvTryOnViewState = (typeof SV_TRY_ON_VIEW_STATES)[number];

export type SvTryOnViewChangeDetail =
  | { field: "stockNotice"; value: SvStockNotice | undefined }
  | { field: "selection"; axis: AxisKey; item: ForeignId }
  | { field: "pickerOpen" | "fitDetailsOpen"; value: boolean }
  | { field: "displayedImage"; tryOnId: TryOnId }
  | { field: "displayedAxis"; axis: AxisKey; item: ForeignId }
  | { field: "activeCalloutKey"; value: string | undefined };

export type SvTryOnViewActionDetail =
  | { action: "try-on" | "retry"; variantId: VariantId }
  | { action: "add-to-cart"; variantId: VariantId; tryOnId: TryOnId }
  | { action: "upload" | "select-recommendation" }
  | { action: "download" | "retry-fit-score"; tryOnId: TryOnId };

export interface SvTryOnViewScreenProps {
  /** Journey-supplied header availability. */
  navigation?: SvScreenNavigation | undefined;
  /** Localized host product name. */
  productName?: string | undefined;
  /** The product's variant identities and foreign IDs from the domain. */
  product?: Product | undefined;
  /** Current selection and projected rows, directly from the Rust experience. */
  selection?: SelectionView | undefined;
  /** Displayed image, ordered result IDs and try-on admission from the Rust experience. */
  presentation?: PresentationView | undefined;
  /** Immutable domain results referenced by presentation. */
  tryOns?: readonly TryOn[] | undefined;
  /** Active acknowledged body revision. Pass null while waiting for a body revision. */
  bodyRevision?: BodyRevision | null | undefined;
  /** Host-formatted price and stock, keyed by actual variant ID. */
  commerce?: Readonly<Record<VariantId, SvVariantCommerce>> | undefined;
  /** The shopper's source photo; generated images come from their TryOn records. */
  photoSrc?: string | undefined;
  photoLoadKey?: string | undefined;
  /** Visible rectangle in the source photo. Generated results use their complete image. */
  photoCrop?: SvImageCrop | undefined;
  /** Caller-owned protected composition for this photo, after photoCrop. */
  photoFraming?: SvImageFraming | undefined;
  /** One common reference and protected union for all comparable generated results. */
  resultFraming?: SvImageFraming | undefined;
  /** Host-owned refused-stock notice, returned from the stockNotice change request. */
  stockNotice?: SvStockNotice | undefined;
  /** Fit information tied to a result ID. Omit to hide it; mismatched IDs are ignored. */
  fit?: SvTryOnFit | undefined;
  /** Foreground request phase, including whether image rendering has started. */
  state?: SvTryOnViewState | undefined;
  /** Localized progress when the request is queued or is waiting for height. */
  statusMessage?: string | undefined;
  /** A foreground request exists, but may not have started rendering yet. */
  requestPending?: boolean | undefined;
  /** The variant of a retryable failed request. */
  retryVariantId?: VariantId | undefined;
  /** Waiting for the host to accept the item in its cart. */
  cartPending?: boolean | undefined;
  /** Whether the host can add the displayed variant to the cart. */
  cartAvailable?: boolean | undefined;
  /** Whether the displayed image can be downloaded now. */
  downloadAvailable?: boolean | undefined;
  /** A download is in progress. */
  downloadPending?: boolean | undefined;
  /** Current result image supplied by the experience. Null waits for an accepted asset. */
  resultImageSrc?: string | null | undefined;
  resultImageLoadKey?: string | undefined;
  /** The displayed image must load before its result actions become available. */
  resultImageState?: "loading" | "ready" | "error" | undefined;
  /** Expand the mobile variant picker. Desktop always shows the picker. */
  pickerOpen?: boolean | undefined;
  /** Expand fit details and show callouts on the image. */
  fitDetailsOpen?: boolean | undefined;
  /** Key of the pinned fit callout. Pointer hover is temporary and does not change this key. */
  activeCalloutKey?: string | undefined;
  /** Other work in progress; locks navigation and actions. Disclosures remain readable. */
  busy?: boolean | undefined;
  /** Localized failure message. Omit for the state default; an empty string hides it. */
  error?: string | undefined;
}
