interface Renewal {
  request: AbortController;
  pending: Promise<void>;
  consumers: number;
}

/** Shares a renewal until it settles or its last consumer leaves. */
export function imageRenewal() {
  const active = new Map<string | object, Renewal>();

  return {
    async renew(
      key: string | object,
      refresh: (signal: AbortSignal) => Promise<void>,
      signal?: AbortSignal,
    ): Promise<void> {
      signal?.throwIfAborted();
      let renewal = active.get(key);
      if (renewal === undefined) {
        const request = new AbortController();
        const pending = (async () => {
          // Register the shared request before invoking the adapter.
          await Promise.resolve();
          try {
            request.signal.throwIfAborted();
            await refresh(request.signal);
          } finally {
            if (active.get(key)?.request === request) {
              active.delete(key);
            }
          }
        })();
        renewal = { request, pending, consumers: 0 };
        active.set(key, renewal);
      }

      renewal.consumers += 1;
      const cancelled = Promise.withResolvers<never>();
      const abort = () => {
        cancelled.reject(signal?.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await Promise.race([renewal.pending, cancelled.promise]);
        signal?.throwIfAborted();
      } finally {
        signal?.removeEventListener("abort", abort);
        renewal.consumers -= 1;
        if (renewal.consumers === 0 && active.get(key) === renewal) {
          active.delete(key);
          renewal.request.abort();
        }
      }
    },
    clear(): void {
      for (const { request } of active.values()) {
        request.abort();
      }
      active.clear();
    },
  };
}
