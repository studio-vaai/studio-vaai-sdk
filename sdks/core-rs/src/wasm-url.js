// Keep this tiny asset locator unbundled. The consuming application's bundler must see
// the original new URL(..., import.meta.url) so it can copy and fingerprint the WASM.
// oxlint-disable-next-line unicorn/relative-url-style -- Consumer bundlers recognize this relative asset URL.
export const wasmUrl = new URL("./studio_vaai_core.wasm", import.meta.url);
