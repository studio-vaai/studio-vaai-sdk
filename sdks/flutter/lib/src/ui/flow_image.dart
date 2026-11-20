import 'dart:async';

import 'package:flutter/material.dart';

import 'components.dart';

/// Shows [image] and reports, once per [loadKey], whether it decoded: the
/// flow presents a try-on only after its image decoded (the web's
/// `sv-image-state` → `ImageDecoded`).
class FlowImage extends StatefulWidget {
  const FlowImage({
    super.key,
    required this.image,
    required this.loadKey,
    this.onDecoded,
    this.fit = BoxFit.cover,
    this.alignment = Alignment.topCenter,
    this.semanticLabel,
    this.mirror = false,
    this.onSize,
  });

  final ImageProvider? image;
  final Object? loadKey;
  final void Function(bool ready)? onDecoded;
  final BoxFit fit;
  final Alignment alignment;
  final String? semanticLabel;
  final bool mirror;

  /// The decoded image's size, such as to place callouts over it.
  final void Function(Size size)? onSize;

  @override
  State<FlowImage> createState() => _FlowImageState();
}

class _FlowImageState extends State<FlowImage> {
  ImageStream? _stream;
  ImageStreamListener? _listener;
  Object? _reportedKey;
  bool _failed = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _resolve();
  }

  @override
  void didUpdateWidget(FlowImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.image != widget.image || oldWidget.loadKey != widget.loadKey) {
      _failed = false;
      _resolve();
    }
  }

  void _resolve() {
    final provider = widget.image;
    if (provider == null) return;
    final stream = provider.resolve(createLocalImageConfiguration(context));
    if (stream.key == _stream?.key && _reportedKey == widget.loadKey) return;
    _unlisten();
    final key = widget.loadKey;
    _listener = ImageStreamListener(
      // A cached image reports synchronously, during build: report after it.
      (info, _) {
        final size = Size(info.image.width.toDouble(), info.image.height.toDouble());
        scheduleMicrotask(() {
          if (!mounted) return;
          widget.onSize?.call(size);
          _report(key, true);
        });
      },
      onError: (_, _) => scheduleMicrotask(() {
        if (!mounted) return;
        setState(() => _failed = true);
        _report(key, false);
      }),
    );
    _stream = stream..addListener(_listener!);
  }

  void _report(Object? key, bool ready) {
    if (!mounted || key != widget.loadKey || _reportedKey == key) return;
    _reportedKey = key;
    widget.onDecoded?.call(ready);
  }

  void _unlisten() {
    final listener = _listener;
    if (listener != null) _stream?.removeListener(listener);
    _listener = null;
  }

  @override
  void dispose() {
    _unlisten();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = widget.image;
    if (provider == null || _failed) {
      return Semantics(image: true, label: widget.semanticLabel, child: const SizedBox.expand());
    }
    Widget image = Image(
      image: provider,
      fit: widget.fit,
      alignment: widget.alignment,
      semanticLabel: widget.semanticLabel,
      gaplessPlayback: true,
      filterQuality: FilterQuality.medium,
      frameBuilder: (context, child, frame, sync) => sync
          ? child
          : AnimatedOpacity(
              opacity: frame == null ? 0 : 1,
              duration: const Duration(milliseconds: 250),
              child: child,
            ),
      errorBuilder: (_, _, _) => const SizedBox.expand(),
    );
    if (widget.mirror) {
      image = Transform.flip(flipX: true, child: image);
    }
    return SizedBox.expand(child: image);
  }
}

/// The generating overlay: a soft shimmer over the photo, with the progress text.
class GeneratingOverlay extends StatefulWidget {
  const GeneratingOverlay({super.key, required this.text});
  final String text;

  @override
  State<GeneratingOverlay> createState() => _GeneratingOverlayState();
}

class _GeneratingOverlayState extends State<GeneratingOverlay> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 3),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final v = reduceMotion ? 0.5 : _controller.value;
        return DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment(-1 + v, -1),
              end: Alignment(1 + v, 1),
              colors: const [Color(0x80C084FC), Color(0x8060A5FA), Color(0x33FFFFFF)],
            ),
          ),
          child: child,
        );
      },
      child: Container(
        color: const Color(0x66FFFFFF),
        alignment: Alignment.center,
        padding: const EdgeInsets.all(24),
        child: Text(
          widget.text,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 16, height: 1.5, color: Color(0xFF09090B)),
        ),
      ),
    );
  }
}

/// A placeholder while a photo is missing: the muted stage with a spinner.
class StagePlaceholder extends StatelessWidget {
  const StagePlaceholder({super.key, this.busy = false});
  final bool busy;

  @override
  Widget build(BuildContext context) =>
      Center(child: busy ? const TryOnSpinner() : const SizedBox.shrink());
}
