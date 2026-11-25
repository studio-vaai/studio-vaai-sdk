// The web's results for logic both SDKs implement, replayed on the Flutter
// side: the fit callouts' layout (`callout_layout.dart`) and the fit gate's
// note (`gateNoteMessage`). The cases and the web's outputs are in
// test/shared_vectors/fit_overlay.json, which
// sdks/web-components/test/shared-vectors.test.ts writes and checks. The
// published package ships no test data, so the test is skipped without it.
import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/src/ui/callout_layout.dart';
import 'package:studio_vaai/src/ui/gate_note.dart';

final _file = File('test/shared_vectors/fit_overlay.json');
final Object _skip = _file.existsSync() ? false : 'no shared vectors';

/// Numbers rounded to 0.01 px, as the web writes them.
Object? _round(Object? value) => switch (value) {
  final num n => (n * 100).round() / 100,
  final List<Object?> list => [for (final item in list) _round(item)],
  final Map<String, Object?> map => {for (final e in map.entries) e.key: _round(e.value)},
  _ => value,
};

/// JSON numbers compared as numbers: the web writes 80 where Dart has 80.0.
Object? _numbers(Object? value) => switch (value) {
  final num n => n.toDouble(),
  final List<Object?> list => [for (final item in list) _numbers(item)],
  final Map<String, Object?> map => {for (final e in map.entries) e.key: _numbers(e.value)},
  _ => value,
};

Offset _xy(Object? value) {
  final [x, y] = (value! as List).cast<num>();
  return Offset(x.toDouble(), y.toDouble());
}

List<double> _offset(Offset o) => [o.dx, o.dy];

Rect _ltrb(Object? value) {
  final [l, t, r, b] = (value! as List).cast<num>();
  return Rect.fromLTRB(l.toDouble(), t.toDouble(), r.toDouble(), b.toDouble());
}

GateRefusal? _refusal(Object? value) => switch (value) {
  'too-small' => GateRefusal.tooSmall,
  'too-large' => GateRefusal.tooLarge,
  _ => null,
};

void main() {
  final vectors = _file.existsSync()
      ? jsonDecode(_file.readAsStringSync()) as Map<String, Object?>
      : const <String, Object?>{};
  List<Map<String, Object?>> cases(String group) =>
      ((vectors[group] as List?) ?? const []).cast<Map<String, Object?>>();

  void expectSame(Object? actual, Object? expected, String name) =>
      expect(_numbers(_round(actual)), _numbers(expected), reason: name);

  test('the fit callouts\' layout places cards as the web does', () {
    final all = cases('layout');
    expect(all, isNotEmpty);
    for (final c in all) {
      final input = c['input']! as Map<String, Object?>;
      final area = input['area']! as Map<String, Object?>;
      double n(String key) => (area[key]! as num).toDouble();
      final layoutArea = LayoutArea(
        left: n('left'),
        top: n('top'),
        right: n('right'),
        bottom: n('bottom'),
        gap: n('gap'),
        clearance: n('clearance'),
        keepOut: [for (final r in area['keepOut']! as List) _ltrb(r)],
      );
      final boxes = [
        for (final b in (input['boxes']! as List).cast<Map<String, Object?>>())
          CalloutBox(
            point: _xy(b['point']),
            width: (b['width']! as num).toDouble(),
            height: (b['height']! as num).toDouble(),
            alternates: [for (final a in (b['alternates'] as List?) ?? const []) _xy(a)],
          ),
      ];
      final subject = input['subject'] == null
          ? null
          : [for (final r in input['subject']! as List) _ltrb(r)];
      final layout = input['fn'] == 'legend'
          ? placeFitLegend(boxes, layoutArea, subject)
          : placeFitCallouts(boxes, layoutArea, subject);
      expectSame(
        {
          'kind': layout.kind.name,
          'clear': layout.clear,
          'cards': [
            for (final card in layout.cards)
              {
                'x': card.x,
                'y': card.y,
                'side': card.side.name,
                'anchor': _offset(card.anchor),
                'path': [for (final p in card.path) _offset(p)],
              },
          ],
        },
        c['output'],
        input['name']! as String,
      );
    }
  }, skip: _skip);

  test('columns stack as the web stacks them', () {
    final all = cases('stack');
    expect(all, isNotEmpty);
    for (final c in all) {
      final input = c['input']! as Map<String, Object?>;
      final preferred = [
        for (final p in input['preferred']! as List)
          (center: ((p as List)[0] as num).toDouble(), height: (p[1] as num).toDouble()),
      ];
      expectSame(
        stackColumn(
          preferred,
          (input['top']! as num).toDouble(),
          (input['bottom']! as num).toDouble(),
          (input['gap']! as num).toDouble(),
        ),
        c['output'],
        '$input',
      );
    }
  }, skip: _skip);

  test('leaders run as the web draws them', () {
    final all = cases('leader');
    expect(all, isNotEmpty);
    for (final c in all) {
      final input = c['input']! as Map<String, Object?>;
      expectSame(
        [
          for (final p in leaderPath(
            _ltrb(input['card']),
            input['side'] == 'left' ? CalloutSide.left : CalloutSide.right,
            _xy(input['anchor']),
            (input['radius']! as num).toDouble(),
          ))
            _offset(p),
        ],
        c['output'],
        '$input',
      );
    }
  }, skip: _skip);

  test('leaders fade out as the web fades them', () {
    final all = cases('fade');
    expect(all, isNotEmpty);
    for (final c in all) {
      final input = c['input']! as Map<String, Object?>;
      final (:solid, :fade) = fadeLeader(
        [for (final p in input['path']! as List) _xy(p)],
        (input['fraction']! as num).toDouble(),
        (input['steps']! as num).toInt(),
      );
      expectSame(
        {
          'solid': [for (final p in solid) _offset(p)],
          'fade': [
            for (final s in fade)
              {
                'from': _offset(s.from),
                'to': _offset(s.to),
                'offset': s.offset,
                'opacity': s.opacity,
              },
          ],
        },
        c['output'],
        '$input',
      );
    }
  }, skip: _skip);

  test('the fit gate\'s note chooses the web\'s message and values', () {
    final all = cases('gateNote');
    expect(all, isNotEmpty);
    for (final c in all) {
      final input = c['input']! as Map<String, Object?>;
      final note = gateNoteMessage(
        warning: _refusal(input['warning']),
        switched: _refusal(input['switched']),
        requested: input['requested']! as String,
        next: input['next'] as String?,
        choosing: input['choosing']! as bool,
      );
      expect(
        note == null ? null : {'id': note.key, 'values': note.values},
        c['output'],
        reason: '$input',
      );
    }
  }, skip: _skip);
}
