type Axes = Readonly<Record<string, string>>;

export interface SizeComparisonData {
  "product-id": string;
  measure: "tried" | "cart";
  "recommended-size"?: string;
  "observed-size"?: string;
  "recommended-length"?: string;
  "observed-length"?: string;
}

const catalogKey = (value: string | undefined): value is string =>
  value !== undefined && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u.test(value);

/** Size coordinates only. Color and template do not make a size a second try. */
export function sizeComparison(
  productId: string,
  measure: "tried" | "cart",
  observed: Axes,
  recommended: Axes = {},
): SizeComparisonData {
  const size = observed["size"] ?? observed["waist"];
  const rec = recommended["size"] ?? recommended["waist"];
  const length = observed["length"] ?? observed["style"];
  const recLength = recommended["length"] ?? recommended["style"];
  return {
    "product-id": productId,
    measure,
    ...(catalogKey(rec) && { "recommended-size": rec }),
    ...(catalogKey(size) && { "observed-size": size }),
    ...(catalogKey(recLength) && { "recommended-length": recLength }),
    ...(catalogKey(length) && { "observed-length": length }),
  };
}
