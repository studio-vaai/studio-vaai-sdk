import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Shared test vectors for logic both the web and the Flutter SDK implement: the fit callouts'
// layout (`callout-layout.ts`, Flutter's `callout_layout.dart`) and the fit gate's note
// (`gate-note.ts`, Flutter's `gateNoteMessage`). This test computes every case with the web's
// code and compares it with sdks/flutter/test/shared_vectors/fit_overlay.json, which the Flutter
// test replays (sdks/flutter/test/shared_vectors_test.dart). Regenerate the file from the web's
// code with UPDATE_SHARED_VECTORS=1.
import type { GateNoteInput } from "../src/experience/gate-note.js";
import type {
  CalloutBox,
  FitLayout,
  LayoutArea,
  Point,
  Rect,
} from "../src/screens/try-on-view/callout-layout.js";

import { gateNote } from "../src/experience/gate-note.js";
import {
  fadeLeader,
  leaderPath,
  placeFitCallouts,
  placeFitLegend,
  stackColumn,
} from "../src/screens/try-on-view/callout-layout.js";

const file = resolve(import.meta.dirname, "../../flutter/test/shared_vectors/fit_overlay.json");

/** Numbers rounded to 0.01 px, so both sides compare within rounding. */
function round(value: unknown): unknown {
  if (typeof value === "number") {
    return Math.round(value * 100) / 100;
  }
  if (Array.isArray(value)) {
    return value.map((item) => round(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, round(item)]));
  }
  return value;
}

type Xy = [number, number];
type Ltrb = [number, number, number, number];
const xy = ({ x, y }: Point): Xy => [x, y];
const rect = ([left, top, right, bottom]: Ltrb): Rect => ({ left, top, right, bottom });

interface LayoutCase {
  name: string;
  fn: "columns" | "legend";
  boxes: { point: Xy; width: number; height: number; alternates?: Xy[] }[];
  area: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    gap: number;
    clearance: number;
    keepOut: Ltrb[];
  };
  subject: Ltrb[] | null;
}

/** A 640 × 600 desktop frame with the download button in the top-right corner. */
const desktop: LayoutCase["area"] = {
  left: 8,
  right: 632,
  top: 12,
  bottom: 554,
  gap: 10,
  clearance: 16,
  keepOut: [[592, 12, 628, 48]],
};
/** A phone's stage: 358 × 520, the download button at the top right. */
const phone: LayoutCase["area"] = {
  left: 8,
  right: 350,
  top: 12,
  bottom: 474,
  gap: 10,
  clearance: 16,
  keepOut: [[298, 12, 346, 60]],
};

/** A person as bands: head, shoulders and arms, hips, legs. */
function person(center: number, scale = 1, shift = 0): Ltrb[] {
  const band = (top: number, bottom: number, half: number): Ltrb => [
    center - half * scale,
    top + shift,
    center + half * scale,
    bottom + shift,
  ];
  return [band(40, 110, 32), band(110, 330, 78), band(330, 420, 60), band(420, 560, 44)];
}

const card = (x: number, y: number, width = 124, height = 46) => ({
  point: [x, y] as Xy,
  width,
  height,
});

