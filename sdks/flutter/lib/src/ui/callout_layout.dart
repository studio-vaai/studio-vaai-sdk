// Where the fit callouts go on a try-on image: beside the person, never over
// them. A port of the web SDK's `callout-layout.ts`: pure geometry in overlay
// pixels, so every case is a unit test.
//
// The person is known from the result's subject bands (their outline, garment
// included, as horizontal bands); results without bands fall back to a
// generous box around the anchors.
//
// 1. A measurement with anchors on both sides (the sleeves) points at the
//    first anchor with room for its card beside it.
// 2. Each callout takes the side of the person its anchor is on. Only an
//    anchor near the person's middle may cross to the other side.
// 3. A card sits level with its anchor where the person leaves room, else at
//    the nearest height that does, never further than a quarter of the frame.
// 4. Each side is a column in anchor order with a minimum gap; neighbours
//    whose leaders would cross swap places.
// 5. A column hugs the person a clearance away, within the safe insets and
//    clear of keep-out areas (the download button), and moves out until each
//    leader is long enough to read before it fades.
// 6. Leaders run level, vertical, or level then 45° into the anchor; their
//    last stretch fades out ([fadeLeader]).
// 7. When the columns do not fit, [placeFitLegend] numbers the anchors and
//    lists the cards in the largest free area.
import 'dart:math' as math;
import 'dart:ui' show Offset, Rect;

/// One measured card at its anchor.
final class CalloutBox {
  const CalloutBox({
    required this.point,
    required this.width,
    required this.height,
    this.alternates = const [],
  });

  final Offset point;
  final double width, height;

  /// The same measurement's other anchors (the other sleeve), tried in order
  /// when the card has no room beside [point].
  final List<Offset> alternates;

  CalloutBox withPoint(Offset point) =>
      CalloutBox(point: point, width: width, height: height, alternates: alternates);
}

/// The area cards may use, in overlay pixels.
final class LayoutArea {
  const LayoutArea({
    required this.left,
    required this.top,
    required this.right,
    required this.bottom,
    required this.gap,
    required this.clearance,
    this.keepOut = const [],
  });

  final double left, top, right, bottom;

  /// Minimum vertical gap between two cards.
  final double gap;

  /// Minimum distance between a card and the person.
  final double clearance;

  /// Areas cards must not cover, such as the download button.
  final List<Rect> keepOut;
}

enum CalloutSide { left, right }

/// A placed card: its top-left corner, side, the anchor it points at, and
/// its leader from the card's edge to the anchor (empty in a legend).
final class PlacedCallout {
  const PlacedCallout({
    required this.x,
    required this.y,
    required this.side,
    required this.anchor,
    required this.path,
  });
  final double x, y;
  final CalloutSide side;
  final Offset anchor;
  final List<Offset> path;
}

enum FitLayoutKind { columns, legend }

final class FitLayout {
  const FitLayout(this.kind, this.cards, {required this.clear});
  final FitLayoutKind kind;

  /// In the input order.
  final List<PlacedCallout> cards;

  /// False when the cards could not avoid the person or each other.
  final bool clear;
}

/// A tolerance for rounding in measured sizes.
const _epsilon = 0.5;

/// The step, in pixels, of the search for a height with room for a card.
const _searchStep = 4.0;

/// The share of a leader's length that fades out towards its anchor.
const fadeFraction = 0.4;

/// The least solid leader before the fade, where the card has room to keep it.
const _minSolidLeader = 24.0;

/// The least whole leader length that leaves [_minSolidLeader] before the fade.
const minLeaderLength = _minSolidLeader / (1 - fadeFraction);

/// How far a card may move off its anchor's height, as a share of the height.
const _maxShift = 0.25;

bool _overlapsVertically(Rect a, double top, double bottom) => a.top < bottom && a.bottom > top;

