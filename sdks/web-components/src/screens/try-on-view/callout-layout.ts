/**
 * Where the fit callouts go on a try-on image: beside the person, never over them.
 *
 * Pure geometry in overlay pixels, so every case is a unit test. The person is known from the
 * result's subject bands (their outline, garment included, as horizontal bands); results from
 * before the bands existed fall back to a generous box around the anchors.
 *
 * 1. A measurement with anchors on both sides (the sleeves) points at the first anchor with room
 *    for its card beside it.
 * 2. Each callout takes the side of the person its anchor is on. Only an anchor near the person's
 *    middle may cross to the other side, so no leader runs across the whole person.
 * 3. A card sits level with its anchor where the person leaves room, else at the nearest height
 *    that does (above or below arms held out), never further than a quarter of the frame away.
 * 4. Each side is a column in anchor order with a minimum gap: cards that would overlap centre on
 *    their anchors as a block, or are pushed past the person in order. Neighbours whose leaders
 *    would cross each other or the other card swap places.
 * 5. A column hugs the person: its cards align on their inner edges, a clearance away from the
 *    widest part of the person beside them, within the safe insets and clear of keep-out areas
 *    (the download button).
 * 6. Leaders run horizontally when the anchor is level with the card, vertically when it is
 *    straight above or below, else level out of the card and then 45° into the anchor. Their
 *    last stretch fades out ({@link fadeLeader}) into a halo dot on the garment's panel, where
 *    the anchor sits, so crossing the garment's edge to reach it reads lightly.
 * 7. When the columns do not fit (a narrow phone, a person filling the frame),
 *    {@link placeFitLegend} numbers the anchors and lists the cards in the largest free area.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One measured card at its anchor. */
export interface CalloutBox {
  point: Point;
  width: number;
  height: number;
  /**
   * The same measurement's other anchors (the other sleeve), tried in order when the card has
   * no room beside `point`.
   */
  alternates?: readonly Point[] | undefined;
}

export interface LayoutArea extends Rect {
  /** Minimum vertical gap between two cards. */
  gap: number;
  /** Minimum distance between a card and the person. */
  clearance: number;
  /** Areas cards must not cover, such as the download button. */
  keepOut?: readonly Rect[] | undefined;
}

export type Side = "left" | "right";

interface PlacedCallout {
  /** The card's top-left corner. */
  x: number;
  y: number;
  side: Side;
  /** The anchor the card points at: its `point`, or the alternate it moved to. */
  anchor: Point;
  /** The leader from the card's edge to the anchor; empty in a legend. */
  path: Point[];
}

export interface FitLayout {
  kind: "columns" | "legend";
  /** In the input order. */
  cards: PlacedCallout[];
  /** False when the cards could not avoid the person or each other. */
  clear: boolean;
}

/** A tolerance for rounding in measured sizes. */
const EPSILON = 0.5;

function overlapsVertically(a: { top: number; bottom: number }, top: number, bottom: number) {
  return a.top < bottom && a.bottom > top;
}

/** The person's horizontal extent between two heights, or undefined where they are absent. */
function subjectSpan(
  subject: readonly Rect[],
  top: number,
  bottom: number,
): { left: number; right: number } | undefined {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const band of subject) {
    if (overlapsVertically(band, top, bottom)) {
      left = Math.min(left, band.left);
      right = Math.max(right, band.right);
    }
  }
  return Number.isFinite(left) ? { left, right } : undefined;
}

/**
 * Without the person's outline, assume a body around the anchors: from the top of the frame to
 * the bottom, a sixth of the frame wider than the anchors on each side.
 */
function assumedSubject(points: readonly Point[], area: Rect): Rect[] {
  if (points.length === 0) {
    return [];
  }
  const xs = points.map(({ x }) => x);
  const pad = (area.right - area.left) / 6;
  return [
    {
      left: Math.min(...xs) - pad,
      right: Math.max(...xs) + pad,
      top: area.top,
      bottom: area.bottom,
    },
  ];
}

