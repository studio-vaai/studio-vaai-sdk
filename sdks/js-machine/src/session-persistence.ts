import type { SessionHandle } from "@studio-vaai/js-client";

export const SESSION_IDLE_MS = 60 * 60 * 1000;

/**
 * Persist {@link SessionHandle} client-side (e.g. localStorage). Used by {@link defaultRootMachine}
 * so a session survives reload and intro can skip consent when a session exists.
 */
export interface SessionPersistenceAdapter {
  read(): SessionHandle | undefined;
  write(handle: SessionHandle, expiresAt?: number): void;
  clear(): void;
}

/** No read/write; for tests or SSR where persistence is unavailable. */
export function createNoopSessionPersistence(): SessionPersistenceAdapter {
  return {
    read(): SessionHandle | undefined {
      return undefined;
    },
    write: (_handle: SessionHandle) => {
      void _handle;
    },
    clear: () => {
      // No-op: nothing persisted.
    },
  };
}

/**
 * In-memory persistence for unit tests.
 */
export function createMemorySessionPersistence(
  initial?: SessionHandle,
): SessionPersistenceAdapter & { snapshot(): SessionHandle | undefined } {
  let value: SessionHandle | undefined = initial;
  return {
    read: () => value,
    write: (h) => {
      value = h;
    },
    clear: () => {
      value = undefined;
    },
    snapshot: () => value,
  };
}

/**
 * Builds a stable localStorage key from the app base path (e.g. Vite `import.meta.env.BASE_URL`)
 * so multiple deployments under different paths do not clobber each other.
 */
export function sessionLocalStorageKeyForBasePath(appBasePath: string): string {
  const trimmed = appBasePath.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const noTrailing =
    withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
  const suffix = noTrailing === "/" ? "" : noTrailing.replaceAll("/", ":");
  return `studio-vaai:session${suffix}`;
}

/**
 * Persists the session token under a single localStorage key (HTTPS-only assumed by the host app).
 */
export function createLocalStorageSessionPersistence(
  storageKey: string,
): SessionPersistenceAdapter {
  return {
    read(): SessionHandle | undefined {
      if (typeof globalThis.localStorage === "undefined") {
        return undefined;
      }
      try {
        const raw = globalThis.localStorage.getItem(storageKey);
        if (raw !== null && raw.length > 0) {
          const value: unknown = JSON.parse(raw);
          if (
            typeof value === "object" &&
            value !== null &&
            "handle" in value &&
            typeof value.handle === "string" &&
            "expiresAt" in value &&
            typeof value.expiresAt === "number" &&
            Number.isFinite(value.expiresAt) &&
            value.expiresAt > Date.now() &&
            value.expiresAt <= Date.now() + SESSION_IDLE_MS
          ) {
            return value.handle as SessionHandle;
          }
        }
        globalThis.localStorage.removeItem(storageKey);
      } catch {
        // Undated legacy handles cannot establish a safe lifetime.
        try {
          globalThis.localStorage.removeItem(storageKey);
        } catch {
          /* unavailable */
        }
      }
      return undefined;
    },
    write: (handle, expiresAt = Date.now() + SESSION_IDLE_MS) => {
      if (typeof globalThis.localStorage === "undefined") {
        return;
      }
      try {
        globalThis.localStorage.setItem(
          storageKey,
          JSON.stringify({
            handle,
            expiresAt: Math.min(expiresAt, Date.now() + SESSION_IDLE_MS),
          }),
        );
      } catch {
        /* Quota or private mode; session not persisted. */
      }
    },
    clear: () => {
      if (typeof globalThis.localStorage === "undefined") {
        return;
      }
      try {
        globalThis.localStorage.removeItem(storageKey);
      } catch {
        /* Ignore removal errors. */
      }
    },
  };
}
