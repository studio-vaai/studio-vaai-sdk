import 'dart:math' as math;
import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';

import '../generated/state_machine.dart';
import 'components.dart';
import 'scope.dart';
import 'theme.dart';

/// The result's fit, as the web's `SvTryOnFit` (`fitForResult`).
sealed class FitView {
  const FitView(this.tryOnId);
  final String tryOnId;
}

final class FitLoading extends FitView {
  const FitLoading(super.tryOnId);
}

final class FitFailed extends FitView {
  const FitFailed(super.tryOnId, {required this.retryable});
  final bool retryable;
}

final class FitReady extends FitView {
  const FitReady(super.tryOnId, {required this.score, required this.callouts});

  /// 0–100.
  final double score;
  final List<FitCallout> callouts;
}

/// The web's `SvFitCalloutVariant`.
enum FitCalloutVariant { positive, caution, destructive }

/// One measurement's verdict at a point of the result image (x, y in 0–1).
final class FitCallout {
  const FitCallout({
    required this.key,
    required this.x,
    required this.y,
    required this.label,
    required this.description,
    required this.variant,
  });
  final String key;
  final double x, y;
  final String label, description;
  final FitCalloutVariant variant;
}

const _verdicts = {
  Fit.tooSmall: ('tooSmall', FitCalloutVariant.destructive),
  Fit.runsTight: ('runsTight', FitCalloutVariant.caution),
  Fit.ideal: ('ideal', FitCalloutVariant.positive),
  Fit.runsLoose: ('runsLoose', FitCalloutVariant.caution),
  Fit.tooLoose: ('tooLoose', FitCalloutVariant.caution),
};

/// The catalog's name of each measurement: shoppers see these, never the
/// garment's own point-of-measure name.
const _axisNames = {
  FitAxis.chest: 'chest',
  FitAxis.waist: 'waist',
  FitAxis.hip: 'hip',
  FitAxis.bottom: 'bottom',
  FitAxis.totalLength: 'totalLength',
  FitAxis.sleeveLength: 'sleeveLength',
  FitAxis.shoulderWidth: 'shoulderWidth',
  FitAxis.inseam: 'inseam',
  FitAxis.other: 'other',
};

/// The result's fit from its try-on record, as the web's `fitForResult`: the
/// core's score and its callouts (`resultFitCallouts`), with the catalog's
/// names and verdicts.
FitView? fitForResult(TryOn result, bool retryable, String Function(String key) text) {
  switch (result.fit) {
    case PendingResultFit():
      return FitLoading(result.id);
    case FailedResultFit():
      return FitFailed(result.id, retryable: retryable);
    case ReadyResultFit(:final score):
      final callouts = [
        for (final c in resultFitCallouts(result: result))
          FitCallout(
            key: c.key,
            x: c.x,
            y: c.y,
            label: text('tryOnView.fitAxisNames.${_axisNames[c.axis]!}'),
            variant: _verdicts[c.fit]!.$2,
            description: text(
              'tryOnView.${c.isLength ? 'lengthVerdicts' : 'fitVerdicts'}.${_verdicts[c.fit]!.$1}',
            ),
          ),
      ];
      return FitReady(result.id, score: score.fitMatch * 100, callouts: callouts);
    default:
      return null;
  }
}

// --- The score's color ramp (the web's `internal/fit-ramp.ts`) ----------------

const _ramp = [(0.0, 0.7, 0.172, 25.0), (50.0, 0.8808, 0.1242, 96.8), (100.0, 0.845, 0.135, 152.0)];

double _encode(double c) => c <= 0.0031308 ? 12.92 * c : 1.055 * math.pow(c, 1 / 2.4) - 0.055;

