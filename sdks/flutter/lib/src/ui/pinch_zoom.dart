import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import 'scope.dart';
import 'theme.dart';

/// Up to four times, as the web's `sv-image`.
const _maxScale = 4.0;

/// A pinch starts once the fingers spread 5% or move 12 px, so two-finger
/// drags still scroll.
const _startScale = 1.05, _startMove = 12.0;

/// The web's temporary two-finger zoom (`sv-image` with `zoomable`): two
/// fingers lift a copy of the image above everything, the page dimming behind
/// it with the scale, and scale and move it with the fingers up to 4×; when
/// they let go it springs back into place (420 ms, no overshoot). One finger
/// does nothing, so the screen still scrolls.
class PinchZoom extends StatefulWidget {
  const PinchZoom({
    super.key,
    required this.enabled,
    required this.image,
    required this.child,
    this.fit = BoxFit.cover,
    this.alignment = Alignment.center,
  });

  final bool enabled;

  /// The image the lifted copy shows, as [child] shows it.
  final ImageProvider image;
  final BoxFit fit;
  final Alignment alignment;
  final Widget child;

  @override
  State<PinchZoom> createState() => _PinchZoomState();
}

class _PinchZoomState extends State<PinchZoom> with SingleTickerProviderStateMixin {
  final _pointers = <int, Offset>{};
  ({double distance, Offset focal, Rect rect})? _pinch;
  bool _zooming = false;
  OverlayEntry? _entry;
  final _transform = ValueNotifier<(Offset, double)>((Offset.zero, 1));
  late final AnimationController _release = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 420),
  );
  (Offset, double)? _releaseFrom;

  @override
  void initState() {
    super.initState();
    // A global route: the pinch is seen even while the screen's scroll view,
    // which the first finger may start, ignores pointers for its content.
    GestureBinding.instance.pointerRouter.addGlobalRoute(_route);
    _release.addListener(() {
      final from = _releaseFrom;
      if (from == null) return;
      final t = const Cubic(0.22, 1, 0.36, 1).transform(_release.value);
      _transform.value = (Offset.lerp(from.$1, Offset.zero, t)!, from.$2 + (1 - from.$2) * t);
    });
    _release.addStatusListener((status) {
      if (status == AnimationStatus.completed) _clear();
    });
  }

  @override
  void didUpdateWidget(PinchZoom oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.enabled) _cancel();
  }

  @override
  void dispose() {
    GestureBinding.instance.pointerRouter.removeGlobalRoute(_route);
    _clear();
    _release.dispose();
    _transform.dispose();
    super.dispose();
  }

  (double, Offset)? _measure() {
    if (_pointers.length != 2) return null;
    final [a, b] = _pointers.values.toList();
    return ((a - b).distance, (a + b) / 2);
  }

  void _route(PointerEvent event) {
    switch (event) {
      case PointerDownEvent():
        final box = context.findRenderObject() as RenderBox?;
        if (box == null || !box.attached || !box.hasSize) return;
        final rect = box.localToGlobal(Offset.zero) & box.size;
        if (rect.contains(event.position)) _down(event);
      case PointerMoveEvent():
        _move(event);
      case PointerUpEvent() || PointerCancelEvent():
        if (_pointers.containsKey(event.pointer)) _up(event);
      default:
        break;
    }
  }

  void _down(PointerDownEvent event) {
    _pointers[event.pointer] = event.position;
    if (!widget.enabled || _pinch != null || _pointers.length != 2) return;
    final box = context.findRenderObject() as RenderBox?;
    final now = _measure();
    if (box == null || now == null || now.$1 == 0) return;
    _release.stop();
    _pinch = (distance: now.$1, focal: now.$2, rect: box.localToGlobal(Offset.zero) & box.size);
  }

  void _move(PointerMoveEvent event) {
    if (!_pointers.containsKey(event.pointer)) return;
    _pointers[event.pointer] = event.position;
    final pinch = _pinch, now = _measure();
    if (pinch == null || now == null) return;
    final scale = (now.$1 / pinch.distance).clamp(1.0, _maxScale);
    final moved = (now.$2 - pinch.focal).distance;
    if (!_zooming) {
      if (scale < _startScale && moved < _startMove) return;
      _zooming = true;
      _lift(pinch.rect);
    }
    // Scale around the image's center, keeping the point between the fingers under them.
    final origin = pinch.rect.center;
    final offset = (pinch.focal - origin) * (1 - scale) + (now.$2 - pinch.focal);
    _transform.value = (offset, scale);
  }

  void _up(PointerEvent event) {
    _pointers.remove(event.pointer);
    if (_pinch == null || _pointers.length >= 2) return;
    _pinch = null;
    if (_zooming) {
      _zooming = false;
      _releaseFrom = _transform.value;
      _release.forward(from: 0);
    }
  }

  void _lift(Rect rect) {
    _clear();
    final scope = TryOnScope.of(context);
    final scrim = scope.tokens.scrim;
    _entry = OverlayEntry(
      builder: (context) => IgnorePointer(
        child: ValueListenableBuilder<(Offset, double)>(
          valueListenable: _transform,
          builder: (context, value, _) {
            final (offset, scale) = value;
            return Stack(
              children: [
                Positioned.fill(
                  child: ColoredBox(
                    color: scrim.withValues(
                      alpha: scrim.a * ((scale - 1) / (_maxScale - 1)).clamp(0, 1),
                    ),
                  ),
                ),
                Positioned.fromRect(
                  rect: rect,
                  child: Transform(
                    key: const ValueKey('try-on-zoom'),
                    transform: Matrix4.identity()
                      ..translateByDouble(offset.dx, offset.dy, 0, 1)
                      ..translateByDouble(rect.width / 2, rect.height / 2, 0, 1)
                      ..scaleByDouble(scale, scale, 1, 1)
                      ..translateByDouble(-rect.width / 2, -rect.height / 2, 0, 1),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(TryOnTokens.radius),
                      child: Image(
                        image: widget.image,
                        fit: widget.fit,
                        alignment: widget.alignment,
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
    Overlay.of(context, rootOverlay: true).insert(_entry!);
    setState(() {});
  }

  void _cancel() {
    _pinch = null;
    _zooming = false;
    _release.stop();
    _clear();
  }

  void _clear() {
    _entry?.remove();
    _entry?.dispose();
    final had = _entry != null;
    _entry = null;
    _releaseFrom = null;
    _transform.value = (Offset.zero, 1);
    if (had && mounted) setState(() {});
  }

  @override
  // While the copy is lifted, the image stays in place, hidden.
  Widget build(BuildContext context) =>
      Opacity(opacity: _entry == null ? 1 : 0, child: widget.child);
}