/// The person's horizontal extent between two heights, or null where absent.
({double left, double right})? _subjectSpan(List<Rect> subject, double top, double bottom) {
  var left = double.infinity, right = double.negativeInfinity;
  for (final band in subject) {
    if (_overlapsVertically(band, top, bottom)) {
      left = math.min(left, band.left);
      right = math.max(right, band.right);
    }
  }
  return left.isFinite ? (left: left, right: right) : null;
}

/// Without the person's outline, a body around the anchors: the frame's
/// height, a sixth of the frame wider than the anchors on each side.
List<Rect> _assumedSubject(List<Offset> points, LayoutArea area) {
  if (points.isEmpty) return const [];
  final xs = points.map((p) => p.dx);
  final pad = (area.right - area.left) / 6;
  return [
    Rect.fromLTRB(xs.reduce(math.min) - pad, area.top, xs.reduce(math.max) + pad, area.bottom),
  ];
}

/// Room for a card beside the person, from the safe edge to the clearance line.
double _room(List<Rect> subject, LayoutArea area, CalloutSide side, double top, double bottom) {
  final span = _subjectSpan(subject, top, bottom);
  if (span == null) return area.right - area.left;
  return side == CalloutSide.left
      ? span.left - area.clearance - area.left
      : area.right - (span.right + area.clearance);
}

double _pathLength(List<Offset> path) {
  var sum = 0.0;
  for (var i = 1; i < path.length; i++) {
    sum += (path[i] - path[i - 1]).distance;
  }
  return sum;
}

/// The card centre nearest [center] at which a card fits beside the person
/// on [side], or null when it fits nowhere on that side.
double? _nearestRoom(
  List<Rect> subject,
  LayoutArea area,
  CalloutSide side,
  double width,
  double height,
  double center,
) {
  final low = area.top + height / 2, high = area.bottom - height / 2;
  if (low > high) return null;
  final start = center.clamp(low, high).toDouble();
  bool fitsAt(double y) =>
      width <= _room(subject, area, side, y - height / 2, y + height / 2) + _epsilon;
  for (var offset = 0.0; start - offset >= low || start + offset <= high; offset += _searchStep) {
    for (final y in [start + offset, start - offset]) {
      if (y >= low && y <= high && fitsAt(y)) return y;
    }
  }
  return null;
}

/// The middle of the person, which divides the two columns.
double _subjectMiddle(List<Rect> subject, List<Offset> points) {
  final span = _subjectSpan(subject, double.negativeInfinity, double.infinity);
  if (span != null) return (span.left + span.right) / 2;
  final xs = points.map((p) => p.dx);
  return (xs.reduce(math.min) + xs.reduce(math.max)) / 2;
}

/// Stacks cards in order between [top] and [bottom], at least [gap] apart,
/// each only where [fitsAt] allows: pushing down from their preferred tops,
/// then, if that runs out, up from the bottom. Null when neither works.
List<double>? _fitColumn(
  List<({double top, double height})> preferred,
  double top,
  double bottom,
  double gap,
  bool Function(int index, double top) fitsAt,
) {
  final down = <double>[];
  var next = top;
  for (final (index, item) in preferred.indexed) {
    var y = math.max(item.top, next);
    while (y + item.height <= bottom + _epsilon && !fitsAt(index, y)) {
      y += _searchStep;
    }
    if (y + item.height > bottom + _epsilon) break;
    down.add(y);
    next = y + item.height + gap;
  }
  if (down.length == preferred.length) return down;
  final up = <double>[];
  next = bottom;
  for (final (index, item) in preferred.indexed.toList().reversed) {
    var y = math.min(item.top, next - item.height);
    while (y >= top - _epsilon && !fitsAt(index, y)) {
      y -= _searchStep;
    }
    if (y < top - _epsilon) return null;
    up.insert(0, y);
    next = y - gap;
  }
  return up;
}

