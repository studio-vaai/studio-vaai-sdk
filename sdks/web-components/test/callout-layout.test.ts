import { describe, expect, it } from "vitest";

import type {
  CalloutBox,
  FitLayout,
  LayoutArea,
  Rect,
} from "../src/screens/try-on-view/callout-layout.js";

import {
  fadeLeader,
  leaderPath,
  pathsCross,
  placeFitCallouts,
  placeFitLegend,
  stackColumn,
} from "../src/screens/try-on-view/callout-layout.js";
import { fitOverlayStyles } from "../src/screens/try-on-view/fit-overlay-styles.js";

/** A 640 × 600 desktop frame with the download button in the top-right corner. */
const desktop: LayoutArea = {
  left: 8,
  right: 632,
  top: 12,
  bottom: 554,
  gap: 10,
  clearance: 16,
  keepOut: [{ left: 592, top: 12, right: 628, bottom: 48 }],
};

/** A person as bands: head, shoulders and arms, hips, legs. */
function person(center: number, scale = 1): Rect[] {
  const band = (top: number, bottom: number, half: number) => ({
    top,
    bottom,
    left: center - half * scale,
    right: center + half * scale,
  });
  return [band(40, 110, 32), band(110, 330, 78), band(330, 420, 60), band(420, 560, 44)];
}

function card(x: number, y: number, width = 124, height = 46): CalloutBox {
  return { point: { x, y }, width, height };
}

