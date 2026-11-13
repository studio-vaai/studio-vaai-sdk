interface Point {
  x: number;
  y: number;
}

interface Callout {
  point: Point;
  width: number;
  height: number;
}

interface PositionedCallout {
  x: number;
  y: number;
  lineStart: Point;
  lineEnd: Point;
}

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  gap: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** Park cards at the photo edges, balancing the two sides around the subject. */
export function placeFitCallouts(
  callouts: readonly Callout[],
  bounds: Bounds,
): PositionedCallout[] {
  const xs = callouts.map(({ point }) => point.x);
  const center = (Math.min(...xs) + Math.max(...xs)) / 2;
  const columns: Record<"left" | "right", (Callout & { index: number })[]> = {
    left: [],
    right: [],
  };
  for (const [index, callout] of callouts.entries()) {
    columns[callout.point.x < center ? "left" : "right"].push({ ...callout, index });
  }
  const heavy = columns.left.length > columns.right.length ? "left" : "right";
  const light = heavy === "left" ? "right" : "left";
  const ordered = columns[heavy].toSorted(
    (a, b) => Math.abs(a.point.x - center) - Math.abs(b.point.x - center),
  );
  const move = Math.floor((ordered.length - columns[light].length) / 2);
  columns[light].push(...ordered.slice(0, move));
  columns[heavy] = ordered.slice(move);

  const positions: PositionedCallout[] = [];
  for (const side of ["left", "right"] as const) {
    const column = columns[side].toSorted((a, b) => a.point.y - b.point.y);
    const totalHeight = column.reduce((sum, callout) => sum + callout.height, 0);
    const room = bounds.bottom - bounds.top;
    // Tighten the spacing before allowing cards to overlap in an unusually crowded column.
    const gap = Math.min(bounds.gap, (room - totalHeight) / Math.max(1, column.length - 1));
    let nextTop = bounds.top;
    const forward = column.map((callout) => {
      const { point, width, height } = callout;
      const x = side === "left" ? bounds.left : bounds.right - width;
      let preferredY = point.y - height / 2;
      // An edge card can cover an anchor close to that same edge. Leave the point visible
      // by moving the card down (or up near the bottom), keeping the connector short.
      if (point.x >= x && point.x <= x + width) {
        const below = point.y + bounds.gap;
        const above = point.y - height - bounds.gap;
        if (below + height <= bounds.bottom) {
          preferredY = below;
        } else if (above >= bounds.top) {
          preferredY = above;
        }
      }
      const y = Math.max(nextTop, preferredY);
      nextTop = y + height + gap;
      return { ...callout, x, y };
    });
    let nextBottom = bounds.bottom;
    for (const { index, point, width, height, x, y: preferredY } of forward.toReversed()) {
      const y = clamp(preferredY, bounds.top, nextBottom - height);
      nextBottom = y - gap;

      // Intersect the center-to-anchor ray with the card, so a moved card still meets its line.
      const cx = x + width / 2;
      const cy = y + height / 2;
      const dx = point.x - cx;
      const dy = point.y - cy;
      const ratio = Math.max(1, Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2));
      positions[index] = {
        x,
        y,
        lineStart: { x: cx + dx / ratio, y: cy + dy / ratio },
        lineEnd: point,
      };
    }
  }
  return positions;
}