const layoutCases: LayoutCase[] = [
  {
    name: "front view beside the person",
    fn: "columns",
    boxes: [card(242, 200), card(398, 300), card(376, 330)],
    area: desktop,
    subject: person(320),
  },
  {
    name: "off-centre person, the other sleeve",
    fn: "columns",
    boxes: [card(208, 200), { ...card(52, 300), alternates: [[208, 300]] }, card(186, 360)],
    area: desktop,
    subject: person(130),
  },
  {
    name: "outline anchor without room reports",
    fn: "columns",
    boxes: [card(52, 200)],
    area: desktop,
    subject: person(130),
  },
  {
    name: "arms out, swapped below the hands",
    fn: "columns",
    boxes: [card(240, 300), card(90, 320)],
    area: desktop,
    subject: [
      [80, 100, 560, 330],
      [270, 330, 370, 560],
    ],
  },
  {
    name: "side view, one column in anchor order",
    fn: "columns",
    boxes: [card(272, 190), card(346, 240), card(342, 300), card(280, 380)],
    area: desktop,
    subject: person(300, 0.6),
  },
  {
    name: "five crowded callouts",
    fn: "columns",
    boxes: [card(242, 180), card(398, 185), card(242, 195), card(398, 200), card(276, 205)],
    area: desktop,
    subject: person(320),
  },
  {
    name: "right column below the download button",
    fn: "columns",
    boxes: [card(398, 30)],
    area: desktop,
    subject: person(320),
  },
  {
    name: "no outline: a body assumed around the anchors",
    fn: "columns",
    boxes: [card(270, 200), card(370, 300)],
    area: desktop,
    subject: null,
  },
  {
    name: "a hugging card moves out for a readable leader",
    fn: "columns",
    boxes: [card(300, 300)],
    area: desktop,
    subject: [[300, 100, 420, 500]],
  },
  {
    name: "no room to move: a short leader",
    fn: "columns",
    boxes: [card(150, 300)],
    area: { ...desktop, keepOut: [] },
    subject: [[148, 100, 420, 500]],
  },
  {
    name: "phone, compact cards on both sides",
    fn: "columns",
    boxes: [card(150, 150, 96, 40), card(222, 240, 96, 40), card(176, 300, 84, 40)],
    area: phone,
    subject: person(180, 0.85),
  },
  {
    name: "phone, a person filling the frame",
    fn: "columns",
    boxes: [card(120, 150, 110, 40), card(250, 240, 110, 40)],
    area: phone,
    subject: person(180, 1.6),
  },
  {
    name: "legend: a free side strip",
    fn: "legend",
    boxes: [80, 200, 330].map((y) => card(400, y, 90, 30)),
    area: desktop,
    subject: person(400, 0.8),
  },
  {
    name: "legend: below a standing person",
    fn: "legend",
    boxes: [card(26, 200, 70, 30), card(214, 260, 70, 30), card(190, 380, 70, 30)],
    area: { ...desktop, right: 232, keepOut: [] },
    subject: person(120, 1.2, 140),
  },
  {
    name: "legend: the bottom edge when nothing is free",
    fn: "legend",
    boxes: [card(100, 100, 150, 40), card(200, 300, 150, 40), card(150, 450, 150, 40)],
    area: { ...desktop, right: 300, keepOut: [] },
    subject: [[0, 0, 300, 600]],
  },
];

function runLayout({ fn, boxes, area, subject }: LayoutCase): FitLayout {
  const callouts: CalloutBox[] = boxes.map(({ point: [x, y], width, height, alternates }) => ({
    point: { x, y },
    width,
    height,
    alternates: alternates?.map(([ax, ay]) => ({ x: ax, y: ay })),
  }));
  const layoutArea: LayoutArea = { ...area, keepOut: area.keepOut.map((r) => rect(r)) };
  const bands = subject === null ? globalThis.undefined : subject.map((r) => rect(r));
  return fn === "columns"
    ? placeFitCallouts(callouts, layoutArea, bands)
    : placeFitLegend(callouts, layoutArea, bands);
}

const stackCases: { preferred: [number, number][]; top: number; bottom: number; gap: number }[] = [
  {
    preferred: [
      [100, 40],
      [300, 40],
    ],
    top: 0,
    bottom: 500,
    gap: 10,
  },
  {
    preferred: [
      [200, 40],
      [210, 40],
    ],
    top: 0,
    bottom: 500,
    gap: 10,
  },
  { preferred: [[50, 120]], top: 0, bottom: 100, gap: 10 },
  {
    preferred: [
      [20, 40],
      [30, 40],
      [480, 40],
    ],
    top: 0,
    bottom: 500,
    gap: 10,
  },
  {
    preferred: [
      [490, 40],
      [495, 40],
    ],
    top: 0,
    bottom: 500,
    gap: 10,
  },
];

