import 'package:flutter/material.dart';

import 'scope.dart';
import 'theme.dart';

const _guideWidth = 589.0, _guideHeight = 600.0;

/// The web's `sv-photo-guide`: two people photographed head to toe, with
/// the pose, clothing and full-body labels from the catalog, drawn on the
/// same 589×600 canvas as the web's SVG so both lay out alike.
class TryOnPhotoGuide extends StatelessWidget {
  const TryOnPhotoGuide({super.key});

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final t = scope.tokens;
    final m = scope.messages;
    final body = m.text('guideGraphic.fullBody').split('\n');
    final pose = m.text('guideGraphic.naturalPose').split('\n');
    final clothing = m.text('guideGraphic.everydayClothing').split('\n');
    final asset = scope.appearance == TryOnAppearance.dark
        ? 'assets/guide-people-dark.webp'
        : 'assets/guide-people-light.webp';
    final label = TextStyle(fontSize: 12, height: 15 / 12, color: t.foreground);
    Widget callout(double x, double y, double line, List<String> lines) => Positioned(
      right: _guideWidth - x,
      top: y - 40,
      height: 80,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(lines.join('\n'), textAlign: TextAlign.end, style: label),
          const SizedBox(width: 8),
          Container(width: line, height: 1, color: t.annotation),
        ],
      ),
    );
    return Semantics(
      image: true,
      label: [body, pose, clothing].map((lines) => lines.join(' ')).join('. '),
      excludeSemantics: true,
      child: FittedBox(
        fit: BoxFit.contain,
        child: SizedBox(
          width: _guideWidth,
          height: _guideHeight,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned(
                left: 121,
                top: 0,
                width: 374,
                height: 600,
                child: ClipRect(
                  child: OverflowBox(
                    alignment: Alignment.topLeft,
                    minWidth: 0,
                    minHeight: 0,
                    maxWidth: double.infinity,
                    maxHeight: double.infinity,
                    child: Transform.translate(
                      offset: const Offset(-36.933, -10.895),
                      child: Image.asset(
                        asset,
                        package: 'studio_vaai',
                        width: 433.84,
                        height: 646.782,
                        fit: BoxFit.fill,
                        filterQuality: FilterQuality.medium,
                      ),
                    ),
                  ),
                ),
              ),
              Positioned(
                left: 459.5 - 3,
                top: 14,
                width: 6,
                height: 562,
                child: CustomPaint(painter: _ArrowPainter(t.annotation)),
              ),
              Positioned(
                left: 468,
                top: 61 - 14,
                child: Text(
                  body.join('\n'),
                  style: TextStyle(fontSize: 14, height: 17 / 14, color: t.foreground),
                ),
              ),
              callout(152, 227.5, 24, pose),
              callout(156, 450.5, 11, clothing),
            ],
          ),
        ),
      ),
    );
  }
}

class _ArrowPainter extends CustomPainter {
  _ArrowPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final x = size.width / 2;
    final paint = Paint()..color = color;
    canvas.drawLine(Offset(x, 4.5), Offset(x, size.height - 4.5), paint..strokeWidth = 1);
    final head = Path()
      ..moveTo(x, 0)
      ..lineTo(x - 2.8875, 5)
      ..lineTo(x + 2.8875, 5)
      ..close()
      ..moveTo(x, size.height)
      ..lineTo(x - 2.8875, size.height - 5)
      ..lineTo(x + 2.8875, size.height - 5)
      ..close();
    canvas.drawPath(head, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_ArrowPainter old) => old.color != color;
}