/// Stacks cards in anchor order between [top] and [bottom] with at least
/// [gap] between them, each as close to its anchor as it can be: overlapping
/// neighbours merge into a block centred on their anchors. Null when the
/// cards are taller than the room.
List<double>? stackColumn(
  List<({double center, double height})> preferred,
  double top,
  double bottom,
  double gap,
) {
  final total =
      preferred.fold<double>(0, (sum, p) => sum + p.height) +
      gap * math.max(0, preferred.length - 1);
  if (total > bottom - top + _epsilon) return null;
  ({int first, int last, double top, double height}) blockOf(int first, int last) {
    final items = preferred.sublist(first, last + 1);
    final height = items.fold<double>(0, (sum, i) => sum + i.height) + gap * (items.length - 1);
    var offset = 0.0, wanted = 0.0;
    for (final item in items) {
      wanted += item.center - (offset + item.height / 2);
      offset += item.height + gap;
    }
    final start = wanted / items.length;
    return (
      first: first,
      last: last,
      top: math.min(math.max(start, top), bottom - height),
      height: height,
    );
  }

  final blocks = <({int first, int last, double top, double height})>[];
  for (var index = 0; index < preferred.length; index++) {
    var block = blockOf(index, index);
    while (blocks.isNotEmpty) {
      final before = blocks.removeLast();
      if (before.top + before.height + gap <= block.top + _epsilon) {
        blocks.add(before);
        break;
      }
      block = blockOf(before.first, block.last);
    }
    blocks.add(block);
  }
  return [
    for (final block in blocks)
      ...() {
        var y = block.top;
        return [
          for (final item in preferred.sublist(block.first, block.last + 1))
            (() {
              final at = y;
              y += item.height + gap;
              return at;
            })(),
        ];
      }(),
  ];
}

/// The top of a column after keep-out areas in its horizontal range.
double _columnTop(LayoutArea area, double left, double right) {
  var top = area.top;
  for (final rect in area.keepOut) {
    if (rect.left < right && rect.right > left && rect.top <= area.top + area.gap) {
      top = math.max(top, rect.bottom + area.gap);
    }
  }
  return top;
}

/// The leader from a card's inner edge to its anchor: vertical, level, or
/// level then 45°.
List<Offset> leaderPath(Rect card, CalloutSide side, Offset anchor, double radius) {
  if (anchor.dx >= card.left + radius &&
      anchor.dx <= card.right - radius &&
      (anchor.dy < card.top || anchor.dy > card.bottom)) {
    return [Offset(anchor.dx, anchor.dy < card.top ? card.top : card.bottom), anchor];
  }
  final x = side == CalloutSide.left ? card.right : card.left;
  final y = anchor.dy >= card.top + radius && anchor.dy <= card.bottom - radius
      ? anchor.dy
      : (card.top + card.bottom) / 2;
  final start = Offset(x, y);
  final rise = (anchor.dy - y).abs(), run = (anchor.dx - x).abs();
  if (rise < _epsilon || run < _epsilon || rise >= run) return [start, anchor];
  final direction = side == CalloutSide.left ? 1 : -1;
  return [start, Offset(anchor.dx - direction * rise, y), anchor];
}

bool _segmentsCross(Offset a, Offset b, Offset c, Offset d) {
  double turn(Offset p, Offset q, Offset r) =>
      (q.dx - p.dx) * (r.dy - p.dy) - (q.dy - p.dy) * (r.dx - p.dx);
  return turn(c, d, a) * turn(c, d, b) < 0 && turn(a, b, c) * turn(a, b, d) < 0;
}

