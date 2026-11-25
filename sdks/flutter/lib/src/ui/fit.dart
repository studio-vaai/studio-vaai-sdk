import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../generated/state_machine.dart';
import 'callout_layout.dart';
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
  const FitReady(
    super.tryOnId, {
    required this.score,
    required this.callouts,
    this.subject = const [],
  });

  /// 0–100.
  final double score;
  final List<FitCallout> callouts;

  /// The person's outline in the result (the try-on's subject bands), to set
  /// the cards beside them; empty for results without it.
  final List<ResultSubjectBand> subject;
}

/// Where a callout's leader ends: a halo dot, or a tick across the hem for
/// the length.
enum FitMarker { dot, tick }

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
    this.alternates = const [],
    this.marker = FitMarker.dot,
  });
  final String key;
  final double x, y;
  final String label, description;
  final FitCalloutVariant variant;

  /// The same measurement's other anchors (the other sleeve), 0–1: the card
  /// points at one of them when its own has no room beside it.
  final List<(double, double)> alternates;
  final FitMarker marker;
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
            alternates: [
              for (final a in result.fitAnchors ?? const <ResultFitAnchor>[])
                if (a.dimension == c.key && (a.x != c.x || a.y != c.y)) (a.x, a.y),
            ],
            // The length is read at the front hem: a tick across it marks it better.
            marker: c.axis == FitAxis.totalLength ? FitMarker.tick : FitMarker.dot,
          ),
      ];
      return FitReady(
        result.id,
        score: score.fitMatch * 100,
        callouts: callouts,
        subject: result.subjectBands ?? const [],
      );
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

/// A compact callout card: the measurement and a dot with its verdict; in a
/// legend, led by its anchor's number.
class FitCalloutCard extends StatelessWidget {
  const FitCalloutCard({super.key, required this.callout, this.active = false, this.number});
  final FitCallout callout;
  final bool active;

  /// The anchor's number, in a legend.
  final int? number;

  static const labelStyle = TextStyle(fontSize: 11, height: 1.25, fontWeight: FontWeight.w600);
  static const verdictStyle = TextStyle(fontSize: 10, height: 1.25);
  static const padding = EdgeInsets.symmetric(horizontal: 10, vertical: 7);
  static const lineGap = 5.0, dotSize = 6.0, dotGap = 6.0;

  /// A legend's number before the card's text, and the gap after it.
  static const numberSize = 20.0, numberGap = 6.0;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    final dot = switch (callout.variant) {
      FitCalloutVariant.positive => t.positive,
      FitCalloutVariant.caution => t.caution,
      FitCalloutVariant.destructive => t.destructive,
    };
    final text = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(callout.label, style: labelStyle.copyWith(color: t.foreground)),
        const SizedBox(height: lineGap),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: dotSize,
              height: dotSize,
              decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
            ),
            const SizedBox(width: dotGap),
            Flexible(
              child: Text(
                callout.description,
                style: verdictStyle.copyWith(color: t.mutedForeground),
              ),
            ),
          ],
        ),
      ],
    );
    return AnimatedScale(
      scale: active ? 1.03 : 1,
      duration: const Duration(milliseconds: 250),
      child: Container(
        padding: padding,
        decoration: BoxDecoration(
          color: t.background,
          borderRadius: BorderRadius.circular(TryOnTokens.radiusLg),
          boxShadow: [
            BoxShadow(
              color: Color.fromRGBO(0, 0, 0, active ? 0.16 : 0.1),
              blurRadius: active ? 28 : 16,
              offset: Offset(0, active ? 10 : 4),
            ),
          ],
        ),
        child: number == null
            ? text
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _NumberMarker(number!),
                  const SizedBox(width: numberGap),
                  Flexible(child: text),
                ],
              ),
      ),
    );
  }
}

/// A legend's number, on its card and at its anchor.
class _NumberMarker extends StatelessWidget {
  const _NumberMarker(this.number);
  final int number;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    return Container(
      width: FitCalloutCard.numberSize,
      height: FitCalloutCard.numberSize,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: t.foreground,
        shape: BoxShape.circle,
        border: Border.all(color: t.background, width: 1.5),
        boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 4, offset: Offset(0, 1))],
      ),
      child: Text(
        '$number',
        style: TextStyle(fontSize: 10, height: 1, fontWeight: FontWeight.w600, color: t.background),
      ),
    );
  }
}

/// The callouts over the result image while the fit details are open: compact
/// cards beside the person (`callout_layout.dart`, the web's layout), leaders
/// fading out into a white halo dot (a tick across the hem for the length);
/// a numbered legend when the cards do not fit beside the person. A tap pins
/// one, which grows its marker and shows its leader whole.
class FitCalloutsOverlay extends StatelessWidget {
  const FitCalloutsOverlay({
    super.key,
    required this.callouts,
    required this.aspect,
    required this.activeKey,
    required this.onSelect,
    this.subject = const [],
    this.keepOut = const [],
    this.bottomInset = 46,
  });

