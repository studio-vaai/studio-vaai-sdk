// The fit callouts' layout, the web's `callout-layout.ts` cases on the Dart
// port: cards beside the person, leaders that do not cross and read before
// they fade, and the numbered legend when the columns do not fit.
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/src/ui/callout_layout.dart';

/// A 640 × 600 desktop frame with the download button in the top-right corner.
const desktop = LayoutArea(
  left: 8,
  right: 632,
  top: 12,
  bottom: 554,
  gap: 10,
  clearance: 16,
  keepOut: [Rect.fromLTRB(592, 12, 628, 48)],
);

LayoutArea areaWith(LayoutArea a, {double? right, double? left, List<Rect>? keepOut}) => LayoutArea(
  left: left ?? a.left,
  right: right ?? a.right,
  top: a.top,
  bottom: a.bottom,
  gap: a.gap,
  clearance: a.clearance,
  keepOut: keepOut ?? a.keepOut,
);

/// A person as bands: head, shoulders and arms, hips, legs.
List<Rect> person(double center, [double scale = 1]) {
  Rect band(double top, double bottom, double half) =>
      Rect.fromLTRB(center - half * scale, top, center + half * scale, bottom);
  return [band(40, 110, 32), band(110, 330, 78), band(330, 420, 60), band(420, 560, 44)];
}

CalloutBox card(double x, double y, {double width = 124, double height = 46}) =>
    CalloutBox(point: Offset(x, y), width: width, height: height);

Rect rectOf(FitLayout layout, List<CalloutBox> callouts, int i) =>
    Rect.fromLTWH(layout.cards[i].x, layout.cards[i].y, callouts[i].width, callouts[i].height);

void expectClear(FitLayout layout, List<CalloutBox> callouts, List<Rect> subject) {
  expect(layout.clear, isTrue);
  final rects = [for (var i = 0; i < callouts.length; i++) rectOf(layout, callouts, i)];
  for (final (i, rect) in rects.indexed) {
    expect(rect.left, greaterThanOrEqualTo(desktop.left - 0.5));
    expect(rect.right, lessThanOrEqualTo(desktop.right + 0.5));
    expect(rect.top, greaterThanOrEqualTo(desktop.top - 0.5));
    expect(rect.bottom, lessThanOrEqualTo(desktop.bottom + 0.5));
    for (final band in subject) {
      expect(rect.overlaps(band), isFalse, reason: 'card $i covers the person');
    }
    for (final keepOut in desktop.keepOut) {
      expect(rect.overlaps(keepOut), isFalse, reason: 'card $i covers the button');
    }
    for (final other in rects.skip(i + 1)) {
      expect(rect.overlaps(other), isFalse);
    }
  }
}

void expectOrdered(FitLayout layout, List<CalloutBox> callouts) {
  for (final side in CalloutSide.values) {
    final column = [
      for (final (i, c) in callouts.indexed)
        if (layout.cards[i].side == side) (callout: c, placed: layout.cards[i]),
    ];
    for (final a in column) {
      for (final b in column) {
        if (a.callout.point.dy < b.callout.point.dy) {
          expect(a.placed.y, lessThan(b.placed.y));
        }
      }
    }
  }
}

double lengthOf(List<Offset> path) {
  var sum = 0.0;
  for (var i = 1; i < path.length; i++) {
    sum += (path[i] - path[i - 1]).distance;
  }
  return sum;
}