/// Whether two leaders cross (touching ends do not count).
bool pathsCross(List<Offset> a, List<Offset> b) {
  for (var i = 1; i < a.length; i++) {
    for (var j = 1; j < b.length; j++) {
      if (_segmentsCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

bool _pathHitsRect(List<Offset> path, Rect rect) {
  final outline = [rect.topLeft, rect.topRight, rect.bottomRight, rect.bottomLeft, rect.topLeft];
  bool inside(Offset p) =>
      p.dx > rect.left + _epsilon &&
      p.dx < rect.right - _epsilon &&
      p.dy > rect.top + _epsilon &&
      p.dy < rect.bottom - _epsilon;
  return path.any(inside) || pathsCross(path, outline);
}

typedef _Placed = ({int index, double width, double height, PlacedCallout callout});

Rect _rectOf(_Placed p) => Rect.fromLTWH(p.callout.x, p.callout.y, p.width, p.height);

/// The first card whose leader crosses the next card's leader or card, or
/// whose card the next leader crosses; -1 when none does.
int _firstCrossing(List<_Placed> column) {
  for (var order = 0; order + 1 < column.length; order++) {
    final card = column[order], below = column[order + 1];
    if (pathsCross(card.callout.path, below.callout.path) ||
        _pathHitsRect(card.callout.path, _rectOf(below)) ||
        _pathHitsRect(below.callout.path, _rectOf(card))) {
      return order;
    }
  }
  return -1;
}

/// The two-column layout, or the most legible attempt with `clear: false`.
FitLayout placeFitCallouts(List<CalloutBox> boxes, LayoutArea area, [List<Rect>? subjectBands]) {
  if (boxes.isEmpty) return const FitLayout(FitLayoutKind.columns, [], clear: true);
  final subject = subjectBands ?? _assumedSubject([for (final b in boxes) b.point], area);
  final middle = _subjectMiddle(subject, [for (final b in boxes) b.point]);
  CalloutSide ownSide(Offset p) => p.dx < middle ? CalloutSide.left : CalloutSide.right;
  final reach = (area.bottom - area.top) * _maxShift;
  double? roomAt(CalloutBox box, Offset point, CalloutSide side) {
    final y = _nearestRoom(subject, area, side, box.width, box.height, point.dy);
    return y != null && (y - point.dy).abs() <= reach ? y : null;
  }

  // Each measurement points at the first of its anchors with room beside it.
  final callouts = [
    for (final box in boxes)
      box.withPoint(
        [
              box.point,
              ...box.alternates,
            ].where((p) => roomAt(box, p, ownSide(p)) != null).firstOrNull ??
            box.point,
      ),
  ];
  double? roomFor(CalloutBox c, CalloutSide side) => roomAt(c, c.point, side);
  bool fits(CalloutBox c, CalloutSide side) => roomFor(c, side) != null;
  // Only an anchor near the person's middle may take a card on the far side.
  bool central(CalloutBox c) {
    final span = _subjectSpan(subject, c.point.dy - 1, c.point.dy + 1);
    return span == null ||
        (c.point.dx - (span.left + span.right) / 2).abs() <= (span.right - span.left) / 4;
  }

  CalloutSide otherOf(CalloutSide s) =>
      s == CalloutSide.left ? CalloutSide.right : CalloutSide.left;
  final sides = [
    for (final c in callouts)
      !fits(c, ownSide(c.point)) && central(c) && fits(c, otherOf(ownSide(c.point)))
          ? otherOf(ownSide(c.point))
          : ownSide(c.point),
  ];

  ({List<_Placed> placed, bool clear}) column(
    List<({int index, CalloutBox box})> members,
    CalloutSide side,
  ) {
    var clear = true;
    final widest = members.map((m) => m.box.width).reduce(math.max);
    final outer = side == CalloutSide.left ? area.left : area.right;
    final top = _columnTop(
      area,
      side == CalloutSide.left ? outer : outer - widest,
      side == CalloutSide.left ? outer + widest : outer,
    );
    final centers = [for (final m in members) roomFor(m.box, side) ?? m.box.point.dy];
    bool fitsAt(int order, double y) {
      final m = members[order].box;
      return (y + m.height / 2 - m.point.dy).abs() <= reach &&
          m.width <= _room(subject, area, side, y, y + m.height) + _epsilon;
    }

    var stacked = stackColumn(
      [for (final (o, m) in members.indexed) (center: centers[o], height: m.box.height)],
      top,
      area.bottom,
      area.gap,
    );
    if (stacked == null || !stacked.indexed.every((e) => fitsAt(e.$1, e.$2))) {
      stacked = _fitColumn(
        [
          for (final (o, m) in members.indexed)
            (top: centers[o] - m.box.height / 2, height: m.box.height),
        ],
        top,
        area.bottom,
        area.gap,
        fitsAt,
      );
    }
    var next = top;
    final ys = <double>[];
    for (final (o, m) in members.indexed) {
      final y = stacked?[o] ?? next;
      next = y + m.box.height + area.gap;
      ys.add(y);
    }
    // One inner edge for the column: a clearance from the person's widest
    // point beside it, or the safe edge where the person is not beside it.
    final edges = <double>[];
    for (final (o, m) in members.indexed) {
      final span = _subjectSpan(subject, ys[o], ys[o] + m.box.height);
      if (span != null) {
        edges.add(
          side == CalloutSide.left ? span.left - area.clearance : span.right + area.clearance,
        );
      }
    }
    double? line = edges.isEmpty
        ? null
        : (side == CalloutSide.left ? edges.reduce(math.min) : edges.reduce(math.max));
    double xAt(CalloutBox m, double? edge) => side == CalloutSide.left
        ? math.max(area.left, (edge ?? area.left + m.width) - m.width)
        : math.min(area.right - m.width, edge ?? area.right - m.width);
    List<Offset> leaderAt(int o, double? edge) {
      final m = members[o].box;
      final x = xAt(m, edge);
      return leaderPath(
        Rect.fromLTWH(x, ys[o], m.width, m.height),
        side,
        m.point,
        math.min(12, m.height / 4),
      );
    }

    // A card hugging its anchor leaves almost no leader: move the column out,
    // where room allows, until every leader reads before it fades.
    for (var attempt = 0; attempt < 3 && line != null; attempt++) {
      final edge = line;
      final deficit = [
        for (var o = 0; o < members.length; o++) minLeaderLength - _pathLength(leaderAt(o, edge)),
      ].reduce(math.max);
      if (deficit <= _epsilon) break;
      line = side == CalloutSide.left ? edge - deficit : edge + deficit;
    }
    final placed = <_Placed>[];
    for (final (o, m) in members.indexed) {
      final box = m.box;
      final x = xAt(box, line);
      final card = Rect.fromLTWH(x, ys[o], box.width, box.height);
      final span = _subjectSpan(subject, card.top, card.bottom);
      if (card.bottom > area.bottom + _epsilon ||
          ((card.top + card.bottom) / 2 - box.point.dy).abs() > reach + _epsilon ||
          card.top < area.top - _epsilon ||
          (span != null &&
              card.left < span.right + area.clearance - _epsilon &&
              card.right > span.left - area.clearance + _epsilon) ||
          area.keepOut.any((r) => r.overlaps(card))) {
        clear = false;
      }
      placed.add((
        index: m.index,
        width: box.width,
        height: box.height,
        callout: PlacedCallout(
          x: x,
          y: ys[o],
          side: side,
          anchor: box.point,
          path: leaderPath(card, side, box.point, math.min(12, box.height / 4)),
        ),
      ));
    }
    return (placed: placed, clear: clear);
  }

  ({List<PlacedCallout?> cards, bool clear}) place(List<CalloutSide> assignment) {
    final cards = List<PlacedCallout?>.filled(callouts.length, null);
    var clear = true;
    for (final side in CalloutSide.values) {
      final members =
          [
            for (final (index, c) in callouts.indexed)
              if (assignment[index] == side) (index: index, box: c),
          ]..sort((a, b) {
            final dy = a.box.point.dy.compareTo(b.box.point.dy);
            return dy != 0 ? dy : a.box.point.dx.compareTo(b.box.point.dx);
          });
      if (members.isEmpty) continue;
      // Cards pushed off their anchors' heights can cross leaders: swap such neighbours.
      var result = column(members, side);
      for (var attempt = 0; attempt < members.length * members.length; attempt++) {
        final crossing = _firstCrossing(result.placed);
        if (crossing == -1) break;
        final swapped = [...members];
        final upper = swapped[crossing];
        swapped[crossing] = swapped[crossing + 1];
        swapped[crossing + 1] = upper;
        final next = column(swapped, side);
        if (next.clear != result.clear && !next.clear) break;
        members
          ..clear()
          ..addAll(swapped);
        result = next;
      }
      clear = clear && result.clear;
      for (final p in result.placed) {
        cards[p.index] = p.callout;
      }
    }
    return (cards: cards, clear: clear);
  }

  FitLayout done(({List<PlacedCallout?> cards, bool clear}) r) =>
      FitLayout(FitLayoutKind.columns, [for (final c in r.cards) c!], clear: r.clear);

  final first = place(sides);
  if (first.clear) return done(first);
  // A column too full for its side sends the central callouts nearest the
  // middle across, one at a time, while the other side has room for them.
  final assignment = [...sides];
  for (var i = 0; i < callouts.length; i++) {
    final left = assignment.where((s) => s == CalloutSide.left).length;
    final right = assignment.length - left;
    final full = left >= right ? CalloutSide.left : CalloutSide.right;
    final other = otherOf(full);
    final candidates =
        [
          for (final (index, c) in callouts.indexed)
            if (assignment[index] == full && central(c) && fits(c, other))
              (index: index, callout: c),
        ]..sort(
          (a, b) =>
              (a.callout.point.dx - middle).abs().compareTo((b.callout.point.dx - middle).abs()),
        );
    if (candidates.isEmpty || (full == CalloutSide.left ? left : right) <= 1) break;
    assignment[candidates.first.index] = other;
    final next = place(assignment);
    if (next.clear) return done(next);
  }
  return done(first);
}

/// The fallback: the anchors carry numbers and the cards stand as a list in
/// the largest area free of the person: a side strip, else the strip above or
/// below them, else along the bottom edge (the only case that may cover them).
FitLayout placeFitLegend(List<CalloutBox> callouts, LayoutArea area, [List<Rect>? subjectBands]) {
  final subject = subjectBands ?? _assumedSubject([for (final c in callouts) c.point], area);
  final order = [for (final (i, c) in callouts.indexed) (index: i, box: c)]
    ..sort((a, b) {
      final dy = a.box.point.dy.compareTo(b.box.point.dy);
      return dy != 0 ? dy : a.box.point.dx.compareTo(b.box.point.dx);
    });
  final subjectTop = subject.map((r) => r.top).fold(area.bottom, math.min);
  final subjectBottom = subject.map((r) => r.bottom).fold(area.top, math.max);
  final widest = callouts.map((c) => c.width).fold(0.0, math.max);
  var columnHeight = 0.0;
  for (final (i, c) in callouts.indexed) {
    columnHeight += c.height + (i == 0 ? 0 : area.gap);
  }
  final cards = List<PlacedCallout?>.filled(callouts.length, null);
  FitLayout legend(bool clear) =>
      FitLayout(FitLayoutKind.legend, [for (final c in cards) c!], clear: clear);
  final anchorsMiddle =
      callouts.fold<double>(0, (sum, c) => sum + c.point.dy) / math.max(1, callouts.length);
  ({CalloutSide side, double top, double distance})? best;
  for (final side in CalloutSide.values) {
    final outer = side == CalloutSide.left ? area.left : area.right;
    final top = _columnTop(
      area,
      side == CalloutSide.left ? outer : outer - widest,
      side == CalloutSide.left ? outer + widest : outer,
    );
    double? runTop;
    for (var y = top; y <= area.bottom; y += _searchStep) {
      final free =
          y + _searchStep <= area.bottom + _epsilon &&
          widest <= _room(subject, area, side, y, y + _searchStep) + _epsilon;
      if (free) {
        runTop ??= y;
        continue;
      }
      final runBottom = math.min(y, area.bottom);
      if (runTop != null && runBottom - runTop >= columnHeight - _epsilon) {
        final start = math.min(
          math.max(anchorsMiddle - columnHeight / 2, runTop),
          runBottom - columnHeight,
        );
        final distance = (start + columnHeight / 2 - anchorsMiddle).abs();
        if (best == null || distance < best.distance) {
          best = (side: side, top: start, distance: distance);
        }
      }
      runTop = null;
    }
  }
  if (best != null) {
    var y = best.top;
    for (final item in order) {
      cards[item.index] = PlacedCallout(
        x: best.side == CalloutSide.left ? area.left : area.right - item.box.width,
        y: y,
        side: best.side,
        anchor: item.box.point,
        path: const [],
      );
      y += item.box.height + area.gap;
    }
    return legend(true);
  }
  // Rows above or below the person, wrapping as needed; else along the bottom.
  ({List<({int index, double x, double y})> placed, double height, bool fits}) rows(
    double top,
    double bottom,
  ) {
    final placed = <({int index, double x, double y})>[];
    var x = area.left, y = top, rowHeight = 0.0;
    for (final item in order) {
      if (x > area.left && x + item.box.width > area.right + _epsilon) {
        x = area.left;
        y += rowHeight + area.gap;
        rowHeight = 0;
      }
      placed.add((index: item.index, x: x, y: y));
      x += item.box.width + area.gap;
      rowHeight = math.max(rowHeight, item.box.height);
    }
    final height = y + rowHeight - top;
    return (placed: placed, height: height, fits: height <= bottom - top + _epsilon);
  }

  final above = (top: _columnTop(area, area.left, area.right), bottom: subjectTop - area.clearance);
  final below = (top: subjectBottom + area.clearance, bottom: area.bottom);
  for (final (strip, anchorEnd) in [(below, true), (above, false)]) {
    final layout = rows(strip.top, strip.bottom);
    if (layout.fits) {
      final shift = anchorEnd ? strip.bottom - (strip.top + layout.height) : 0.0;
      for (final p in layout.placed) {
        cards[p.index] = PlacedCallout(
          x: p.x,
          y: p.y + shift,
          side: CalloutSide.left,
          anchor: callouts[p.index].point,
          path: const [],
        );
      }
      return legend(true);
    }
  }
  final layout = rows(area.top, area.bottom);
  final shift = math.max(0.0, area.bottom - (area.top + layout.height));
  for (final p in layout.placed) {
    cards[p.index] = PlacedCallout(
      x: p.x,
      y: p.y + shift,
      side: CalloutSide.left,
      anchor: callouts[p.index].point,
      path: const [],
    );
  }
  return legend(false);
}

/// One step of a leader's fading end.
typedef FadeStep = ({Offset from, Offset to, double offset, double opacity});

/// Splits a leader into its solid part and a fading end: the last [fraction]
/// of its length, in [steps] equal steps of falling opacity.
({List<Offset> solid, List<FadeStep> fade}) fadeLeader(
  List<Offset> path,
  double fraction,
  int steps,
) {
  final lengths = [for (var i = 1; i < path.length; i++) (path[i] - path[i - 1]).distance];
  final total = lengths.fold<double>(0, (a, b) => a + b);
  if (total < _epsilon || steps < 1) return (solid: [...path], fade: const []);
  Offset at(double distance) {
    var walked = 0.0;
    for (final (i, length) in lengths.indexed) {
      if (walked + length >= distance) {
        final t = length < _epsilon ? 0.0 : (distance - walked) / length;
        return Offset.lerp(path[i], path[i + 1], t)!;
      }
      walked += length;
    }
    return path.last;
  }

  final start = total * (1 - fraction.clamp(0, 1));
  final solid = <Offset>[];
  var walked = 0.0;
  for (final (i, point) in path.indexed) {
    if (walked >= start) break;
    solid.add(point);
    walked += i < lengths.length ? lengths[i] : 0;
  }
  solid.add(at(start));
  final step = (total - start) / steps;
  return (
    solid: solid,
    fade: [
      for (var i = 0; i < steps; i++)
        (
          from: at(start + i * step),
          to: at(start + (i + 1) * step),
          offset: start + i * step,
          opacity: 1 - (i + 0.5) / steps,
        ),
    ],
  );
}