  final List<FitCallout> callouts;

  /// The result image's width / height; it covers the stage.
  final double? aspect;
  final String? activeKey;
  final ValueChanged<String?> onSelect;

  /// The person's outline in the image (0–1), the result's subject bands.
  final List<ResultSubjectBand> subject;

  /// Areas over the image the cards keep clear of, such as the download button.
  final List<Rect> keepOut;
  final double bottomInset;

  /// The area's insets and spacing, as the web's overlay.
  static const _top = 12.0, _side = 8.0, _gap = 10.0, _clearance = 16.0;

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
        Offset toOverlay(double x, double y) =>
            Offset(image.left + image.width * x, image.top + image.height * y);
        bool inView(Offset p) => p.dx >= 0 && p.dx <= w && p.dy >= 0 && p.dy <= h;
        final maxWidth = w / 2 - 16;
        Size measure(FitCallout c, {bool legend = false}) {
          final extra =
              FitCalloutCard.padding.horizontal +
              (legend ? FitCalloutCard.numberSize + FitCalloutCard.numberGap : 0);
          final textWidth = maxWidth - extra;
          TextPainter painter(String text, TextStyle style, double width) => TextPainter(
            text: TextSpan(
              text: text,
              style: style.copyWith(
                fontFamily: TryOnTokens.fontFamily,
                fontFamilyFallback: TryOnTokens.fontFamilyFallback,
              ),
            ),
            textDirection: TextDirection.ltr,
            textScaler: textScaler,
          )..layout(maxWidth: math.max(1, width));
          final label = painter(c.label, FitCalloutCard.labelStyle, textWidth);
          final verdict = painter(
            c.description,
            FitCalloutCard.verdictStyle,
            textWidth - FitCalloutCard.dotSize - FitCalloutCard.dotGap,
          );
          final size = Size(
            math.max(label.width, FitCalloutCard.dotSize + FitCalloutCard.dotGap + verdict.width) +
                extra,
            math.max(
                  label.height + FitCalloutCard.lineGap + verdict.height,
                  legend ? FitCalloutCard.numberSize : 0,
                ) +
                FitCalloutCard.padding.vertical,
          );
          label.dispose();
          verdict.dispose();
          return size;
        }

        final subjectRects = [
          for (final b in subject)
            Rect.fromLTRB(
              image.left + b.left * image.width,
              image.top + b.top * image.height,
              image.left + b.right * image.width,
              image.top + b.bottom * image.height,
            ),
        ];
        final area = LayoutArea(
          left: _side,
          top: _top,
          right: w - _side,
          bottom: h - bottomInset,
          gap: _gap,
          clearance: _clearance,
          keepOut: keepOut,
        );
        // A crop can hide the anchor: then use the same measurement's other
        // side, if in view.
        CalloutBox boxOf(FitCallout c, Size size) {
          final points = [toOverlay(c.x, c.y), for (final (x, y) in c.alternates) toOverlay(x, y)];
          final visible = points.where(inView).toList();
          return CalloutBox(
            point: visible.firstOrNull ?? points.first,
            alternates: visible.skip(1).toList(),
            width: size.width,
            height: size.height,
          );
        }

