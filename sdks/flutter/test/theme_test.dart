// The Flutter tokens are the web components' tokens: the same seeds and mix
// steps (read from the web SDK's source beside this package), the
// same derived colors, and the design tokens' font.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/widgets.dart';

const _webTokens = '../web-components/src/internal/theme/tokens.ts';
const _designTokens = '../../packages/design-tokens/tokens/font.tokens.json';

/// `deriveSvColors(svAppearanceDefaults(a))` from the web tokens, run with
/// Node on `tokens.ts`. Regenerate when the web's seeds or steps change.
const _derived = {
  'light': {
    'muted': '#f5f5f6',
    'muted-foreground': '#626263',
    'border': '#e5e5e6',
    'input': '#e5e5e6',
    'ring': '#848485',
    'surface-raised': '#f5f5f6',
    'control': '#ffffff',
    'control-hover': '#f5f5f6',
    'primary-hover': '#191919',
    'positive-muted': '#e3f7e6',
    'positive-foreground': '#23723c',
    'caution-muted': '#fff0e0',
    'caution-foreground': '#8c5d1f',
    'destructive-muted': '#ffe1dc',
    'destructive-foreground': '#80221f',
  },
  'dark': {
    'muted': '#343436',
    'muted-foreground': '#b1b1b2',
    'border': '#424243',
    'input': '#6e6e70',
    'ring': '#9b9b9c',
    'surface-raised': '#202022',
    'control': '#2b2b2d',
    'control-hover': '#343436',
    'primary-hover': '#cfcfd2',
    'positive-muted': '#213027',
    'positive-foreground': '#9ce8b0',
    'caution-muted': '#342d20',
    'caution-foreground': '#f9d68e',
    'destructive-muted': '#352324',
    'destructive-foreground': '#fca8a5',
  },
};

String hex(Color c) =>
    '#${[c.r, c.g, c.b].map((v) => (v * 255).round().toRadixString(16).padLeft(2, '0')).join()}';

Map<String, Color> derived(TryOnTokens t) => {
  'muted': t.muted,
  'muted-foreground': t.mutedForeground,
  'border': t.border,
  'input': t.input,
  'ring': t.ring,
  'surface-raised': t.surfaceRaised,
  'control': t.control,
  'control-hover': t.controlHover,
  'primary-hover': t.primaryHover,
  'positive-muted': t.positiveMuted,
  'positive-foreground': t.positiveForeground,
  'caution-muted': t.cautionMuted,
  'caution-foreground': t.cautionForeground,
  'destructive-muted': t.destructiveMuted,
  'destructive-foreground': t.destructiveForeground,
};

Map<String, String> seeds(TryOnTokens t) => {
  'background': hex(t.background),
  'foreground': hex(t.foreground),
  'primary': hex(t.primary),
  'primary-foreground': hex(t.primaryForeground),
  'positive': hex(t.positive),
  'caution': hex(t.caution),
  'destructive': hex(t.destructive),
};

/// The `"name": value` pairs of the object literal after [marker] in [source].
Map<String, String> objectAfter(String source, String marker) {
  final start = source.indexOf('{', source.indexOf(marker));
  final end = source.indexOf('}', start);
  return {
    for (final m in RegExp(
      r'"?([\w-]+)"?:\s*"?([#\w.]+)"?',
    ).allMatches(source.substring(start, end)))
      m.group(1)!: m.group(2)!,
  };
}

void main() {
  test('derived colors match the web’s color-mix() fallbacks', () {
    for (final (name, tokens) in [('light', TryOnTokens.light), ('dark', TryOnTokens.dark)]) {
      expect(derived(tokens).map((k, v) => MapEntry(k, hex(v))), _derived[name], reason: name);
    }
  });

  final web = File(_webTokens);
  test(
    'seeds and mix steps are the web components’ tokens',
    skip: web.existsSync() ? false : 'without the web SDK beside this package',
    () {
      final source = web.readAsStringSync();
      expect(seeds(TryOnTokens.light), objectAfter(source, 'export const SV_COLOR_SEEDS'));
      final darkSeeds = objectAfter(source, 'seeds: {');
      expect(seeds(TryOnTokens.dark), darkSeeds);
      final lightSteps = objectAfter(source, 'export const SV_MIX_STEPS');
      expect(
        TryOnTokens.light.steps.toMap().map((k, v) => MapEntry(k, v)),
        lightSteps.map((k, v) => MapEntry(k, double.parse(v))),
      );
      final darkSteps = objectAfter(source, 'steps: {');
      expect({
        for (final k in darkSteps.keys) k: TryOnTokens.dark.steps.toMap()[k],
      }, darkSteps.map((k, v) => MapEntry(k, double.parse(v))));
      final fixed = objectAfter(source, 'fixed: {');
      expect(fixed['annotation'], hex(TryOnTokens.dark.annotation));
    },
  );

  final font = File(_designTokens);
  test(
    'the font stack starts with the design tokens’ Inter',
    skip: font.existsSync() ? false : 'without the design tokens',
    () {
      final json = jsonDecode(font.readAsStringSync()) as Map<String, dynamic>;
      final family = json['font']['family-sans'][r'$value'] as String;
      // The bundled family is this package's Inter.
      expect(family, startsWith('"Inter"'));
      expect(TryOnTokens.fontFamily, endsWith('/Inter'));
      expect(File('assets/fonts/Inter-Regular.ttf').existsSync(), isTrue);
    },
  );
}
