import type { BodyId, PhotoSource } from "@studio-vaai/core";

import { PhotoSource as Source } from "@studio-vaai/core";

export interface CommittedBody {
  id: BodyId;
  source: PhotoSource;
}

interface StoredSelection {
  version: 1;
  generation: string;
  legacyGeneration?: string | null;
  body?: CommittedBody | null | undefined;
  bodyVersion?: string | undefined;
}

function readBody(value: unknown): CommittedBody | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "source" in value &&
    (value.source === Source.Camera || value.source === Source.Library)
  ) {
    return { id: value.id, source: value.source };
  }
  return undefined;
}

interface BodySelection {
  generation: string;
  version: string;
  body: CommittedBody;
}

function parse(raw: string | null): unknown {
  try {
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Cookie sessions can outlive an SDK mount and are shared by tabs on the storefront. */
export async function bodySelectionStore(baseUrl: string, clientKey: string) {
  const digest = await globalThis.crypto?.subtle?.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([baseUrl.replace(/\/+$/u, ""), clientKey])),
  );
  const legacyKey =
    digest === undefined
      ? undefined
      : `sv.tryOn.body.${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const key = legacyKey === undefined ? undefined : `${legacyKey}.selection`;
  const legacySessionKey = legacyKey === undefined ? undefined : `${legacyKey}.session`;
  let local: StoredSelection = { version: 1, generation: "existing" };
  let failedGenerationWrite: string | undefined;
  let failedBodyWrite: string | undefined;

  function bodyKey(generation: string) {
    return `${key}.body.${generation}`;
  }

  function rejectedKey(generation: string, version: string) {
    return `${bodyKey(generation)}.rejected.${version}`;
  }

  function readStorage() {
    if (key === undefined || legacyKey === undefined || legacySessionKey === undefined) {
      return;
    }
    const raw = globalThis.localStorage.getItem(key);
    const legacyGeneration = globalThis.localStorage.getItem(legacySessionKey);
    const previous = parse(raw);
    const pointer = JSON.stringify([raw, legacyGeneration]);
    let generation = legacyGeneration ?? "existing";
    let fallback: CommittedBody | null | undefined;
    if (
      typeof previous === "object" &&
      previous !== null &&
      "version" in previous &&
      previous.version === 1 &&
      "generation" in previous &&
      typeof previous.generation === "string"
    ) {
      const changed =
        "legacyGeneration" in previous && previous.legacyGeneration !== legacyGeneration;
      if (!changed) {
        ({ generation } = previous);
        fallback = readBody("body" in previous ? previous.body : undefined);
      }
    } else if (raw === null) {
      fallback = readBody(parse(globalThis.localStorage.getItem(legacyKey)));
    }
    const storage = globalThis.localStorage;
    const bodyRaw = storage.getItem(bodyKey(generation));
    const record = parse(bodyRaw);
    const version =
      typeof record === "object" &&
      record !== null &&
      "selectionVersion" in record &&
      typeof record.selectionVersion === "string"
        ? record.selectionVersion
        : undefined;
    const body = bodyRaw === null ? fallback : readBody(record);
    const bodyVersion = body === null || body === undefined ? undefined : (version ?? body.id);
    const rejected =
      bodyVersion !== undefined && storage.getItem(rejectedKey(generation, bodyVersion)) !== null;
    return {
      pointer,
      bodyFingerprint: JSON.stringify([pointer, bodyRaw, fallback, rejected]),
      selection: {
        version: 1 as const,
        generation,
        legacyGeneration,
        body: rejected ? null : body,
        bodyVersion,
      },
    };
  }

  function read() {
    try {
      const shared = readStorage();
      if (
        shared !== undefined &&
        shared.pointer !== failedGenerationWrite &&
        shared.bodyFingerprint !== failedBodyWrite
      ) {
        failedGenerationWrite = undefined;
        failedBodyWrite = undefined;
        local = shared.selection;
      }
    } catch {
      // Embedded contexts may deny browser storage.
    }
    return local;
  }

  function save(body: CommittedBody | null, generation = read().generation) {
    const current = read();
    if (current.generation !== generation) {
      return;
    }
    const bodyVersion = body === null ? undefined : crypto.randomUUID();
    local = { ...current, body, bodyVersion };
    if (key === undefined || failedGenerationWrite !== undefined) {
      return;
    }
    try {
      const shared = readStorage();
      if (shared?.selection.generation !== generation) {
        return;
      }
      failedBodyWrite = shared.bodyFingerprint;
      globalThis.localStorage.setItem(
        bodyKey(generation),
        JSON.stringify(body === null ? null : { ...body, selectionVersion: bodyVersion }),
      );
      failedBodyWrite = undefined;
      if (shared.selection.bodyVersion !== undefined) {
        globalThis.localStorage.removeItem(rejectedKey(generation, shared.selection.bodyVersion));
      }
      // A tab rotating the cookie during this write can only leave an obsolete body key.
      if (readStorage()?.selection.generation !== generation) {
        globalThis.localStorage.removeItem(bodyKey(generation));
      }
    } catch {
      // Retain the local value while the shared body selection is unchanged.
    }
  }

  function selected(): BodySelection | undefined {
    const { generation, body, bodyVersion: version } = read();
    return body !== null && body !== undefined && version !== undefined
      ? { generation, version, body }
      : undefined;
  }

  function isCurrent(expected: BodySelection): boolean {
    const current = selected();
    return current?.generation === expected.generation && current.version === expected.version;
  }

  function rejectSelection(expected: BodySelection): void {
    if (!isCurrent(expected)) {
      return;
    }
    local = { ...local, body: null };
    if (key === undefined || failedGenerationWrite !== undefined) {
      return;
    }
    const { generation, version } = expected;
    const marker = rejectedKey(generation, version);
    try {
      const shared = readStorage();
      if (shared?.selection.generation === generation && shared.selection.bodyVersion === version) {
        failedBodyWrite = shared.bodyFingerprint;
        // A restore invalidates only the exact record it read, even if another tab
        // selects a body between this check and the storage write.
        globalThis.localStorage.setItem(marker, "1");
        failedBodyWrite = undefined;
        const latest = readStorage()?.selection;
        if (latest?.generation !== generation || latest.bodyVersion !== version) {
          globalThis.localStorage.removeItem(marker);
        }
      }
    } catch {
      // Keep the invalidation local if this context cannot write to storage.
    }
  }

  return {
    get generation() {
      return read().generation;
    },
    beginSession() {
      const generation = crypto.randomUUID();
      local = { version: 1, generation, body: null };
      if (key !== undefined) {
        try {
          const shared = readStorage();
          failedGenerationWrite = shared?.pointer;
          globalThis.localStorage.setItem(
            key,
            JSON.stringify({
              version: 1,
              generation,
              legacyGeneration: shared?.selection.legacyGeneration ?? null,
              body: null,
            }),
          );
          failedGenerationWrite = undefined;
          failedBodyWrite = undefined;
          if (shared !== undefined) {
            const { generation: previous, bodyVersion } = shared.selection;
            globalThis.localStorage.removeItem(bodyKey(previous));
            if (bodyVersion !== undefined) {
              globalThis.localStorage.removeItem(rejectedKey(previous, bodyVersion));
            }
          }
        } catch {
          // This runtime can still use the new cookie without shared storage.
        }
      }
      return generation;
    },
    get current(): CommittedBody | null | undefined {
      return read().body;
    },
    save,
    selected,
    isCurrent,
    rejectSelection,
    watches(keyChanged: string | null) {
      return (
        key !== undefined &&
        (keyChanged === null || keyChanged === key || keyChanged === legacySessionKey)
      );
    },
  };
}

export type BodySelectionStore = Awaited<ReturnType<typeof bodySelectionStore>>;
