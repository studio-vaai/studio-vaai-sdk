// Side effect: registers the <studio-vaai-debugger> custom element.
import "./web-components/studio-vaai-debugger.js";

export { setupStudioVaaiDebugger } from "./setup.js";
export {
  injectError,
  clearError,
  injectBodyValidationFailure,
  clearBodyValidationFailure,
  getDebugState,
  subscribeDebugState,
  setDebugLocale,
  logApiCall,
} from "./debug-state.js";
export { createDebugClient } from "./debug-client.js";
export type {
  DebugMethodId,
  DebugErrorKind,
  DebugLocale,
  InjectedError,
  InjectedBodyValidationFailure,
  ApiCallLogEntry,
  DebugState,
} from "./types.js";
export {
  ALL_METHOD_IDS,
  BODY_VALIDATION_CODES,
  DEBUG_LOCALES,
  DEBUG_LOCALE_EVENT,
  DEBUG_LOCALE_STORAGE_KEY,
  DOMAIN_ERROR_METHOD_IDS,
  STANDARD_ERROR_KINDS,
} from "./types.js";