function rectOf(layout: FitLayout, callouts: readonly CalloutBox[], index: number): Rect {
  const placed = layout.cards.at(index)!;
  const { width, height } = callouts.at(index)!;
  return { left: placed.x, top: placed.y, right: placed.x + width, bottom: placed.y + height };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Every card is inside the area, clear of the person, the keep-out areas and each other. */
function expectClear(layout: FitLayout, callouts: readonly CalloutBox[], subject: Rect[]) {
  expect(layout.clear).toBe(true);
  const rects = callouts.map((_, index) => rectOf(layout, callouts, index));
  for (const [index, rect] of rects.entries()) {
    expect(rect.left).toBeGreaterThanOrEqual(desktop.left - 0.5);
    expect(rect.right).toBeLessThanOrEqual(desktop.right + 0.5);
    expect(rect.top).toBeGreaterThanOrEqual(desktop.top - 0.5);
    expect(rect.bottom).toBeLessThanOrEqual(desktop.bottom + 0.5);
    for (const band of subject) {
      expect(overlaps(rect, band), `card ${String(index)} covers the person`).toBe(false);
    }
    for (const keepOut of desktop.keepOut ?? []) {
      expect(overlaps(rect, keepOut), `card ${String(index)} covers the button`).toBe(false);
    }
    for (const other of rects.slice(index + 1)) {
      expect(overlaps(rect, other)).toBe(false);
    }
  }
}

/** Leaders in one column never cross: their cards keep their anchors' order. */
function expectOrdered(layout: FitLayout, callouts: readonly CalloutBox[]) {
  for (const side of ["left", "right"] as const) {
    const column = callouts
      .map((callout, index) => ({ callout, placed: layout.cards.at(index)! }))
      .filter(({ placed }) => placed.side === side);
    // Every pair keeps its anchors' order, so no two leaders cross.
    for (const a of column) {
      for (const b of column) {
        if (a.callout.point.y < b.callout.point.y) {
          expect(a.placed.y).toBeLessThan(b.placed.y);
        }
      }
    }
  }
}

describe("fit callout layout", () => {
  it("places a front view's callouts beside the person, on their anchors' sides", () => {
    const subject = person(320);
    const callouts = [
      card(242, 200), // chest, left outline
      card(398, 300), // sleeve, right cuff
      card(376, 330), // length, right hem corner
    ];
    const layout = placeFitCallouts(callouts, desktop, subject);
    expect(layout.kind).toBe("columns");
    expectClear(layout, callouts, subject);
    expectOrdered(layout, callouts);
    expect(layout.cards.map(({ side }) => side)).toEqual(["left", "right", "right"]);
    // Each card sits beside the person, a clearance from the widest point beside it, and further
    // out when its anchor is on that edge: the leader keeps 40 px (24 px before its fade).
    expect(layout.cards.at(0)!.x + 124).toBeCloseTo(242 - 40);
    // A card level with its anchor gets a straight, horizontal leader.
    const start = layout.cards.at(0)!.path.at(0)!;
    const end = layout.cards.at(0)!.path.at(1);
    expect(start.y).toBe(200);
    expect(end).toEqual({ x: 242, y: 200 });
  });

  it("sends an off-centre person's callouts to the side with room", () => {
    const subject = person(130);
    // The left sleeve's anchor has no room beside it; its other sleeve does.
    const sleeve = { ...card(52, 300), alternates: [{ x: 208, y: 300 }] };
    const callouts = [card(208, 200), sleeve, card(186, 360)];
    const layout = placeFitCallouts(callouts, desktop, subject);
    expectClear(layout, callouts, subject);
    expect(layout.cards.every(({ side }) => side === "right")).toBe(true);
    expect(layout.cards.at(1)!.anchor).toEqual({ x: 208, y: 300 });
    expect(layout.cards.at(1)!.path.at(-1)).toEqual({ x: 208, y: 300 });
  });

  it("never sends an outline anchor's card across the person; it reports instead", () => {
    // The chest anchor sits on the left outline of a person at the left edge.
    const subject = person(130);
    const layout = placeFitCallouts([card(52, 200)], desktop, subject);
    expect(layout.clear).toBe(false);
    expect(layout.cards.at(0)!.side).toBe("left");
  });

  it("swaps cards pushed below an obstacle so their leaders do not cross", () => {
    // Arms out: no room beside either anchor, so both cards go below the hands.
    const arms: Rect[] = [
      { top: 100, bottom: 330, left: 80, right: 560 },
      { top: 330, bottom: 560, left: 270, right: 370 },
    ];
    const callouts = [card(240, 300), card(90, 320)];
    const layout = placeFitCallouts(callouts, desktop, arms);
    expect(layout.clear).toBe(true);
    expect(pathsCross(layout.cards.at(0)!.path, layout.cards.at(1)!.path)).toBe(false);
  });

  it("puts a side view's two sleeve-side callouts in one column, in anchor order", () => {
    // Side view: a narrow body, both arms on the right.
    const subject = person(300, 0.6);
    const callouts = [card(272, 190), card(346, 240), card(342, 300), card(280, 380)];
    const layout = placeFitCallouts(callouts, desktop, subject);
    expectClear(layout, callouts, subject);
    expectOrdered(layout, callouts);
    const right = layout.cards.filter(({ side }) => side === "right");
    expect(right).toHaveLength(2);
  });

  it("spreads five crowded callouts with the minimum gap and keeps their order", () => {
    const subject = person(320);
    const callouts = [
      card(242, 180),
      card(398, 185),
      card(242, 195),
      card(398, 200),
      card(276, 205),
    ];
    const layout = placeFitCallouts(callouts, desktop, subject);
    expectClear(layout, callouts, subject);
    expectOrdered(layout, callouts);
    const left = callouts
      .map((_, index) => rectOf(layout, callouts, index))
      .filter((_, index) => layout.cards.at(index)!.side === "left");
    // Any card below another keeps at least the gap to it.
    for (const upper of left) {
      for (const lower of left) {
        if (lower.top > upper.top) {
          expect(lower.top - upper.bottom).toBeGreaterThanOrEqual(desktop.gap - 0.5);
        }
      }
    }
  });

  it("keeps the right column below the download button", () => {
    const subject = person(320);
    const callouts = [card(398, 30)];
    const layout = placeFitCallouts(callouts, desktop, subject);
    expect(layout.cards.at(0)!.y).toBeGreaterThanOrEqual(48 + desktop.gap);
  });

  it("reports a narrow frame filled by the person, so the caller can fall back", () => {
    const narrow: LayoutArea = { ...desktop, right: 232, keepOut: [] };
    const subject = person(120, 1.2);
    const callouts = [card(26, 200), card(214, 260), card(190, 380)];
    expect(placeFitCallouts(callouts, narrow, subject).clear).toBe(false);

    // The legend lists compact cards above or below the person when no side strip has room.
    const compact = callouts.map(({ point }) => ({ point, width: 70, height: 30 }));
    const standing = person(120, 1.2).map((band) => ({ ...band, top: band.top + 140 }));
    const legend = placeFitLegend(compact, narrow, standing);
    expect(legend.kind).toBe("legend");
    expect(legend.clear).toBe(true);
    for (const [index, placed] of legend.cards.entries()) {
      expect(placed.path).toEqual([]);
      const rect = rectOf(legend, compact, index);
      for (const band of standing) {
        expect(overlaps(rect, band)).toBe(false);
      }
    }
  });

  it("uses a free side strip for the legend when there is one", () => {
    const subject = person(400, 0.8);
    const compact = [80, 200, 330].map((y) => ({ point: { x: 400, y }, width: 90, height: 30 }));
    const legend = placeFitLegend(compact, desktop, subject);
    expect(legend.clear).toBe(true);
    // Listed top to bottom in anchor order, in the wider left strip.
    const ys = legend.cards.map(({ y }) => y);
    for (const [index, y] of ys.entries()) {
      expect(y).toBeLessThanOrEqual(ys.at(index + 1) ?? y);
    }
    expect(legend.cards.every(({ side }) => side === "left")).toBe(true);
  });

  it("assumes a body around the anchors when the result has no outline", () => {
    const callouts = [card(270, 200), card(370, 300)];
    const layout = placeFitCallouts(callouts, desktop);
    expect(layout.cards.at(0)!.side).toBe("left");
    expect(layout.cards.at(1)!.side).toBe("right");
  });
});

describe("column stacking", () => {
  it("keeps cards on their anchors when they do not collide", () => {
    expect(
      stackColumn(
        [
          { center: 100, height: 40 },
          { center: 300, height: 40 },
        ],
        0,
        500,
        10,
      ),
    ).toEqual([80, 280]);
  });

  it("centres a colliding pair on its anchors", () => {
    expect(
      stackColumn(
        [
          { center: 200, height: 40 },
          { center: 210, height: 40 },
        ],
        0,
        500,
        10,
      ),
    ).toEqual([160, 210]);
  });

  it("refuses cards taller than the room", () => {
    expect(stackColumn([{ center: 50, height: 120 }], 0, 100, 10)).toBeUndefined();
  });
});

describe("leaders", () => {
  it("runs level, then 45° into an anchor below the card", () => {
    const path = leaderPath(
      { left: 8, top: 100, right: 132, bottom: 146 },
      "left",
      { x: 200, y: 190 },
      12,
    );
    expect(path).toEqual([
      { x: 132, y: 123 },
      { x: 133, y: 123 },
      { x: 200, y: 190 },
    ]);
  });
});

describe("fading leaders", () => {
  it("keeps the first part solid and fades the last part out in equal steps", () => {
    const { solid, fade } = fadeLeader(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      0.4,
      4,
    );
    expect(solid).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
    ]);
    expect(fade.map(({ from, to }) => [from.x, to.x])).toEqual([
      [60, 70],
      [70, 80],
      [80, 90],
      [90, 100],
    ]);
    // The dash pattern runs on from where each step starts.
    expect(fade.map(({ offset }) => offset)).toEqual([60, 70, 80, 90]);
    const opacities = fade.map(({ opacity }) => opacity);
    expect(opacities).toEqual(opacities.toSorted((a, b) => b - a));
    expect(opacities[0]).toBeGreaterThan(0.8);
    expect(opacities.at(-1)).toBeLessThan(0.2);
  });

  it("fades across a bend and ends exactly on the anchor", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 40, y: 30 },
    ];
    const { solid, fade } = fadeLeader(path, 0.5, 5);
    expect(solid[0]).toEqual({ x: 0, y: 0 });
    expect(fade.at(-1)?.to).toEqual({ x: 40, y: 30 });
    const total = 10 + Math.hypot(30, 30);
    expect(fade[0]?.offset).toBeCloseTo(total / 2);
  });
});