/** Room for a card beside the person, from the safe edge to the clearance line. */
function room(subject: readonly Rect[], area: LayoutArea, side: Side, top: number, bottom: number) {
  const span = subjectSpan(subject, top, bottom);
  if (span === undefined) {
    return area.right - area.left;
  }
  return side === "left"
    ? span.left - area.clearance - area.left
    : area.right - (span.right + area.clearance);
}

/** The step, in pixels, of the search for a height with room for a card. */
const SEARCH_STEP = 4;
/** The share of a leader's length that fades out towards its anchor. */
export const FADE_FRACTION = 0.4;
/** The least solid leader before the fade, in pixels, where the card has room to keep it. */
const MIN_SOLID_LEADER = 24;
/** The least whole leader length that leaves {@link MIN_SOLID_LEADER} before the fade. */
const MIN_LEADER_LENGTH = MIN_SOLID_LEADER / (1 - FADE_FRACTION);

/** A polyline's length. */
function pathLength(path: readonly Point[]): number {
  return path.slice(1).reduce((sum, point, index) => {
    const previous = path[index] ?? point;
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
}

/** How far a card may move off its anchor's height, as a share of the area's height. */
const MAX_SHIFT = 0.25;

/**
 * The card centre nearest `center` at which a card fits beside the person on `side`, or
 * undefined when it fits nowhere on that side. Arms held out leave no room level with the cuffs,
 * so a sleeve's card moves just above or below them.
 */
function nearestRoom(
  subject: readonly Rect[],
  area: LayoutArea,
  side: Side,
  width: number,
  height: number,
  center: number,
): number | undefined {
  const low = area.top + height / 2;
  const high = area.bottom - height / 2;
  if (low > high) {
    return undefined;
  }
  const start = Math.min(Math.max(center, low), high);
  const fitsAt = (y: number) =>
    width <= room(subject, area, side, y - height / 2, y + height / 2) + EPSILON;
  for (let offset = 0; start - offset >= low || start + offset <= high; offset += SEARCH_STEP) {
    for (const y of [start + offset, start - offset]) {
      if (y >= low && y <= high && fitsAt(y)) {
        return y;
      }
    }
  }
  return undefined;
}

/** The middle of the person, which divides the two columns. */
function subjectMiddle(subject: readonly Rect[], points: readonly Point[]): number {
  const span = subjectSpan(subject, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
  if (span !== undefined) {
    return (span.left + span.right) / 2;
  }
  const xs = points.map(({ x }) => x);
  return (Math.min(...xs) + Math.max(...xs)) / 2;
}

/**
 * Stack cards in order between `top` and `bottom`, at least `gap` apart, each only where
 * `fitsAt(index, top)` allows (beside the person): first pushing cards down from their preferred
 * tops, then, if the column runs out at the bottom, pushing them up from the bottom. Undefined
 * when neither works.
 */
function fitColumn(
  preferred: readonly { top: number; height: number }[],
  top: number,
  bottom: number,
  gap: number,
  fitsAt: (index: number, top: number) => boolean,
): number[] | undefined {
  const down: number[] = [];
  let next = top;
  for (const [index, item] of preferred.entries()) {
    let y = Math.max(item.top, next);
    while (y + item.height <= bottom + EPSILON && !fitsAt(index, y)) {
      y += SEARCH_STEP;
    }
    if (y + item.height > bottom + EPSILON) {
      break;
    }
    down.push(y);
    next = y + item.height + gap;
  }
  if (down.length === preferred.length) {
    return down;
  }
  const up: number[] = [];
  next = bottom;
  for (const [index, item] of [...preferred.entries()].toReversed()) {
    let y = Math.min(item.top, next - item.height);
    while (y >= top - EPSILON && !fitsAt(index, y)) {
      y -= SEARCH_STEP;
    }
    if (y < top - EPSILON) {
      return undefined;
    }
    up.unshift(y);
    next = y - gap;
  }
  return up;
}

/**
 * Stack cards in anchor order between `top` and `bottom` with at least `gap` between them, each
 * as close to its anchor as it can be. Overlapping neighbours merge into a block centred on their
 * anchors. Returns undefined when the cards are taller than the room.
 */
export function stackColumn(
  preferred: readonly { center: number; height: number }[],
  top: number,
  bottom: number,
  gap: number,
): number[] | undefined {
  const total =
    preferred.reduce((sum, { height }) => sum + height, 0) +
    gap * Math.max(0, preferred.length - 1);
  if (total > bottom - top + EPSILON) {
    return undefined;
  }
  interface Block {
    first: number;
    last: number;
    top: number;
    height: number;
  }
  const blockOf = (first: number, last: number): Block => {
    const items = preferred.slice(first, last + 1);
    const height = items.reduce((sum, item) => sum + item.height, 0) + gap * (items.length - 1);
    // Centre the block so its cards' displacements from their anchors sum to zero.
    let offset = 0;
    let wanted = 0;
    for (const item of items) {
      wanted += item.center - (offset + item.height / 2);
      offset += item.height + gap;
    }
    const start = wanted / items.length;
    return {
      first,
      last,
      top: Math.min(Math.max(start, top), bottom - height),
      height,
    };
  };
  const blocks: Block[] = [];
  for (const index of preferred.keys()) {
    let block = blockOf(index, index);
    // Merge backwards while the new block overlaps the one before it.
    for (let before = blocks.pop(); before !== undefined; before = blocks.pop()) {
      if (before.top + before.height + gap <= block.top + EPSILON) {
        blocks.push(before);
        break;
      }
      block = blockOf(before.first, block.last);
    }
    blocks.push(block);
  }
  return blocks.flatMap((block) => {
    let y = block.top;
    return preferred.slice(block.first, block.last + 1).map(({ height }) => {
      const at = y;
      y += height + gap;
      return at;
    });
  });
}

/** The top of a column after keep-out areas in its horizontal range. */
function columnTop(area: LayoutArea, left: number, right: number): number {
  let { top } = area;
  for (const rect of area.keepOut ?? []) {
    if (rect.left < right && rect.right > left && rect.top <= area.top + area.gap) {
      top = Math.max(top, rect.bottom + area.gap);
    }
  }
  return top;
}

/** The leader from a card's inner edge to its anchor: level, or level then 45°. */
export function leaderPath(card: Rect, side: Side, anchor: Point, radius: number): Point[] {
  // An anchor straight above or below the card: a vertical leader from that edge.
  if (
    anchor.x >= card.left + radius &&
    anchor.x <= card.right - radius &&
    (anchor.y < card.top || anchor.y > card.bottom)
  ) {
    return [{ x: anchor.x, y: anchor.y < card.top ? card.top : card.bottom }, anchor];
  }
  const x = side === "left" ? card.right : card.left;
  // Leave the card at the anchor's height when the card spans it, else at the card's middle.
  const y =
    anchor.y >= card.top + radius && anchor.y <= card.bottom - radius
      ? anchor.y
      : (card.top + card.bottom) / 2;
  const start = { x, y };
  const rise = Math.abs(anchor.y - y);
  const run = Math.abs(anchor.x - x);
  if (rise < EPSILON || run < EPSILON) {
    return [start, anchor];
  }
  if (rise >= run) {
    return [start, anchor];
  }
  const direction = side === "left" ? 1 : -1;
  return [start, { x: anchor.x - direction * rise, y }, anchor];
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const turn = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = turn(c, d, a);
  const d2 = turn(c, d, b);
  const d3 = turn(a, b, c);
  const d4 = turn(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Whether two leaders cross (touching ends do not count). */
export function pathsCross(a: readonly Point[], b: readonly Point[]): boolean {
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      const [p, q, r, s] = [a[i - 1], a[i], b[j - 1], b[j]];
      if (p && q && r && s && segmentsCross(p, q, r, s)) {
        return true;
      }
    }
  }
  return false;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** The first leader in a column that crosses the one below it, or -1. */
function pathHitsRect(path: readonly Point[], rect: Rect): boolean {
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  const outline = [...corners, corners[0] ?? { x: rect.left, y: rect.top }];
  const inside = ({ x, y }: Point) =>
    x > rect.left + EPSILON &&
    x < rect.right - EPSILON &&
    y > rect.top + EPSILON &&
    y < rect.bottom - EPSILON;
  return path.some((point) => inside(point)) || pathsCross(path, outline);
}

/**
 * The first card in a column whose leader crosses the next card's leader or card, or whose card
 * the next leader crosses; -1 when none does.
 */
function firstCrossing(
  column: readonly (PlacedCallout & { width: number; height: number })[],
): number {
  const rectOf = (card: PlacedCallout & { width: number; height: number }) => ({
    left: card.x,
    top: card.y,
    right: card.x + card.width,
    bottom: card.y + card.height,
  });
  return column.findIndex((card, order) => {
    const below = column[order + 1];
    return (
      below !== undefined &&
      (pathsCross(card.path, below.path) ||
        pathHitsRect(card.path, rectOf(below)) ||
        pathHitsRect(below.path, rectOf(card)))
    );
  });
}

/** The two-column layout, or the most legible attempt with `clear: false`. */
export function placeFitCallouts(
  boxes: readonly CalloutBox[],
  area: LayoutArea,
  subject: readonly Rect[] = assumedSubject(
    boxes.map(({ point }) => point),
    area,
  ),
): FitLayout {
  if (boxes.length === 0) {
    return { kind: "columns", cards: [], clear: true };
  }
  const middle = subjectMiddle(
    subject,
    boxes.map(({ point }) => point),
  );
  const ownSide = ({ x }: Point): Side => (x < middle ? "left" : "right");
  // A card may move off its anchor's height to clear the person, but not so far that its
  // leader becomes a long diagonal across the photo.
  const reach = (area.bottom - area.top) * MAX_SHIFT;
  const roomAt = (box: CalloutBox, point: Point, side: Side) => {
    const y = nearestRoom(subject, area, side, box.width, box.height, point.y);
    return y !== undefined && Math.abs(y - point.y) <= reach ? y : undefined;
  };
  // Each measurement points at the first of its anchors with room for its card beside it.
  const callouts: CalloutBox[] = boxes.map((box) => ({
    ...box,
    point:
      [box.point, ...(box.alternates ?? [])].find(
        (point) => roomAt(box, point, ownSide(point)) !== undefined,
      ) ?? box.point,
  }));
  const roomFor = (callout: CalloutBox, side: Side) => roomAt(callout, callout.point, side);
  const fits = (callout: CalloutBox, side: Side) => roomFor(callout, side) !== undefined;
  // Only an anchor near the person's middle may take a card on the far side: a leader from an
  // anchor on the far outline would cross the whole person.
  const central = (callout: CalloutBox) => {
    const span = subjectSpan(subject, callout.point.y - 1, callout.point.y + 1);
    return (
      span === undefined ||
      Math.abs(callout.point.x - (span.left + span.right) / 2) <= (span.right - span.left) / 4
    );
  };
  const sides: Side[] = callouts.map((callout) => {
    const own: Side = callout.point.x < middle ? "left" : "right";
    const other: Side = own === "left" ? "right" : "left";
    return !fits(callout, own) && central(callout) && fits(callout, other) ? other : own;
  });

  /** One column, its cards stacked in the given order. */
  const column = (members: readonly (CalloutBox & { index: number })[], side: Side) => {
    const placed: (PlacedCallout & { index: number; width: number; height: number })[] = [];
    let clear = true;
    const widest = Math.max(...members.map(({ width }) => width));
    const outer = side === "left" ? area.left : area.right;
    const top = columnTop(
      area,
      side === "left" ? outer : outer - widest,
      side === "left" ? outer + widest : outer,
    );
    // Each card as near its anchor as the person leaves room for it: centred on the anchors
    // where that keeps every card beside the person, else pushed past the obstacles in order.
    const centers = members.map((member) => roomFor(member, side) ?? member.point.y);
    const fitsAt = (order: number, y: number) => {
      const member = members[order];
      return (
        member !== undefined &&
        Math.abs(y + member.height / 2 - member.point.y) <= reach &&
        member.width <= room(subject, area, side, y, y + member.height) + EPSILON
      );
    };
    let stacked = stackColumn(
      members.map(({ height }, order) => ({ center: centers[order] ?? 0, height })),
      top,
      area.bottom,
      area.gap,
    );
    if (stacked === undefined || !stacked.every((y, order) => fitsAt(order, y))) {
      stacked = fitColumn(
        members.map(({ height }, order) => ({ top: (centers[order] ?? 0) - height / 2, height })),
        top,
        area.bottom,
        area.gap,
        fitsAt,
      );
    }
    // Taller than the room: stack from the top and let the check below report it.
    let next = top;
    const placedMembers = members.map((member, order) => {
      const y = stacked?.[order] ?? next;
      next = y + member.height + area.gap;
      return { ...member, y };
    });
    // One inner edge for the column: a clearance from the person's widest point beside it,
    // or the safe edge where the person is not beside the column at all.
    const edges = placedMembers.flatMap(({ y, height }) => {
      const span = subjectSpan(subject, y, y + height);
      if (span === undefined) {
        return [];
      }
      return [side === "left" ? span.left - area.clearance : span.right + area.clearance];
    });
    let line: number | undefined;
    if (edges.length > 0) {
      line = side === "left" ? Math.min(...edges) : Math.max(...edges);
    }
    const xAt = (member: { width: number }, edge: number | undefined) =>
      side === "left"
        ? Math.max(area.left, (edge ?? area.left + member.width) - member.width)
        : Math.min(area.right - member.width, edge ?? area.right - member.width);
    const leaderAt = (member: (typeof placedMembers)[number], edge: number | undefined) => {
      const x = xAt(member, edge);
      return leaderPath(
        { left: x, top: member.y, right: x + member.width, bottom: member.y + member.height },
        side,
        member.point,
        Math.min(12, member.height / 4),
      );
    };
    // A card hugging its anchor would leave almost no leader: move the column out, where room
    // allows, until every leader is long enough to read before it fades.
    for (let attempt = 0; attempt < 3 && line !== undefined; attempt += 1) {
      const edge: number = line;
      const deficit = Math.max(
        ...placedMembers.map((member) => MIN_LEADER_LENGTH - pathLength(leaderAt(member, edge))),
      );
      if (deficit <= EPSILON) {
        break;
      }
      line = side === "left" ? edge - deficit : edge + deficit;
    }
    for (const member of placedMembers) {
      const { y } = member;
      const x = xAt(member, line);
      const card = { left: x, top: y, right: x + member.width, bottom: y + member.height };
      const span = subjectSpan(subject, card.top, card.bottom);
      if (
        card.bottom > area.bottom + EPSILON ||
        Math.abs((card.top + card.bottom) / 2 - member.point.y) > reach + EPSILON ||
        card.top < area.top - EPSILON ||
        (span !== undefined &&
          card.left < span.right + area.clearance - EPSILON &&
          card.right > span.left - area.clearance + EPSILON) ||
        (area.keepOut ?? []).some((rect) => rectsOverlap(rect, card))
      ) {
        clear = false;
      }
      placed.push({
        index: member.index,
        width: member.width,
        height: member.height,
        x,
        y,
        side,
        anchor: member.point,
        path: leaderPath(card, side, member.point, Math.min(12, member.height / 4)),
      });
    }
    return { placed, clear };
  };

  const place = (assignment: readonly Side[]) => {
    const cards: PlacedCallout[] = Array.from({ length: callouts.length });
    let clear = true;
    for (const side of ["left", "right"] as const) {
      const members = callouts
        .map((callout, index) => ({ ...callout, index }))
        .filter(({ index }) => assignment[index] === side)
        .toSorted((a, b) => a.point.y - b.point.y || a.point.x - b.point.x);
      if (members.length === 0) {
        continue;
      }
      // Cards pushed off their anchors' heights can cross leaders: swap such neighbours.
      let result = column(members, side);
      for (let attempt = 0; attempt < members.length * members.length; attempt += 1) {
        const crossing = firstCrossing(result.placed);
        if (crossing === -1) {
          break;
        }
        const swapped = [...members];
        const [upper, lower] = [swapped[crossing], swapped[crossing + 1]];
        if (upper === undefined || lower === undefined) {
          break;
        }
        swapped[crossing] = lower;
        swapped[crossing + 1] = upper;
        const next = column(swapped, side);
        if (next.clear !== result.clear && !next.clear) {
          break;
        }
        members.splice(0, members.length, ...swapped);
        result = next;
      }
      clear &&= result.clear;
      for (const { index, x, y, side: placedSide, anchor, path } of result.placed) {
        cards[index] = { x, y, side: placedSide, anchor, path };
      }
    }
    return { cards, clear };
  };

  const first = place(sides);
  // A column too full for its side sends the central callouts nearest the middle across, one
  // at a time, while the other side has room for them.
  if (first.clear) {
    return { kind: "columns", ...first };
  }
  const assignment = [...sides];
  for (const _ of callouts) {
    const counts = { left: 0, right: 0 };
    for (const side of assignment) {
      counts[side] += 1;
    }
    const full: Side = counts.left >= counts.right ? "left" : "right";
    const other: Side = full === "left" ? "right" : "left";
    const current = [...assignment];
    const [moved] = callouts
      .map((callout, index) => ({ callout, index }))
      .filter(
        ({ callout, index }) => current[index] === full && central(callout) && fits(callout, other),
      )
      .toSorted(
        (a, b) => Math.abs(a.callout.point.x - middle) - Math.abs(b.callout.point.x - middle),
      );
    if (moved === undefined || counts[full] <= 1) {
      break;
    }
    assignment[moved.index] = other;
    const next = place(assignment);
    if (next.clear) {
      return { kind: "columns", ...next };
    }
  }
  return { kind: "columns", ...first };
}

/**
 * The fallback: the anchors carry numbers and the cards stand as a list in the largest area free
 * of the person: a side strip, else the strip above or below them, else along the bottom edge
 * (the only case that may cover the person).
 */
export function placeFitLegend(
  callouts: readonly CalloutBox[],
  area: LayoutArea,
  subject: readonly Rect[] = assumedSubject(
    callouts.map(({ point }) => point),
    area,
  ),
): FitLayout {
  const order = callouts
    .map((callout, index) => ({ ...callout, index }))
    .toSorted((a, b) => a.point.y - b.point.y || a.point.x - b.point.x);
  const subjectTop = Math.min(...subject.map(({ top }) => top), area.bottom);
  const subjectBottom = Math.max(...subject.map(({ bottom }) => bottom), area.top);
  const widest = Math.max(0, ...callouts.map(({ width }) => width));
  const column = callouts.reduce(
    (sum, { height }, index) => sum + height + (index === 0 ? 0 : area.gap),
    0,
  );
  const cards: PlacedCallout[] = Array.from({ length: callouts.length });
  const anchorOf = (index: number) => callouts[index]?.point ?? { x: 0, y: 0 };
  // A side strip: the stretch of height, nearest the anchors, where the whole list has room
  // beside the person (below outstretched arms, say).
  const anchorsMiddle =
    callouts.reduce((sum, { point }) => sum + point.y, 0) / Math.max(1, callouts.length);
  let best: { side: Side; top: number; distance: number } | undefined;
  for (const side of ["left", "right"] as const) {
    const outer = side === "left" ? area.left : area.right;
    const top = columnTop(
      area,
      side === "left" ? outer : outer - widest,
      side === "left" ? outer + widest : outer,
    );
    let runTop: number | undefined;
    for (let y = top; y <= area.bottom; y += SEARCH_STEP) {
      const free =
        y + SEARCH_STEP <= area.bottom + EPSILON &&
        widest <= room(subject, area, side, y, y + SEARCH_STEP) + EPSILON;
      if (free) {
        runTop ??= y;
        continue;
      }
      const runBottom = Math.min(y, area.bottom);
      if (runTop !== undefined && runBottom - runTop >= column - EPSILON) {
        const start = Math.min(Math.max(anchorsMiddle - column / 2, runTop), runBottom - column);
        const distance = Math.abs(start + column / 2 - anchorsMiddle);
        if (best === undefined || distance < best.distance) {
          best = { side, top: start, distance };
        }
      }
      runTop = undefined;
    }
  }
  if (best !== undefined) {
    let y = best.top;
    for (const item of order) {
      cards[item.index] = {
        x: best.side === "left" ? area.left : area.right - item.width,
        y,
        side: best.side,
        anchor: item.point,
        path: [],
      };
      y += item.height + area.gap;
    }
    return { kind: "legend", cards, clear: true };
  }
  // Rows above or below the person, wrapping as needed; else rows along the bottom edge.
  const rows = (top: number, bottom: number) => {
    const placed: { index: number; x: number; y: number; width: number; height: number }[] = [];
    let x = area.left;
    let y = top;
    let rowHeight = 0;
    for (const item of order) {
      if (x > area.left && x + item.width > area.right + EPSILON) {
        x = area.left;
        y += rowHeight + area.gap;
        rowHeight = 0;
      }
      placed.push({ index: item.index, x, y, width: item.width, height: item.height });
      x += item.width + area.gap;
      rowHeight = Math.max(rowHeight, item.height);
    }
    const height = y + rowHeight - top;
    return { placed, height, fits: height <= bottom - top + EPSILON };
  };
  const above = {
    top: columnTop(area, area.left, area.right),
    bottom: subjectTop - area.clearance,
  };
  const below = { top: subjectBottom + area.clearance, bottom: area.bottom };
  for (const [strip, anchorEnd] of [
    [below, true],
    [above, false],
  ] as const) {
    const layout = rows(strip.top, strip.bottom);
    if (layout.fits) {
      const shift = anchorEnd ? strip.bottom - (strip.top + layout.height) : 0;
      for (const { index, x, y } of layout.placed) {
        cards[index] = { x, y: y + shift, side: "left", anchor: anchorOf(index), path: [] };
      }
      return { kind: "legend", cards, clear: true };
    }
  }
  const layout = rows(area.top, area.bottom);
  const shift = area.bottom - (area.top + layout.height);
  for (const { index, x, y } of layout.placed) {
    cards[index] = {
      x,
      y: y + Math.max(0, shift),
      side: "left",
      anchor: anchorOf(index),
      path: [],
    };
  }
  return { kind: "legend", cards, clear: false };
}

/** One step of a leader's fading end. */
export interface FadeStep {
  from: Point;
  to: Point;
  /** The leader's length before this step, so a dash pattern runs on unbroken. */
  offset: number;
  /** From just under 1 at the start of the fade to near 0 at the anchor. */
  opacity: number;
}

/**
 * Split a leader into its solid part and a fading end: the last `fraction` of its length, in
 * `steps` equal steps of falling opacity. Stepping keeps the fade to plain lines, which every
 * browser draws alike, instead of a gradient referenced by id across shadow roots.
 */
export function fadeLeader(
  path: readonly Point[],
  fraction: number,
  steps: number,
): { solid: Point[]; fade: FadeStep[] } {
  const lengths = path.slice(1).map((point, index) => {
    const previous = path[index] ?? point;
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total < EPSILON || steps < 1) {
    return { solid: [...path], fade: [] };
  }
  /** The point `distance` along the path. */
  const at = (distance: number): Point => {
    let walked = 0;
    for (const [index, length] of lengths.entries()) {
      const from = path[index];
      const to = path[index + 1];
      if (from !== undefined && to !== undefined && walked + length >= distance) {
        const t = length < EPSILON ? 0 : (distance - walked) / length;
        return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      }
      walked += length;
    }
    return path.at(-1) ?? { x: 0, y: 0 };
  };
  const start = total * (1 - Math.min(Math.max(fraction, 0), 1));
  // The solid part: every corner before the fade starts, then the fade's first point.
  const solid: Point[] = [];
  let walked = 0;
  for (const [index, point] of path.entries()) {
    if (walked >= start) {
      break;
    }
    solid.push(point);
    walked += lengths[index] ?? 0;
  }
  solid.push(at(start));
  const step = (total - start) / steps;
  const fade = Array.from({ length: steps }, (_, index) => ({
    from: at(start + index * step),
    to: at(start + (index + 1) * step),
    offset: start + index * step,
    opacity: 1 - (index + 0.5) / steps,
  }));
  return { solid, fade };
}
