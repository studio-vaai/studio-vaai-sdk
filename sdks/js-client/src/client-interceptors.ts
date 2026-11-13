import type { StudioVaaiClient } from "./client.js";

type ClientInterceptor = (client: StudioVaaiClient) => StudioVaaiClient;

const interceptors: ClientInterceptor[] = [];

/**
 * Register a function that wraps every {@link StudioVaaiClient} before it is passed to the actor.
 * The registered `fn` runs when {@link applyClientInterceptors} is invoked inside `StudioVaaiProvider`.
 *
 * Returns an uninstall function that removes the interceptor.
 */
export function installClientInterceptor(fn: ClientInterceptor): () => void {
  interceptors.push(fn);
  return () => {
    const i = interceptors.indexOf(fn);
    if (i !== -1) {
      interceptors.splice(i, 1);
    }
  };
}

/**
 * Apply all registered interceptors to `client` in insertion order.
 * Called by `StudioVaaiProvider` (react-headless) at actor creation time.
 */
export function applyClientInterceptors(client: StudioVaaiClient): StudioVaaiClient {
  return interceptors.reduce((c, fn) => fn(c), client);
}