void main() {
  group('fit callout layout', () {
    test("places a front view's callouts beside the person, on their anchors' sides", () {
      final subject = person(320);
      final callouts = [card(242, 200), card(398, 300), card(376, 330)];
      final layout = placeFitCallouts(callouts, desktop, subject);
      expect(layout.kind, FitLayoutKind.columns);
      expectClear(layout, callouts, subject);
      expectOrdered(layout, callouts);
      expect(layout.cards.map((c) => c.side), [
        CalloutSide.left,
        CalloutSide.right,
        CalloutSide.right,
      ]);
      // A clearance from the person, and further out at an edge anchor: 40 px leaders.
      expect(layout.cards[0].x + 124, closeTo(242 - 40, 0.01));
      expect(layout.cards[0].path.first.dy, 200);
      expect(layout.cards[0].path[1], const Offset(242, 200));
    });

    test("sends an off-centre person's callouts to the side with room", () {
      final subject = person(130);
      const sleeve = CalloutBox(
        point: Offset(52, 300),
        width: 124,
        height: 46,
        alternates: [Offset(208, 300)],
      );
      final callouts = [card(208, 200), sleeve, card(186, 360)];
      final layout = placeFitCallouts(callouts, desktop, subject);
      expectClear(layout, callouts, subject);
      expect(layout.cards.every((c) => c.side == CalloutSide.right), isTrue);
      expect(layout.cards[1].anchor, const Offset(208, 300));
      expect(layout.cards[1].path.last, const Offset(208, 300));
    });

    test("never sends an outline anchor's card across the person; it reports instead", () {
      final layout = placeFitCallouts([card(52, 200)], desktop, person(130));
      expect(layout.clear, isFalse);
      expect(layout.cards[0].side, CalloutSide.left);
    });

    test('swaps cards pushed below an obstacle so their leaders do not cross', () {
      const arms = [Rect.fromLTRB(80, 100, 560, 330), Rect.fromLTRB(270, 330, 370, 560)];
      final layout = placeFitCallouts([card(240, 300), card(90, 320)], desktop, arms);
      expect(layout.clear, isTrue);
      expect(pathsCross(layout.cards[0].path, layout.cards[1].path), isFalse);
    });

    test('spreads five crowded callouts with the minimum gap and keeps their order', () {
      final subject = person(320);
      final callouts = [
        card(242, 180),
        card(398, 185),
        card(242, 195),
        card(398, 200),
        card(276, 205),
      ];
      final layout = placeFitCallouts(callouts, desktop, subject);
      expectClear(layout, callouts, subject);
      expectOrdered(layout, callouts);
    });

    test('keeps the right column below the download button', () {
      final layout = placeFitCallouts([card(398, 30)], desktop, person(320));
      expect(layout.cards[0].y, greaterThanOrEqualTo(48 + desktop.gap));
    });

    test('reports a narrow frame filled by the person; the legend lists cards around them', () {
      final narrow = areaWith(desktop, right: 232, keepOut: []);
      final callouts = [card(26, 200), card(214, 260), card(190, 380)];
      expect(placeFitCallouts(callouts, narrow, person(120, 1.2)).clear, isFalse);
      final compact = [for (final c in callouts) CalloutBox(point: c.point, width: 70, height: 30)];
      final standing = [for (final b in person(120, 1.2)) b.translate(0, 140)];
      final legend = placeFitLegend(compact, narrow, standing);
      expect(legend.kind, FitLayoutKind.legend);
      expect(legend.clear, isTrue);
      for (final (i, placed) in legend.cards.indexed) {
        expect(placed.path, isEmpty);
        for (final band in standing) {
          expect(rectOf(legend, compact, i).overlaps(band), isFalse);
        }
      }
    });

    test('assumes a body around the anchors when the result has no outline', () {
      final layout = placeFitCallouts([card(270, 200), card(370, 300)], desktop);
      expect(layout.cards[0].side, CalloutSide.left);
      expect(layout.cards[1].side, CalloutSide.right);
    });

    test('moves a card hugging its anchor out until the leader reads before it fades', () {
      const subject = [Rect.fromLTRB(300, 100, 420, 500)];
      final layout = placeFitCallouts([card(300, 300)], desktop, subject);
      expect(layout.clear, isTrue);
      expect(lengthOf(layout.cards[0].path), greaterThanOrEqualTo(minLeaderLength - 0.5));
    });

    test('keeps a short leader when the frame has no room to move the card', () {
      final narrow = areaWith(desktop, keepOut: []);
      const subject = [Rect.fromLTRB(148, 100, 420, 500)];
      final layout = placeFitCallouts([card(150, 300)], narrow, subject);
      expect(layout.cards[0].x, 8);
    });
  });

  group('column stacking', () {
    test('keeps cards on their anchors when they do not collide', () {
      expect(stackColumn([(center: 100, height: 40), (center: 300, height: 40)], 0, 500, 10), [
        80,
        280,
      ]);
    });
    test('centres a colliding pair on its anchors', () {
      expect(stackColumn([(center: 200, height: 40), (center: 210, height: 40)], 0, 500, 10), [
        160,
        210,
      ]);
    });
    test('refuses cards taller than the room', () {
      expect(stackColumn([(center: 50, height: 120)], 0, 100, 10), isNull);
    });
  });

  group('leaders', () {
    test('run level, then 45° into an anchor below the card', () {
      expect(
        leaderPath(
          const Rect.fromLTRB(8, 100, 132, 146),
          CalloutSide.left,
          const Offset(200, 190),
          12,
        ),
        [const Offset(132, 123), const Offset(133, 123), const Offset(200, 190)],
      );
    });

    test('keep the first part solid and fade the last 40% out in equal steps', () {
      final (:solid, :fade) = fadeLeader([Offset.zero, const Offset(100, 0)], 0.4, 4);
      expect(solid, [Offset.zero, const Offset(60, 0)]);
      expect(
        [for (final s in fade) (s.from.dx, s.to.dx)],
        [(60, 70), (70, 80), (80, 90), (90, 100)],
      );
      expect([for (final s in fade) s.offset], [60, 70, 80, 90]);
      final opacities = [for (final s in fade) s.opacity];
      expect(opacities, [...opacities]..sort((a, b) => b.compareTo(a)));
      expect(opacities.first, greaterThan(0.8));
      expect(opacities.last, lessThan(0.2));
    });

    test('fade across a bend and end exactly on the anchor', () {
      final (:solid, :fade) = fadeLeader(
        [Offset.zero, const Offset(10, 0), const Offset(40, 30)],
        0.5,
        5,
      );
      expect(solid.first, Offset.zero);
      expect(fade.last.to, const Offset(40, 30));
      expect(fade.first.offset, closeTo((10 + math.sqrt(1800)) / 2, 1e-9));
    });
  });
}