        final bands = subjectRects.isEmpty ? null : subjectRects;
        var layout = placeFitCallouts([for (final c in items) boxOf(c, measure(c))], area, bands);
        if (!layout.clear && items.isNotEmpty) {
          layout = placeFitLegend(
            [for (final c in items) boxOf(c, measure(c, legend: true))],
            area,
            bands,
          );
        }
        final legend = layout.kind == FitLayoutKind.legend;
        final narrow = w <= 480;
        void toggle(String key) => onSelect(key == activeKey ? null : key);
        return Stack(
          children: [
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(
                  painter: _LeaderPainter(
                    [
                      for (final (i, p) in layout.cards.indexed)
                        (
                          path: p.path,
                          anchor: p.anchor,
                          active: items[i].key == activeKey,
                          tick: items[i].marker == FitMarker.tick,
                        ),
                    ],
                    t.foreground,
                    legend: legend,
                    tickWidth: narrow ? 18 : 22,
                  ),
                ),
              ),
            ),
            for (final (i, p) in layout.cards.indexed) ...[
              if (legend)
                Positioned(
                  left: p.anchor.dx - FitCalloutCard.numberSize / 2,
                  top: p.anchor.dy - FitCalloutCard.numberSize / 2,
                  child: GestureDetector(
                    onTap: () => toggle(items[i].key),
                    child: ExcludeSemantics(child: _NumberMarker(i + 1)),
                  ),
                )
              else
                // The marker's hit area: a pin from the image as from the card.
                Positioned(
                  left: p.anchor.dx - 16,
                  top: p.anchor.dy - 16,
                  width: 32,
                  height: 32,
                  child: ExcludeSemantics(
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => toggle(items[i].key),
                    ),
                  ),
                ),
              Positioned(
                left: p.x,
                top: p.y,
                child: ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: maxWidth),
                  child: Semantics(
                    button: true,
                    selected: items[i].key == activeKey,
                    label: '${items[i].label}: ${items[i].description}',
                    excludeSemantics: true,
                    child: GestureDetector(
                      onTap: () => toggle(items[i].key),
                      child: FitCalloutCard(
                        callout: items[i],
                        active: items[i].key == activeKey,
                        number: legend ? i + 1 : null,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

/// The leaders and their markers: a dashed line whose last 40% fades out in
/// steps into a white halo dot (or a tick across the hem), white on any
/// theme, as it marks the photo, not the interface. A pinned callout's marker
/// grows and its leader shows whole.
class _LeaderPainter extends CustomPainter {
  _LeaderPainter(this.lines, this.color, {required this.legend, required this.tickWidth});
  final List<({List<Offset> path, Offset anchor, bool active, bool tick})> lines;
  final Color color;
  final bool legend;
  final double tickWidth;

  static const _fadeSteps = 8, _dash = 6.0, _gap = 5.0;

  @override
  void paint(Canvas canvas, Size size) {
    if (legend) return;
    // Inactive leaders first, the pinned one over them.
    for (final line in [...lines.where((l) => !l.active), ...lines.where((l) => l.active)]) {
      _leader(canvas, line.path, line.active);
      _marker(canvas, line.anchor, line.active, line.tick);
    }
  }

  void _leader(Canvas canvas, List<Offset> path, bool active) {
    if (path.length < 2) return;
    final (solid: _, :fade) = fadeLeader(path, fadeFraction, _fadeSteps);
    final base = active ? 1.0 : 0.6;
    // The dash runs on unbroken; each dash takes the opacity of where it lies.
    double opacityAt(double distance) {
      if (active || fade.isEmpty || distance < fade.first.offset) return 1;
      for (final step in fade.reversed) {
        if (distance >= step.offset) return step.opacity;
      }
      return 1;
    }

    final segments = [for (var i = 1; i < path.length; i++) (path[i - 1], path[i])];
    var walked = 0.0;
    for (final (from, to) in segments) {
      final length = (to - from).distance;
      // Where the dash pattern stands at this segment's start.
      var d = 0.0;
      while (d < length) {
        final phase = (walked + d) % (_dash + _gap);
        if (phase >= _dash) {
          d += _dash + _gap - phase;
          continue;
        }
        final end = math.min(length, d + _dash - phase);
        final a = Offset.lerp(from, to, d / length)!, b = Offset.lerp(from, to, end / length)!;
        final opacity = base * opacityAt(walked + (d + end) / 2);
        canvas
          ..drawLine(
            a,
            b,
            Paint()
              ..strokeWidth = active ? 3.5 : 2.5
              ..strokeCap = StrokeCap.round
              ..color = Color.fromRGBO(255, 255, 255, 0.55 * opacity),
          )
          ..drawLine(
            a,
            b,
            Paint()
              ..strokeWidth = 1.25
              ..strokeCap = StrokeCap.round
              ..color = color.withValues(alpha: (active ? 0.6 : 0.38) * opacity),
          );
        d = end;
      }
      walked += length;
    }
  }

  void _marker(Canvas canvas, Offset at, bool active, bool tick) {
    const white = Color(0xFFFFFFFF);
    final opacity = active ? 1.0 : 0.9;
    // The dot is 7 px; the tick 22 (18 on a phone) by 3. Pinned: dot ×1.75,
    // tick ×1.35 wide and ×1.75 tall.
    final shape = tick
        ? RRect.fromRectAndRadius(
            Rect.fromCenter(
              center: at,
              width: tickWidth * (active ? 1.35 : 1),
              height: 3 * (active ? 1.75 : 1),
            ),
            const Radius.circular(1.5),
          )
        : RRect.fromRectAndRadius(
            Rect.fromCircle(center: at, radius: 3.5 * (active ? 1.75 : 1)),
            const Radius.circular(99),
          );
    Paint fill(Color c, [double blur = 0]) => Paint()
      ..color = c.withValues(alpha: c.a * opacity)
      ..maskFilter = blur > 0 ? MaskFilter.blur(BlurStyle.normal, blur) : null;
    // A soft shadow and a white glow carry it on white and on dark cloth.
    canvas
      ..drawRRect(shape.shift(const Offset(0, 1)), fill(const Color(0x99000000), 3))
      ..drawRRect(shape.inflate(tick ? 3 : 5), fill(const Color(0x8CFFFFFF), tick ? 4 : 5))
      ..drawRRect(shape.inflate(tick ? 2 : 3), fill(const Color(0x73FFFFFF)))
      // The hairline, then the white mark.
      ..drawRRect(shape.inflate(1), fill(const Color(0x3D000000)))
      ..drawRRect(shape, fill(white));
  }

  @override
  bool shouldRepaint(_LeaderPainter old) => true;
}