const leaderCases: { card: Ltrb; side: "left" | "right"; anchor: Xy; radius: number }[] = [
  { card: [8, 100, 132, 146], side: "left", anchor: [200, 190], radius: 12 },
  { card: [8, 100, 132, 146], side: "left", anchor: [200, 123], radius: 12 },
  { card: [400, 300, 524, 346], side: "right", anchor: [300, 200], radius: 12 },
  { card: [100, 300, 224, 346], side: "left", anchor: [150, 200], radius: 12 },
  { card: [100, 300, 224, 346], side: "right", anchor: [160, 420], radius: 12 },
];

const fadeCases: { path: Xy[]; fraction: number; steps: number }[] = [
  {
    path: [
      [0, 0],
      [100, 0],
    ],
    fraction: 0.4,
    steps: 4,
  },
  {
    path: [
      [0, 0],
      [10, 0],
      [40, 30],
    ],
    fraction: 0.5,
    steps: 5,
  },
  {
    path: [
      [132, 123],
      [133, 123],
      [200, 190],
    ],
    fraction: 0.4,
    steps: 8,
  },
  {
    path: [
      [5, 5],
      [5, 5],
    ],
    fraction: 0.4,
    steps: 8,
  },
];

const gateNoteCases: GateNoteInput[] = [
  { requested: "M", next: "L", choosing: true },
  { warning: "too-small", requested: "M", next: "L", choosing: true },
  { warning: "too-large", requested: "L", next: "M", choosing: true },
  { warning: "too-small", requested: "M", next: "L", choosing: false },
  { warning: "too-large", requested: "L", next: "M", choosing: false },
  { warning: "too-small", requested: "XL", choosing: true },
  { warning: "too-large", requested: "XS", choosing: false },
  { switched: "too-small", requested: "XS", next: "S", choosing: true },
  { switched: "too-large", requested: "XXL", next: "XL", choosing: false },
  { warning: "too-large", switched: "too-small", requested: "M", next: "S", choosing: true },
  { switched: "too-small", requested: "34 / 32", next: "36 / 32", choosing: true },
];

describe("shared vectors", () => {
  it("are the web's results, as the Flutter SDK replays them", async () => {
    const document = round({
      comment:
        "Generated by sdks/web-components/test/shared-vectors.test.ts (UPDATE_SHARED_VECTORS=1); replayed by sdks/flutter/test/shared_vectors_test.dart.",
      layout: layoutCases.map((input) => {
        const { kind, clear, cards } = runLayout(input);
        return {
          input,
          output: {
            kind,
            clear,
            cards: cards.map(({ x, y, side, anchor, path }) => ({
              x,
              y,
              side,
              anchor: xy(anchor),
              path: path.map((p) => xy(p)),
            })),
          },
        };
      }),
      stack: stackCases.map((input) => ({
        input,
        output:
          stackColumn(
            input.preferred.map(([center, height]) => ({ center, height })),
            input.top,
            input.bottom,
            input.gap,
          ) ?? null,
      })),
      leader: leaderCases.map((input) => ({
        input,
        output: leaderPath(
          rect(input.card),
          input.side,
          { x: input.anchor[0], y: input.anchor[1] },
          input.radius,
        ).map((p) => xy(p)),
      })),
      fade: fadeCases.map((input) => {
        const { solid, fade } = fadeLeader(
          input.path.map(([x, y]) => ({ x, y })),
          input.fraction,
          input.steps,
        );
        return {
          input,
          output: {
            solid: solid.map((p) => xy(p)),
            fade: fade.map(({ from, to, offset, opacity }) => ({
              from: xy(from),
              to: xy(to),
              offset,
              opacity,
            })),
          },
        };
      }),
      gateNote: gateNoteCases.map((input) => ({ input, output: gateNote(input) ?? null })),
    });
    if (process.env.UPDATE_SHARED_VECTORS === "1") {
      await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
    }
    const expected = JSON.parse(await readFile(file, "utf8")) as unknown;
    expect(document).toEqual(expected);
  });
});
