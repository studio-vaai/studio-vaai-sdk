import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import 'scope.dart';
import 'theme.dart';

/// Back's availability in the header, as the web's `SvScreenNavigation`.
enum BackState { available, disabled, hidden }

/// The frame every screen shares (the web's `sv-screen`): a header with
/// Back, the title and Close; the stage (photo, camera, guide) filling the
/// space; a panel; messages before the actions; a primary and a secondary
/// action. It scrolls when the text is scaled up and it no longer fits.
///
/// [statusMessage] is announced to screen readers when it changes, as the
/// web's live status region.
class TryOnScreen extends StatelessWidget {
  const TryOnScreen({
    super.key,
    required this.title,
    this.titleIcon,
    this.subtitle,
    this.subtitleTrailing,
    required this.back,
    this.onBack,
    this.onClose,
    this.stage,
    this.stageOverlay,
    this.panel,
    this.beforeActions = const [],
    this.primary,
    this.secondary,
    this.busy = false,
    this.statusMessage,
  });

  final String title;
  final IconData? titleIcon;
  final String? subtitle;
  final Widget? subtitleTrailing;
  final BackState back;
  final VoidCallback? onBack;
  final VoidCallback? onClose;
  final Widget? stage;

  /// Drawn over the stage's lower part, such as the variant picker card.
  final Widget? stageOverlay;
  final Widget? panel;
  final List<Widget> beforeActions;
  final Widget? primary;
  final Widget? secondary;
  final bool busy;
  final String? statusMessage;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final t = scope.tokens;
    final messages = beforeActions.where((w) => w is! SizedBox).toList();
    // Messages before the actions, a fixed 12 px from the buttons.
    List<Widget> messageList() => [
      if (messages.isNotEmpty) ...[
        const SizedBox(height: 12),
        for (final (i, m) in messages.indexed) ...[if (i > 0) const SizedBox(height: 8), m],
      ],
    ];
    // The buttons. A screen without a secondary action keeps its slot, so the
    // primary button sits at the same height on every step.
    List<Widget> buttons() => [
      if (primary != null) ...[
        const SizedBox(height: 12),
        KeyedSubtree(key: const ValueKey('try-on-primary'), child: primary!),
      ],
      if (secondary != null) ...[
        const SizedBox(height: 4),
        secondary!,
      ] else if (primary != null)
        const SizedBox(height: 4 + TryOnTokens.buttonHeight),
    ];
    Widget stageWith(Widget? overlay) => overlay == null
        ? stage!
        : Stack(
            fit: StackFit.expand,
            children: [
              stage!,
              Positioned(left: 0, right: 0, bottom: 0, child: overlay),
            ],
          );
    return ColoredBox(
      color: t.background,
      child: SafeArea(
        top: false,
        child: LayoutBuilder(
          builder: (context, outer) {
            final wide = isWideTryOn(outer.maxWidth);
            final header = _Header(
              title: title,
              icon: titleIcon,
              subtitle: subtitle,
              subtitleTrailing: subtitleTrailing,
              back: back,
              onBack: busy ? null : onBack,
              onClose: onClose,
              wide: wide,
            );
            if (wide) {
              // The web's wide screen: the stage left, as wide as a 3:4 photo of
              // its height; the panel right, centred in the room above the
              // actions; the actions at the column's foot, the secondary
              // action's text on the stage's bottom edge. 24 px insets.
              return Column(
                children: [
                  header,
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: LayoutBuilder(
                        builder: (context, box) {
                          final stageWidth = math.min(
                            (box.maxHeight - 24) * 3 / 4,
                            (box.maxWidth - 24) * 0.6,
                          );
                          return Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              SizedBox(
                                width: stageWidth,
                                child: Padding(
                                  padding: const EdgeInsets.only(bottom: 24),
                                  child: stage ?? const SizedBox.shrink(),
                                ),
                              ),
                              const SizedBox(width: 24),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    Expanded(
                                      child: LayoutBuilder(
                                        builder: (context, room) => SingleChildScrollView(
                                          child: ConstrainedBox(
                                            constraints: BoxConstraints(minHeight: room.maxHeight),
                                            child: Column(
                                              mainAxisAlignment: MainAxisAlignment.center,
                                              crossAxisAlignment: CrossAxisAlignment.stretch,
                                              children: [
                                                ?panel,
                                                if (panel != null && stageOverlay != null)
                                                  const SizedBox(height: 24),
                                                ?stageOverlay,
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                    ...messageList(),
                                    ...buttons(),
                                  ],
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    ),
                  ),
                  LiveStatus(message: statusMessage),
                ],
              );
            }
            // Narrow: the content scrolls when it is taller than the screen;
            // the buttons stay at the bottom.
            return Column(
              children: [
                header,
                Expanded(
                  child: LayoutBuilder(
                    builder: (context, constraints) => CustomScrollView(
                      slivers: [
                        SliverFillRemaining(
                          hasScrollBody: false,
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (stage != null)
                                  Expanded(
                                    child: _StageHeight(
                                      minHeight: (constraints.maxHeight * 0.45).clamp(200, 420),
                                      child: stageWith(stageOverlay),
                                    ),
                                  )
                                else
                                  const Spacer(),
                                if (panel != null) ...[const SizedBox(height: 12), panel!],
                                ...messageList(),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (primary != null || secondary != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: buttons(),
                    ),
                  )
                else
                  const SizedBox(height: 12),
                LiveStatus(message: statusMessage),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// The web screens' container breakpoint: 40rem.
bool isWideTryOn(double width) => width >= 640;

/// The stage takes whatever height the screen has left, and at least
/// [minHeight]: it reports [minHeight] as its intrinsic height, so the
/// screen scrolls only when everything else no longer leaves it that much.
class _StageHeight extends SingleChildRenderObjectWidget {
  const _StageHeight({required this.minHeight, required super.child});
  final double minHeight;

  @override
  RenderObject createRenderObject(BuildContext context) => _RenderStageHeight(minHeight);

  @override
  void updateRenderObject(BuildContext context, _RenderStageHeight renderObject) =>
      renderObject.minHeight = minHeight;
}

class _RenderStageHeight extends RenderProxyBox {
  _RenderStageHeight(this._minHeight);
  double _minHeight;
  set minHeight(double value) {
    if (value == _minHeight) return;
    _minHeight = value;
    markNeedsLayout();
  }

  @override
  double computeMinIntrinsicHeight(double width) => _minHeight;
  @override
  double computeMaxIntrinsicHeight(double width) => _minHeight;
  @override
  double computeMinIntrinsicWidth(double height) => 0;
  @override
  double computeMaxIntrinsicWidth(double height) => 0;

  @override
  void performLayout() {
    final c = constraints.copyWith(
      minHeight: constraints.minHeight.clamp(0, constraints.maxHeight),
    );
    child!.layout(c, parentUsesSize: true);
    size = constraints.constrain(child!.size);
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.title,
    this.icon,
    this.subtitle,
    this.subtitleTrailing,
    required this.back,
    this.onBack,
    this.onClose,
    this.wide = false,
  });

  final bool wide;
  final String title;
  final IconData? icon;
  final String? subtitle;
  final Widget? subtitleTrailing;
  final BackState back;
  final VoidCallback? onBack;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final t = scope.tokens;
    final m = scope.messages;
    // The web's header buttons: lucide hairlines (stroke 1.25 on the 24 grid) at
    // 16 px; disabled at half opacity; hidden keeps its place (visibility: hidden).
    Widget button(
      LucideGlyph glyph,
      String label,
      VoidCallback? onPressed, {
      bool visible = true,
    }) => SizedBox(
      width: 48,
      height: 48,
      child: visible
          ? Semantics(
              button: true,
              label: label,
              enabled: onPressed != null,
              excludeSemantics: true,
              child: Opacity(
                opacity: onPressed == null ? 0.5 : 1,
                child: IconButton(
                  onPressed: onPressed,
                  tooltip: label,
                  icon: LucideIcon(glyph, size: 16, strokeWidth: 1.25, color: t.foreground),
                ),
              ),
            )
          : null,
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 4, 12),
      child: Row(
        children: [
          button(
            LucideGlyph.chevronLeft,
            m.text('surface.backSr'),
            back == BackState.available ? onBack : null,
            visible: back != BackState.hidden,
          ),
          Expanded(
            child: Column(
              children: [
                Semantics(
                  header: true,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (icon != null) ...[
                        Icon(icon, size: 16, color: t.foreground),
                        const SizedBox(width: 6),
                      ],
                      Flexible(
                        child: BalancedText(
                          title,
                          // Wide, the dialog's title is larger and lighter (2xl, medium).
                          style: TextStyle(
                            fontSize: wide ? 24 : 16,
                            height: wide ? 1.4 : 1.5,
                            fontWeight: wide ? FontWeight.w500 : FontWeight.w600,
                            color: t.foreground,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                // Up to two balanced lines, as the web's description.
                if (subtitle != null && subtitle!.isNotEmpty)
                  BalancedText(
                    subtitle!,
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.4,
                      fontWeight: FontWeight.w300,
                      color: t.mutedForeground,
                    ),
                  ),
                ?subtitleTrailing,
              ],
            ),
          ),
          button(LucideGlyph.x, m.text('surface.closeSr'), onClose),
        ],
      ),
    );
  }
}

/// Centred text that wraps to at most [maxLines] balanced lines (the web's
/// `text-wrap: balance` with a line clamp): a text longer than one line is
/// set in the narrowest width that keeps its line count, so its lines are of
/// even length; past [maxLines] it ends in an ellipsis.
class BalancedText extends StatelessWidget {
  const BalancedText(this.text, {super.key, required this.style, this.maxLines = 2});
  final String text;
  final TextStyle style;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final scaler = MediaQuery.textScalerOf(context);
    final direction = Directionality.maybeOf(context) ?? TextDirection.ltr;
    final merged = DefaultTextStyle.of(context).style.merge(style);
    Text text0() => Text(
      text,
      textAlign: TextAlign.center,
      maxLines: maxLines,
      overflow: TextOverflow.ellipsis,
      style: style,
    );
    return LayoutBuilder(
      builder: (context, box) {
        final available = box.maxWidth;
        if (!available.isFinite) return text0();
        int lines(double width) {
          final painter = TextPainter(
            text: TextSpan(text: text, style: merged),
            textDirection: direction,
            textScaler: scaler,
          )..layout(maxWidth: width);
          final count = painter.computeLineMetrics().length;
          painter.dispose();
          return count;
        }

        final wanted = math.min(lines(available), maxLines);
        if (wanted <= 1) return text0();
        // The narrowest width that keeps the line count.
        var low = available / wanted, high = available;
        for (var i = 0; i < 12 && high - low > 1; i++) {
          final mid = (low + high) / 2;
          if (lines(mid) <= wanted) {
            high = mid;
          } else {
            low = mid;
          }
        }
        return Center(
          widthFactor: 1,
          child: SizedBox(width: high.ceilToDouble(), child: text0()),
        );
      },
    );
  }
}

/// The lucide icons the web draws in strokes (`components/icon/icons.ts`),
/// as polylines on lucide's 24×24 grid.
enum LucideGlyph {
  chevronLeft([
    [Offset(15, 18), Offset(9, 12), Offset(15, 6)],
  ]),
  chevronDown([
    [Offset(6, 9), Offset(12, 15), Offset(18, 9)],
  ]),
  x([
    [Offset(18, 6), Offset(6, 18)],
    [Offset(6, 6), Offset(18, 18)],
  ]);

  const LucideGlyph(this.lines);
  final List<List<Offset>> lines;
}

/// A [LucideGlyph] with the web's round caps and joins.
class LucideIcon extends StatelessWidget {
  const LucideIcon(
    this.glyph, {
    super.key,
    this.size = 16,
    this.strokeWidth = 2,
    required this.color,
  });

  final LucideGlyph glyph;
  final double size;

  /// In grid units, as the SVG's `stroke-width`.
  final double strokeWidth;
  final Color color;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: size,
    child: CustomPaint(painter: _LucidePainter(glyph, strokeWidth, color)),
  );
}

class _LucidePainter extends CustomPainter {
  _LucidePainter(this.glyph, this.strokeWidth, this.color);
  final LucideGlyph glyph;
  final double strokeWidth;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 24;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth * scale
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..isAntiAlias = true;
    for (final line in glyph.lines) {
      final path = Path()..moveTo(line.first.dx * scale, line.first.dy * scale);
      for (final point in line.skip(1)) {
        path.lineTo(point.dx * scale, point.dy * scale);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_LucidePainter old) =>
      old.glyph != glyph || old.strokeWidth != strokeWidth || old.color != color;
}

/// Announces [message] to screen readers whenever it changes to a new,
/// non-empty text (the web's `aria-live="polite"` status region).
class LiveStatus extends StatefulWidget {
  const LiveStatus({super.key, this.message});
  final String? message;

  @override
  State<LiveStatus> createState() => _LiveStatusState();
}

class _LiveStatusState extends State<LiveStatus> {
  String? _announced;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _announce();
  }

  @override
  void didUpdateWidget(LiveStatus oldWidget) {
    super.didUpdateWidget(oldWidget);
    _announce();
  }

  void _announce() {
    final message = widget.message;
    if (message == null || message.isEmpty || message == _announced) {
      _announced = message;
      return;
    }
    _announced = message;
    final view = View.maybeOf(context);
    if (view == null) return;
    final direction = Directionality.maybeOf(context) ?? TextDirection.ltr;
    unawaited(SemanticsService.sendAnnouncement(view, message, direction));
  }

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    container: true,
    label: widget.message ?? '',
    child: const SizedBox.shrink(),
  );
}

enum ButtonVariant { primary, ghost }

/// The web's `sv-button`: a full-width primary or ghost action, with a
/// spinner while busy.
class TryOnButton extends StatelessWidget {
  const TryOnButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = ButtonVariant.primary,
    this.busy = false,
    this.icon,
  });

  final String label;
  final VoidCallback? onPressed;
  final ButtonVariant variant;
  final bool busy;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    final enabled = onPressed != null && !busy;
    final primary = variant == ButtonVariant.primary;
    final fg = primary ? t.primaryForeground : t.foreground;
    final bg = primary ? t.primary : Colors.transparent;
    final content = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (busy) ...[
          SizedBox.square(
            dimension: 16,
            child: CircularProgressIndicator(strokeWidth: 2, color: fg),
          ),
          const SizedBox(width: 8),
        ] else if (icon != null) ...[
          Icon(icon, size: 18, color: fg),
          const SizedBox(width: 8),
        ],
        Flexible(
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 16, height: 1.5, fontWeight: FontWeight.w500, color: fg),
          ),
        ),
      ],
    );
    return Semantics(
      button: true,
      enabled: enabled,
      child: Opacity(
        opacity: enabled || busy ? 1 : (primary ? 0.5 : 0.5),
        child: Material(
          color: bg,
          borderRadius: BorderRadius.circular(t.buttonRadius),
          child: InkWell(
            onTap: enabled ? onPressed : null,
            borderRadius: BorderRadius.circular(t.buttonRadius),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: TryOnTokens.buttonHeight),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Center(widthFactor: 1, child: content),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

enum MessageVariant { error, neutral }

/// The web's `sv-message`: an icon and a short text, red for errors.
class TryOnMessage extends StatelessWidget {
  const TryOnMessage(
    this.text, {
    super.key,
    this.variant = MessageVariant.error,
    this.card = false,
  });

  final String text;
  final MessageVariant variant;

  /// A rounded card, as the camera's guidance.
  final bool card;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    final error = variant == MessageVariant.error;
    final color = error ? t.destructive : t.foreground;
    final row = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Icon(error ? Icons.error_outline : Icons.info_outline, size: 16, color: color),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: TextStyle(fontSize: 14, height: 20 / 14, color: color),
          ),
        ),
      ],
    );
    final body = Semantics(liveRegion: error, child: row);
    if (!card) return body;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: t.glass,
        borderRadius: BorderRadius.circular(TryOnTokens.radiusLg),
        border: Border.all(color: t.glassBorder),
      ),
      child: body,
    );
  }
}

/// A frosted card over a photo (the web's `sv-glass`).
class TryOnGlass extends StatelessWidget {
  const TryOnGlass({super.key, required this.child, this.padding = const EdgeInsets.all(12)});
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    return ClipRRect(
      borderRadius: BorderRadius.circular(TryOnTokens.radiusLg),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            color: t.glass,
            border: Border.all(color: t.glassBorder),
            borderRadius: BorderRadius.circular(TryOnTokens.radiusLg),
          ),
          child: child,
        ),
      ),
    );
  }
}

