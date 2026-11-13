import type { HttpTransport } from "../build/wasm2/api.js";

import { TransportError } from "../build/wasm2/api.js";

export function browserTransport(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  keepalive = false,
  operation?: AbortSignal,
): HttpTransport {
  return {
    async send(request, options) {
      const headers = new Headers(request.headers.map(({ name, value }) => [name, value]));
      const call = options?.signal;
      const signal =
        operation !== undefined && call !== undefined
          ? AbortSignal.any([operation, call])
          : (operation ?? call);
      if (signal?.aborted === true) {
        throw new TransportError.NotSent({
          reason: "The API request was cancelled before sending.",
        });
      }
      const cancelled = Promise.withResolvers<never>();
      const abort = () => {
        cancelled.reject(signal?.reason);
      };
      const send = async () => {
        const response = await fetchImpl(request.url, {
          method: request.method,
          ...(keepalive && { keepalive: true, referrerPolicy: "no-referrer" }),
          headers,
          credentials:
            request.withCredentials && !headers.has("Authorization") ? "include" : "omit",
          ...(request.body && { body: request.body }),
          ...(signal && { signal }),
        });
        return {
          status: response.status,
          headers: Array.from(response.headers, ([name, value]) => ({ name, value })),
          body: await response.arrayBuffer(),
        };
      };
      try {
        signal?.addEventListener("abort", abort, { once: true });
        return await Promise.race([send(), cancelled.promise]);
      } catch {
        // A fetch error can contain a URL, including signed parameters.
        throw new TransportError.Failed({ reason: "The API request did not complete." });
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
