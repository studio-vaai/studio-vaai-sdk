import { defineElement } from "../internal/define-element.js";
import { defineSvElements } from "../register.js";
import { SvTryOnExperience } from "./sv-try-on-experience.js";

export { SvTryOnExperience, type SvTryOnExperienceProps } from "./sv-try-on-experience.js";
export { createApiTryOnExperience, type ApiTryOnExperienceOptions } from "./api/create.js";
export {
  isTryOnProductUnavailable,
  type PresentProduct,
  type ProductCommerce,
  type ProductPresentation,
  type TryOnProductReference,
} from "./api/product.js";
export { ImageFetchError } from "./image-fetch-error.js";
export type { TryOnExperienceDevices } from "./api/adapter.js";
export type {
  TryOnExperienceEntry,
  TryOnExperienceEvent,
  TryOnExperienceEventMap,
  TryOnExperienceStep,
} from "./events.js";
export {
  TryOnExperience,
  type TryOnExperienceAdapters,
  type TryOnExperienceCamera,
  type TryOnExperiencePhoto,
  type TryOnRenderer,
  type StorefrontSelection,
} from "./controller.js";

export function defineSvTryOnExperience(): void {
  defineSvElements();
  defineElement("sv-try-on-experience", SvTryOnExperience);
}

export { createBrowserTryOnDevices, type BrowserTryOnDevices } from "./browser/devices.js";