/// A rounded stage frame around a photo, the camera or the guide.
class StageFrame extends StatelessWidget {
  const StageFrame({super.key, required this.child, this.color});
  final Widget child;
  final Color? color;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(TryOnTokens.radiusLg),
    child: ColoredBox(color: color ?? TryOnScope.of(context).tokens.muted, child: child),
  );
}

/// Text styles the web shares between screens.
abstract final class TryOnText {
  /// The consent, withdrawal and legal text: the web's 0.6875rem (11 px),
  /// line height 1.375, normal weight, muted.
  static TextStyle legal(TryOnTokens t) =>
      TextStyle(fontSize: 11, height: 1.375, fontWeight: FontWeight.w400, color: t.mutedForeground);
}

/// The web's `sv-disclosure`: a heading that shows or hides its content.
class TryOnDisclosure extends StatelessWidget {
  const TryOnDisclosure({
    super.key,
    required this.heading,
    required this.open,
    required this.onToggle,
    required this.child,
    this.card = true,
  });

  final String heading;
  final bool open;
  final ValueChanged<bool> onToggle;
  final Widget child;

  /// A muted card; otherwise an inline link-style toggle.
  final bool card;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    final toggle = Semantics(
      button: true,
      expanded: open,
      child: InkWell(
        onTap: () => onToggle(!open),
        borderRadius: BorderRadius.circular(TryOnTokens.radiusLg),
        child: Padding(
          // The web's summary: 10 × 14 px in the card; inline, no padding. The
          // card keeps a 48 px tap target, 12 px taller than the web's.
          padding: card
              ? const EdgeInsets.symmetric(horizontal: 14, vertical: 10)
              : EdgeInsets.zero,
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: card ? 28 : 0),
            child: Row(
              mainAxisSize: card ? MainAxisSize.max : MainAxisSize.min,
              children: [
                Flexible(
                  fit: card ? FlexFit.tight : FlexFit.loose,
                  child: Text(
                    heading,
                    style: card
                        ? TextStyle(
                            fontSize: 13,
                            height: 1.25,
                            fontWeight: FontWeight.w500,
                            color: t.foreground,
                          )
                        : TryOnText.legal(t).copyWith(color: t.link),
                  ),
                ),
                const SizedBox(width: 4),
                AnimatedRotation(
                  turns: open ? 0.5 : 0,
                  duration: const Duration(milliseconds: 200),
                  child: LucideIcon(
                    LucideGlyph.chevronDown,
                    size: card ? 24 : 10,
                    strokeWidth: card ? 1 : 2,
                    color: card ? t.foreground : t.link,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    final content = AnimatedSize(
      duration: const Duration(milliseconds: 250),
      curve: const Cubic(0.22, 1, 0.36, 1),
      alignment: Alignment.topCenter,
      child: open
          ? Padding(
              padding: card
                  ? const EdgeInsets.fromLTRB(14, 0, 14, 12)
                  : const EdgeInsets.only(top: 4),
              child: child,
            )
          : const SizedBox(width: double.infinity),
    );
    final column = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [toggle, content],
    );
    if (!card) return column;
    // The intro's privacy card on the web: raised surface, soft shadow.
    return DecoratedBox(
      decoration: BoxDecoration(
        color: t.surfaceRaised,
        borderRadius: BorderRadius.circular(TryOnTokens.radiusLg),
        boxShadow: const [
          BoxShadow(color: Color(0x12000000), blurRadius: 16, offset: Offset(0, 2)),
        ],
      ),
      child: column,
    );
  }
}

/// The web's `sv-checkbox`: a box and its label, with a validation error.
class TryOnCheckbox extends StatelessWidget {
  const TryOnCheckbox({
    super.key,
    required this.checked,
    required this.onChanged,
    required this.label,
    this.error = false,
    this.below,
  });

  final bool checked;
  final ValueChanged<bool>? onChanged;
  final String label;
  final bool error;
  final Widget? below;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    final enabled = onChanged != null;
    final borderColor = error ? t.destructive : t.foreground;
    return MergeSemantics(
      child: Semantics(
        checked: checked,
        enabled: enabled,
        // At least the 48 px tap target, however short the label.
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InkResponse(
                onTap: enabled ? () => onChanged!(!checked) : null,
                radius: 20,
                child: Padding(
                  // The web's box: 16 px, 2 px border, radius 2, 12 px from the text.
                  padding: const EdgeInsets.fromLTRB(0, 2, 12, 2),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    width: 16,
                    height: 16,
                    decoration: BoxDecoration(
                      color: checked ? t.primary : t.background,
                      borderRadius: BorderRadius.circular(2),
                      border: Border.all(color: checked ? t.primary : borderColor, width: 2),
                    ),
                    child: checked ? Icon(Icons.check, size: 11, color: t.primaryForeground) : null,
                  ),
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    GestureDetector(
                      onTap: enabled ? () => onChanged!(!checked) : null,
                      child: Text(label, style: TryOnText.legal(t)),
                    ),
                    ?below,
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Rich text from the catalog with tappable links, owning its recognizers.
class TryOnRichText extends StatefulWidget {
  const TryOnRichText(this.messageKey, {super.key, this.style});
  final String messageKey;
  final TextStyle? style;

  @override
  State<TryOnRichText> createState() => _TryOnRichTextState();
}

class _TryOnRichTextState extends State<TryOnRichText> {
  final _recognizers = <GestureRecognizer>[];

  void _clear() {
    for (final r in _recognizers) {
      r.dispose();
    }
    _recognizers.clear();
  }

  @override
  void dispose() {
    _clear();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    _clear();
    final span = scope.messages.rich(
      widget.messageKey,
      linkStyle: TextStyle(color: scope.tokens.link),
      onLink: scope.onLink,
      recognizers: _recognizers,
    );
    return Text.rich(span, style: widget.style);
  }
}

/// An indeterminate spinner in the foreground color.
class TryOnSpinner extends StatelessWidget {
  const TryOnSpinner({super.key, this.size = 24, this.color});
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: size,
    child: CircularProgressIndicator(
      strokeWidth: 2.5,
      color: color ?? TryOnScope.of(context).tokens.foreground,
    ),
  );
}
