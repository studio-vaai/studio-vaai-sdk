import type { BodyValidationCode } from "@studio-vaai/js-client";

import type {
  ApiCallLogEntry,
  DebugErrorKind,
  DebugLocale,
  DebugMethodId,
  DebugState,
  InjectedBodyValidationFailure,
  InjectedError,
} from "./types.js";

import { DEBUG_LOCALE_EVENT, DEBUG_LOCALE_STORAGE_KEY, DEBUG_LOCALES } from "./types.js";

const MAX_LOG_ENTRIES = 50;

/** The persisted forced locale, or `null` (absent / not a browser / storage blocked). */
function readPersistedLocale(): DebugLocale | null {
  try {
    const v = globalThis.localStorage.getItem(DEBUG_LOCALE_STORAGE_KEY);
    return DEBUG_LOCALES.find((l) => l === v) ?? null;
  } catch {
    return null;
  }
}

let _state: DebugState = {
  injectedErrors: {},
  injectedBodyValidationFailures: {},
  log: [],
  locale: readPersistedLocale(),
};
let _nextId = 0;
const _listeners = new Set<(s: DebugState) => void>();

function notify(): void {
  for (const l of _listeners) {
    l(_state);
  }
}

export function getDebugState(): DebugState {
  return _state;
}

export function injectError(methodId: DebugMethodId, kind: DebugErrorKind, message: string): void {
  const error: InjectedError = { kind, message };
  _state = { ..._state, injectedErrors: { ..._state.injectedErrors, [methodId]: error } };
  notify();
}

export function clearError(methodId: DebugMethodId): void {
  const injectedErrors = Object.fromEntries(
    Object.entries(_state.injectedErrors).filter(([k]) => k !== methodId),
  );
  _state = { ..._state, injectedErrors };
  notify();
}

/**
 * Inject a typed validation rejection for `body.createBody`. The wrapped client returns a
 * successful `{ ok: true, data: { status: "failed", failure: { kind: "validation", … } } }` —
 * matching the real server when an image fails content checks.
 */
export function injectBodyValidationFailure(
  methodId: DebugMethodId,
  code: BodyValidationCode,
  message?: string,
): void {
  const failure: InjectedBodyValidationFailure =
    typeof message === "undefined" ? { code } : { code, message };
  _state = {
    ..._state,
    injectedBodyValidationFailures: {
      ..._state.injectedBodyValidationFailures,
      [methodId]: failure,
    },
  };
  notify();
}

export function clearBodyValidationFailure(methodId: DebugMethodId): void {
  const injectedBodyValidationFailures = Object.fromEntries(
    Object.entries(_state.injectedBodyValidationFailures).filter(([k]) => k !== methodId),
  );
  _state = { ..._state, injectedBodyValidationFailures };
  notify();
}

/**
 * Force (or clear, with `null`) the SDK UI locale from the debugger. Persists across reloads via
 * `localStorage` and fires the [`DEBUG_LOCALE_EVENT`] `CustomEvent` on `window`, so SSR-rendered
 * hosts can follow the toggle without importing this package — see the contract on
 * [`DEBUG_LOCALE_STORAGE_KEY`].
 */
export function setDebugLocale(locale: DebugLocale | null): void {
  _state = { ..._state, locale };
  try {
    if (locale === null) {
      globalThis.localStorage.removeItem(DEBUG_LOCALE_STORAGE_KEY);
    } else {
      globalThis.localStorage.setItem(DEBUG_LOCALE_STORAGE_KEY, locale);
    }
  } catch {
    // Storage blocked (private mode / permissions) — the toggle still works for this page load.
  }
  globalThis.dispatchEvent(
    new CustomEvent<DebugLocale | null>(DEBUG_LOCALE_EVENT, { detail: locale }),
  );
  notify();
}

export function logApiCall(entry: Omit<ApiCallLogEntry, "id">): void {
  const newEntry: ApiCallLogEntry = { ...entry, id: _nextId };
  _nextId += 1;
  const log = [..._state.log, newEntry];
  _state = { ..._state, log: log.slice(-MAX_LOG_ENTRIES) };
  notify();
}

/**
 * Subscribe to debug state changes. Returns an unsubscribe function.
 */
export function subscribeDebugState(listener: (s: DebugState) => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}
