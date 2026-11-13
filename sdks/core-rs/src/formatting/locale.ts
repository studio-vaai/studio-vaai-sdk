/** Normalize caller BCP 47 input before WASM is ready. Invalid input uses English. */
export function canonicalizeLocale(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale.replaceAll("_", "-"))[0] ?? "en";
  } catch {
    return "en";
  }
}
