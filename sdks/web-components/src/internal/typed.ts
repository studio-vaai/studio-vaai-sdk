/**
 * Typed `Object.keys` / `Object.fromEntries` for the closed `as const` token objects in this
 * package. TypeScript widens both to `string`; for objects whose keys are fixed at compile time
 * the narrow type is exact, so the two assertions live here once instead of at every call.
 */
export function typedKeys<T extends object>(object: T): (keyof T & string)[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys of a closed const object
  return Object.keys(object) as (keyof T & string)[];
}

export function typedFromEntries<K extends string, V>(entries: Iterable<[K, V]>): Record<K, V> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- callers pass every key of K
  return Object.fromEntries(entries) as Record<K, V>;
}
