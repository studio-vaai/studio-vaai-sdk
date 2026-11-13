/** Axes that say which garment a variant is, not which size of it. */
const NOT_SIZE_AXES: ReadonlySet<string> = new Set(["colorway", "template"]);

/**
 * The single string that names one size, in the shop's own ids: `colorway` and `template` dropped,
 * then `size` first and the remaining axes alphabetically, values joined with ` / `. Equal for
 * every variant of the same size, so it joins variants, recommendations and try-on rejections.
 *
 * `{ size: "M" }` gives `M`; `{ colorway: "A100-259", size: "27", style: "30" }` gives `27 / 30`.
 */
export function sizeKeyOf(foreignIds: Readonly<Record<string, string>>): string {
  const axes = Object.keys(foreignIds)
    .filter((axis) => !NOT_SIZE_AXES.has(axis))
    .toSorted((a, b) => {
      if (a === "size" || b === "size") {
        return Number(b === "size") - Number(a === "size");
      }
      return a < b ? -1 : 1;
    });
  return axes.map((axis) => foreignIds[axis]).join(" / ");
}