Color _oklch(double l, double c, double h) {
  final rad = h * math.pi / 180;
  final a = c * math.cos(rad), b = c * math.sin(rad);
  final long = math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3).toDouble();
  final medium = math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3).toDouble();
  final short = math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3).toDouble();
  int channel(double linear) => (_encode(linear) * 255).round().clamp(0, 255);
  return Color.fromARGB(
    255,
    channel(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    channel(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    channel(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
  );
}

/// The ramp color for a score: red at 0, amber at 50, green at 100, at near
/// constant lightness; dark appearance keeps the hues on a deeper surface.
Color fitScoreTint(double score, TryOnAppearance appearance) {
  final p = score.clamp(0, 100).toDouble();
  final from = _ramp[p > 50 ? 1 : 0], to = _ramp[p > 50 ? 2 : 1];
  final t = (p - from.$1) / (to.$1 - from.$1);
  final lightness = from.$2 + (to.$2 - from.$2) * t;
  final chroma = from.$3 + (to.$3 - from.$3) * t;
  final dark = appearance == TryOnAppearance.dark;
  return _oklch(
    dark ? 0.38 : lightness,
    dark ? math.min(chroma * 0.65, 0.09) : chroma,
    from.$4 + (to.$4 - from.$4) * t,
  );
}

// --- The score bar (`sv-fit-score`) ---------------------------------------------

/// The fit score: a bar with the label and the percentage, tinted by the
/// score, that opens (the percentage grows) to show the callouts on the
/// image. Loading shows the label and a spinner; failed shows the label with
/// a retry. The score and the state are announced, as the web's status.
class FitScoreBar extends StatelessWidget {
  const FitScoreBar({
    super.key,
    required this.fit,
    required this.label,
    required this.open,
    required this.busy,
    required this.onToggle,
    required this.onRetry,
  });

  final FitView? fit;
  final String label;
  final bool open, busy;
  final ValueChanged<bool>? onToggle;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final t = scope.tokens;
    final m = scope.messages;
    final fit = this.fit;
    final labelText = Text(
      label,
      maxLines: 1,
      softWrap: false,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(
        fontSize: 14,
        height: 1.25,
        fontWeight: FontWeight.w500,
        color: t.foreground,
      ),
    );
    const padding = EdgeInsets.symmetric(horizontal: 14, vertical: 10);
    final radius = BorderRadius.circular(TryOnTokens.radius);
    final status = switch (fit) {
      FitReady(:final score) => '$label ${score.round().clamp(0, 100)}%',
      _ => label,
    };
    if (fit is! FitReady) {
      final failed = fit is FitFailed;
      return Semantics(
        container: true,
        liveRegion: true,
        label: status,
        child: Container(
          padding: padding,
          decoration: BoxDecoration(color: t.surfaceRaised, borderRadius: radius),
          child: Row(
            children: [
              if (failed) ...[
                Icon(Icons.error_outline, size: 12, color: t.destructive),
                const SizedBox(width: 8),
              ],
              Expanded(child: ExcludeSemantics(child: labelText)),
              const SizedBox(width: 8),
              if (!failed)
                const TryOnSpinner(size: 12)
              else if (fit.retryable)
                SizedBox.square(
                  dimension: 24,
                  child: IconButton(
                    padding: EdgeInsets.zero,
                    tooltip: m.text('tryOnView.fitScoreRetrySr'),
                    onPressed: busy ? null : onRetry,
                    icon: Icon(Icons.refresh, size: 12, color: t.foreground),
                  ),
                ),
            ],
          ),
        ),
      );
    }
    final score = fit.score.round().clamp(0, 100);
    final openable = fit.callouts.isNotEmpty;
    final dark = scope.appearance == TryOnAppearance.dark;
    const duration = Duration(milliseconds: 250);
    const curve = Cubic(0.22, 1, 0.36, 1);
    return Semantics(
      container: true,
      button: openable,
      expanded: openable ? open : null,
      liveRegion: true,
      label: status,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: radius,
          onTap: openable && !busy ? () => onToggle?.call(!open) : null,
          child: Ink(
            padding: padding,
            decoration: BoxDecoration(
              borderRadius: radius,
              gradient: LinearGradient(
                colors: [
                  dark ? t.glass : const Color(0xB8FFFFFF),
                  fitScoreTint(score.toDouble(), scope.appearance),
                ],
              ),
            ),
            child: Row(
              children: [
                Expanded(child: labelText),
                const SizedBox(width: 12),
                // Reserved at its open width, right-aligned: growing never narrows the label.
                ConstrainedBox(
                  constraints: const BoxConstraints(minWidth: 90),
                  child: AnimatedSlide(
                    duration: duration,
                    curve: curve,
                    offset: open ? const Offset(0.07, 0) : Offset.zero,
                    child: AnimatedDefaultTextStyle(
                      duration: duration,
                      curve: curve,
                      textAlign: TextAlign.end,
                      style: TextStyle(
                        fontFamily: TryOnTokens.fontFamily,
                        fontFamilyFallback: TryOnTokens.fontFamilyFallback,
                        fontSize: open ? 36 : 16,
                        height: 1,
                        fontWeight: open ? FontWeight.w500 : FontWeight.w600,
                        fontFeatures: const [FontFeature.tabularFigures()],
                        color: t.foreground,
                      ),
                      child: Text('$score%', textAlign: TextAlign.end),
                    ),
                  ),
                ),
                if (openable) ...[
                  const SizedBox(width: 12),
                  AnimatedRotation(
                    duration: duration,
                    curve: curve,
                    turns: open ? 0 : 0.5,
                    child: LucideIcon(LucideGlyph.chevronDown, size: 12, color: t.foreground),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// --- The callouts on the image (`sv-fit-callout`, the fit overlay) ----------------

/// A callout card: the measurement and a dot with its verdict.
class FitCalloutCard extends StatelessWidget {
  const FitCalloutCard({super.key, required this.callout, this.active = false});
  final FitCallout callout;
  final bool active;

  static const labelStyle = TextStyle(fontSize: 13, height: 1.25, fontWeight: FontWeight.w600);
  static const verdictStyle = TextStyle(fontSize: 11, height: 1.25);

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    final dot = switch (callout.variant) {
      FitCalloutVariant.positive => t.positive,
      FitCalloutVariant.caution => t.caution,
      FitCalloutVariant.destructive => t.destructive,
    };
    return AnimatedScale(
      scale: active ? 1.03 : 1,
      duration: const Duration(milliseconds: 250),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: t.background,
          borderRadius: BorderRadius.circular(TryOnTokens.radiusXl),
          border: Border.all(color: t.glassBorder),
          boxShadow: [
            BoxShadow(
              color: const Color(0x1A0A0A0A),
              blurRadius: active ? 28 : 16,
              offset: Offset(0, active ? 10 : 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(callout.label, style: labelStyle.copyWith(color: t.foreground)),
            const SizedBox(height: 4),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
                ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    callout.description,
                    style: verdictStyle.copyWith(color: t.mutedForeground),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A card's place and its leader line, from [placeFitCallouts].
typedef CalloutPlacement = ({Rect card, Offset lineStart, Offset lineEnd});

/// The web's `placeFitCallouts`: cards parked at the photo's edges, the two
/// sides balanced around the subject, stacked by their points' heights, each
/// with a line from its edge toward its point.
List<CalloutPlacement> placeFitCallouts(
  List<({Offset point, Size size})> callouts, {
  required double left,
  required double right,
  required double top,
  required double bottom,
  required double gap,
}) {
  if (callouts.isEmpty) return const [];
  final xs = callouts.map((c) => c.point.dx);
  final center = (xs.reduce(math.min) + xs.reduce(math.max)) / 2;
  final columns = <String, List<int>>{'left': [], 'right': []};
  for (final (i, c) in callouts.indexed) {
    columns[c.point.dx < center ? 'left' : 'right']!.add(i);
  }
  final heavy = columns['left']!.length > columns['right']!.length ? 'left' : 'right';
  final light = heavy == 'left' ? 'right' : 'left';
  final ordered = [...columns[heavy]!]
    ..sort(
      (a, b) =>
          (callouts[a].point.dx - center).abs().compareTo((callouts[b].point.dx - center).abs()),
    );
  final move = (ordered.length - columns[light]!.length) ~/ 2;
  columns[light]!.addAll(ordered.take(math.max(0, move)));
  columns[heavy] = ordered.skip(math.max(0, move)).toList();

  final positions = List<CalloutPlacement?>.filled(callouts.length, null);
  for (final side in ['left', 'right']) {
    final column = [...columns[side]!]
      ..sort((a, b) => callouts[a].point.dy.compareTo(callouts[b].point.dy));
    final total = column.fold<double>(0, (sum, i) => sum + callouts[i].size.height);
    final room = bottom - top;
    final spacing = math.min(gap, (room - total) / math.max(1, column.length - 1));
    var nextTop = top;
    final forward = <(int, double, double)>[];
    for (final i in column) {
      final (:point, :size) = callouts[i];
      final x = side == 'left' ? left : right - size.width;
      var preferred = point.dy - size.height / 2;
      if (point.dx >= x && point.dx <= x + size.width) {
        final below = point.dy + gap, above = point.dy - size.height - gap;
        if (below + size.height <= bottom) {
          preferred = below;
        } else if (above >= top) {
          preferred = above;
        }
      }
      final y = math.max(nextTop, preferred);
      nextTop = y + size.height + spacing;
      forward.add((i, x, y));
    }
    var nextBottom = bottom;
    for (final (i, x, preferred) in forward.reversed) {
      final (:point, :size) = callouts[i];
      final y = preferred.clamp(top, math.max(top, nextBottom - size.height)).toDouble();
      nextBottom = y - spacing;
      final cx = x + size.width / 2, cy = y + size.height / 2;
      final dx = point.dx - cx, dy = point.dy - cy;
      final ratio = [
        1.0,
        dx.abs() / (size.width / 2),
        dy.abs() / (size.height / 2),
      ].reduce(math.max);
      positions[i] = (
        card: Rect.fromLTWH(x, y, size.width, size.height),
        lineStart: Offset(cx + dx / ratio, cy + dy / ratio),
        lineEnd: point,
      );
    }
  }
  return [for (final p in positions) p!];
}

/// The callouts over the result image while the fit details are open: cards
/// at the edges, dashed leader lines to their points; a tap pins one.
class FitCalloutsOverlay extends StatelessWidget {
  const FitCalloutsOverlay({
    super.key,
    required this.callouts,
    required this.aspect,
    required this.activeKey,
    required this.onSelect,
    this.bottomInset = 46,
  });

  final List<FitCallout> callouts;

  /// The result image's width / height; it covers the stage.
  final double? aspect;
  final String? activeKey;
  final ValueChanged<String?> onSelect;
  final double bottomInset;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    final textScaler = MediaQuery.textScalerOf(context);
    final items = [
      for (final c in callouts)
        if (c.x.isFinite && c.y.isFinite && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1) c,
    ];
    return LayoutBuilder(
      builder: (context, box) {
        final w = box.maxWidth, h = box.maxHeight;
        var image = Offset.zero & box.biggest;
        final a = aspect;
        if (a != null && a > 0) {
          image = w / h > a
              ? Rect.fromCenter(center: image.center, width: w, height: w / a)
              : Rect.fromCenter(center: image.center, width: h * a, height: h);
        }
        final maxWidth = w / 2 - 16;
        double measure(String text, TextStyle style) {
          final painter = TextPainter(
            text: TextSpan(
              text: text,
              style: style.copyWith(
                fontFamily: TryOnTokens.fontFamily,
                fontFamilyFallback: TryOnTokens.fontFamilyFallback,
              ),
            ),
            textDirection: TextDirection.ltr,
            textScaler: textScaler,
          )..layout();
          final width = painter.width;
          painter.dispose();
          return width;
        }

        final sized = [
          for (final c in items)
            (
              point: Offset(image.left + image.width * c.x, image.top + image.height * c.y),
              size: Size(
                (math.max(
                          measure(c.label, FitCalloutCard.labelStyle),
                          12 + measure(c.description, FitCalloutCard.verdictStyle),
                        ) +
                        30)
                    .clamp(math.min(124, maxWidth), maxWidth)
                    .toDouble(),
                textScaler.scale(13 * 1.25 + 11 * 1.25) + 26,
              ),
            ),
        ];
        final placed = placeFitCallouts(
          sized,
          left: 8,
          right: w - 8,
          top: 12,
          bottom: h - bottomInset,
          gap: 10,
        );
        return Stack(
          children: [
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(
                  painter: _LeaderPainter([
                    for (final (i, p) in placed.indexed) (p, items[i].key == activeKey),
                  ], t.foreground),
                ),
              ),
            ),
            for (final (i, p) in placed.indexed)
              Positioned.fromRect(
                rect: p.card,
                child: Semantics(
                  button: true,
                  selected: items[i].key == activeKey,
                  label: '${items[i].label}: ${items[i].description}',
                  excludeSemantics: true,
                  child: GestureDetector(
                    onTap: () => onSelect(items[i].key == activeKey ? null : items[i].key),
                    child: FitCalloutCard(callout: items[i], active: items[i].key == activeKey),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _LeaderPainter extends CustomPainter {
  _LeaderPainter(this.lines, this.color);
  final List<(CalloutPlacement, bool)> lines;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    for (final (p, active) in lines) {
      final path = Path()
        ..moveTo(p.lineStart.dx, p.lineStart.dy)
        ..lineTo(p.lineEnd.dx, p.lineEnd.dy);
      final dashed = _dash(path, 6, 5);
      final opacity = active ? 1.0 : 0.6;
      canvas.drawPath(
        dashed,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = active ? 3.5 : 2.5
          ..color = Color.fromRGBO(255, 255, 255, 0.55 * opacity),
      );
      canvas.drawPath(
        dashed,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.25
          ..color = color.withValues(alpha: (active ? 0.6 : 0.38) * opacity),
      );
    }
  }

  Path _dash(Path source, double on, double off) {
    final out = Path();
    for (final PathMetric metric in source.computeMetrics()) {
      for (var d = 0.0; d < metric.length; d += on + off) {
        out.addPath(metric.extractPath(d, math.min(d + on, metric.length)), Offset.zero);
      }
    }
    return out;
  }

  @override
  bool shouldRepaint(_LeaderPainter old) => true;
}
