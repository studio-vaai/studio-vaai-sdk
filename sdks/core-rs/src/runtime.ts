import { uniffiInitAsync } from "../build/wasm2/index.js";
import { wasmUrl } from "./wasm-url.js";

let initialization: Promise<void> | undefined;

async function load(source: URL | Uint8Array): Promise<void> {
  try {
    let bytes: Uint8Array | ArrayBuffer = source instanceof URL ? new Uint8Array() : source;
    if (source instanceof URL) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`SDK WASM request failed (${response.status}).`);
      }
      bytes = await response.arrayBuffer();
    }
    await uniffiInitAsync(bytes);
  } catch (error) {
    initialization = undefined;
    throw error;
  }
}

/** Initialize once; a host can supply bytes or its own asset URL (including in Node). */
export async function initializeCore(source: URL | Uint8Array = wasmUrl): Promise<void> {
  initialization ??= load(source);
  await initialization;
}
