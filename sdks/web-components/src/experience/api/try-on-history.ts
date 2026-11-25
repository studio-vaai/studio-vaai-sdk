import type { BodyId, ProductId, TryOnId, VariantId } from "@studio-vaai/core";

/** A try-on the shopper made, enough to ask the API for it again. */
export interface RememberedTryOn {
  tryOnId: TryOnId;
  productId: ProductId;
  variantId: VariantId;
  /** The backend's revision of the body it read. */
  backendRevision: string;
}

interface StoredHistory {
  version: 1;
  bodyId: BodyId;
  tryOns: RememberedTryOn[];
}

/** The most try-ons kept per body: the domain keeps no more results than this either. */
export const TRY_ON_HISTORY_LIMIT = 24;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isRemembered(value: unknown): value is RememberedTryOn {
  return (
    typeof value === "object" &&
    value !== null &&
    "tryOnId" in value &&
    typeof value.tryOnId === "string" &&
    "productId" in value &&
    typeof value.productId === "string" &&
    "variantId" in value &&
    typeof value.variantId === "string" &&
    "backendRevision" in value &&
    typeof value.backendRevision === "string"
  );
}

/**
 * The try-ons of the shopper's current body, kept in this browser so a page reload that restores
 * the session can show them again: the API lists bodies, but no try-ons. Shared by the shop's
 * tabs, keyed by API and shop like the body selection. Storage failures leave it empty.
 */
export async function tryOnHistoryStore(baseUrl: string, clientKey: string) {
  const digest = await globalThis.crypto?.subtle?.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([baseUrl.replace(/\/+$/u, ""), clientKey])),
  );
  const key =
    digest === undefined
      ? undefined
      : `sv.tryOn.history.${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

  function read(): StoredHistory | undefined {
    if (key === undefined) {
      return undefined;
    }
    try {
      const raw = storage()?.getItem(key);
      const value: unknown = raw === null || raw === undefined ? undefined : JSON.parse(raw);
      if (
        typeof value === "object" &&
        value !== null &&
        "version" in value &&
        value.version === 1 &&
        "bodyId" in value &&
        typeof value.bodyId === "string" &&
        "tryOns" in value &&
        Array.isArray(value.tryOns)
      ) {
        return { version: 1, bodyId: value.bodyId, tryOns: value.tryOns.filter(isRemembered) };
      }
    } catch {
      // Unreadable history is no history.
    }
    return undefined;
  }

  function write(history?: StoredHistory): void {
    if (key === undefined) {
      return;
    }
    try {
      if (history === undefined) {
        storage()?.removeItem(key);
      } else {
        storage()?.setItem(key, JSON.stringify(history));
      }
    } catch {
      // Without storage a reload starts without earlier try-ons.
    }
  }

  return {
    /** Keeps a try-on of `bodyId`, forgetting those of any other body. */
    remember(bodyId: BodyId, tryOn: RememberedTryOn): void {
      const current = read();
      const kept = current?.bodyId === bodyId ? current.tryOns : [];
      const tryOns = [...kept.filter(({ tryOnId }) => tryOnId !== tryOn.tryOnId), tryOn].slice(
        -TRY_ON_HISTORY_LIMIT,
      );
      write({ version: 1, bodyId, tryOns });
    },
    /** The try-ons kept for `bodyId`, oldest first. */
    of(bodyId: BodyId): RememberedTryOn[] {
      const current = read();
      return current?.bodyId === bodyId ? current.tryOns : [];
    },
    /** Forgets a try-on the API no longer has. */
    forget(tryOnId: TryOnId): void {
      const current = read();
      if (current !== undefined) {
        write({ ...current, tryOns: current.tryOns.filter((kept) => kept.tryOnId !== tryOnId) });
      }
    },
    clear(): void {
      write();
    },
  };
}

export type TryOnHistoryStore = Awaited<ReturnType<typeof tryOnHistoryStore>>;