describe("overlay styles", () => {
  const text = fitOverlayStyles.cssText;

  it("ends a laid-out leader in a white halo dot on any theme", () => {
    expect(text).toMatch(/\[data-layout="columns"\] \.anchor \{[^}]*--_sv-media-foreground/);
  });

  it("uses compact cards without a density switch", () => {
    expect(text).not.toContain("data-density");
    expect(text).toMatch(
      /\.callout sv-fit-callout::part\(label\) \{\s*font-size: calc\(var\(--_sv-root\) \* 0\.6875\)/,
    );
  });

  it("marks the length with a wide, flat tick instead of the dot, shorter on a phone", () => {
    const tick = /\[data-layout="columns"\] \.anchor\[data-marker="tick"\] \{([^}]*)\}/g;
    const [desktop, phone] = [...text.matchAll(tick)].map(([, body]) => body ?? "");
    expect(desktop).toMatch(/inline-size: calc\(var\(--_sv-spacing\) \* 5\.5\)/);
    expect(desktop).toMatch(/block-size: 3px/);
    expect(desktop).toContain("--_sv-media-overlay");
    expect(phone).toMatch(/inline-size: calc\(var\(--_sv-spacing\) \* 4\.5\)/);
  });

  it("enlarges and fully shows a pinned marker and its whole leader", () => {
    expect(text).toMatch(/\.anchor\[aria-pressed="true"\],[^{]*\{\s*opacity: 1;\s*scale: 1\.75;/);
    expect(text).toMatch(
      /\.anchor\[data-marker="tick"\]\[aria-pressed="true"\],[^{]*\{\s*scale: 1\.35 1\.75;/,
    );
    expect(text).toMatch(
      /\.annotation:has\(\.callout\[data-active\]\) \.leader-fade line \{\s*opacity: 1;/,
    );
  });
});

describe("leader length", () => {
  it("moves a card hugging its anchor out until the leader reads before it fades", () => {
    // The anchor sits right at the person's edge, so the hugging card would leave ~16 px.
    const subject: Rect[] = [{ top: 100, bottom: 500, left: 300, right: 420 }];
    const callouts = [card(300, 300)];
    const layout = placeFitCallouts(callouts, desktop, subject);
    expect(layout.clear).toBe(true);
    const path = layout.cards.at(0)!.path;
    const length = path
      .slice(1)
      .reduce((sum, p, i) => sum + Math.hypot(p.x - path.at(i)!.x, p.y - path.at(i)!.y), 0);
    // 24 px solid before the last 40 % fades.
    expect(length).toBeGreaterThanOrEqual(40 - 0.5);
  });

  it("keeps a short leader when the frame has no room to move the card", () => {
    const narrow: LayoutArea = { ...desktop, left: 8, keepOut: [] };
    // 8 px margin + 124 px card + 16 px clearance: the card cannot move further out.
    const subject: Rect[] = [{ top: 100, bottom: 500, left: 148, right: 420 }];
    const layout = placeFitCallouts([card(150, 300)], narrow, subject);
    expect(layout.cards.at(0)!.x).toBe(8);
  });
});
