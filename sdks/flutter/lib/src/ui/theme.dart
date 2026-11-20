import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// Light or dark, as the web SDK's `appearance`.
enum TryOnAppearance { light, dark }

/// The web SDK's design tokens (`sdks/web-components/src/internal/theme/tokens.ts`):
/// seven seed colors, the mix steps every other color derives from, and the
/// fixed colors. The derived colors are computed with the same `color-mix()`
/// math as the web's CSS fallbacks, so both render the same pixels.
///
/// A shop brands the flow by changing seeds: `TryOnTokens.light.copyWith(primary: ...)`.
@immutable
final class TryOnTokens {
  const TryOnTokens({
    required this.background,
    required this.foreground,
    required this.primary,
    required this.primaryForeground,
    required this.positive,
    required this.caution,
    required this.destructive,
    required this.steps,
    required this.backdrop,
    required this.annotation,
  });

  /// `SV_COLOR_SEEDS` and `SV_MIX_STEPS`.
  static const light = TryOnTokens(
    background: Color(0xFFFFFFFF),
    foreground: Color(0xFF09090B),
    primary: Color(0xFF000000),
    primaryForeground: Color(0xFFFFFFFF),
    positive: Color(0xFF22C55E),
    caution: Color(0xFFF59E0B),
    destructive: Color(0xFFDC2626),
    steps: TryOnMixSteps.light,
    backdrop: Color(0x73000000),
    annotation: Color(0xFF0000FE),
  );

  /// `SV_DARK_APPEARANCE`.
  static const dark = TryOnTokens(
    background: Color(0xFF151517),
    foreground: Color(0xFFF4F4F5),
    primary: Color(0xFFE4E4E7),
    primaryForeground: Color(0xFF18181B),
    positive: Color(0xFF4ADE80),
    caution: Color(0xFFFBBF24),
    destructive: Color(0xFFF87171),
    steps: TryOnMixSteps.dark,
    backdrop: Color(0xB3000000),
    annotation: Color(0xFFA5B4FC),
  );

  static TryOnTokens of(TryOnAppearance appearance) =>
      appearance == TryOnAppearance.dark ? dark : light;

  final Color background;
  final Color foreground;
  final Color primary;
  final Color primaryForeground;
  final Color positive;
  final Color caution;
  final Color destructive;
  final TryOnMixSteps steps;
  final Color backdrop;
  final Color annotation;

  TryOnTokens copyWith({
    Color? background,
    Color? foreground,
    Color? primary,
    Color? primaryForeground,
    Color? positive,
    Color? caution,
    Color? destructive,
    TryOnMixSteps? steps,
    Color? backdrop,
    Color? annotation,
  }) => TryOnTokens(
    background: background ?? this.background,
    foreground: foreground ?? this.foreground,
    primary: primary ?? this.primary,
    primaryForeground: primaryForeground ?? this.primaryForeground,
    positive: positive ?? this.positive,
    caution: caution ?? this.caution,
    destructive: destructive ?? this.destructive,
    steps: steps ?? this.steps,
    backdrop: backdrop ?? this.backdrop,
    annotation: annotation ?? this.annotation,
  );

  // Derived colors (`SV_DERIVED_COLORS`).
  Color get surfaceRaised => mixSrgb(foreground, steps.surfaceRaised, background);
  Color get control => mixSrgb(foreground, steps.control, background);
  Color get controlHover => mixSrgb(foreground, steps.controlHover, background);
  Color get muted => mixSrgb(foreground, steps.muted, background);
  Color get mutedForeground => mixSrgb(foreground, steps.mutedForeground, background);
  Color get border => mixSrgb(foreground, steps.border, background);
  Color get input => mixSrgb(foreground, steps.input, background);
  Color get ring => mixSrgb(foreground, steps.ring, background);
  Color get primaryHover => mixSrgb(primary, 90, background);
  Color get positiveMuted => mixOklab(positive, 16, background);
  Color get positiveForeground => mixOklab(positive, 60, foreground);
  Color get cautionMuted => mixOklab(caution, 16, background);
  Color get cautionForeground => mixOklab(caution, 60, foreground);
  Color get destructiveMuted => mixOklab(destructive, 16, background);
  Color get destructiveForeground => mixOklab(destructive, 60, foreground);
  Color get glass => background.withValues(alpha: steps.glass / 100);
  Color get photoOverlay => background.withValues(alpha: steps.photoOverlay / 100);
  Color get glassBorder => foreground.withValues(alpha: steps.overlayBorder / 100);
  Color get scrim => background.withValues(alpha: 0.6);

  // Fixed colors (`SV_FIXED_COLORS`).
  static const mediaBackground = Color(0xFF000000);
  static const mediaForeground = Color(0xFFFFFFFF);
  static const mediaOverlay = Color(0x99000000);
  static const mediaControl = Color(0x26FFFFFF);
  static const shimmerStart = Color(0x80C084FC);
  static const shimmerEnd = Color(0x8060A5FA);

  /// Links: the web's `--sv-link` follows the browser's link color; this
  /// is the design tokens' `color.link`.
  Color get link =>
      background.computeLuminance() > 0.5 ? const Color(0xFF007AFF) : const Color(0xFF7DB7FF);

  // Sizes, as multiples of the 16 px root (`SV_TEXT_SIZES`, `SV_RADII`).
  static const root = 16.0;
  static const spacing = 4.0;
  static const radius = 8.0;
  static const radiusSm = 4.0, radiusMd = 8.0, radiusLg = 12.0, radiusXl = 16.0;
  static const radiusFull = 9999.0;
  static const buttonHeight = 48.0;

  /// The web's font, Inter, bundled with this package (`SV_FONT_SANS`):
  /// Flutter names a package's font family after the package.
  static const fontFamily = 'packages/$_package/Inter';
  static const _package = 'studio_vaai';
  static const fontFamilyFallback = ['Inter', '.AppleSystemUIFont', 'Roboto', 'Arial'];
}

/// `SV_MIX_STEPS`: percentages of the foreground in the background.
@immutable
final class TryOnMixSteps {
  const TryOnMixSteps({
    required this.muted,
    required this.border,
    required this.input,
    required this.ring,
    required this.mutedForeground,
    required this.surfaceRaised,
    required this.control,
    required this.controlHover,
    required this.glass,
    required this.photoOverlay,
    required this.overlayBorder,
  });

  static const light = TryOnMixSteps(
    muted: 3.88,
    border: 10.41,
    input: 10.41,
    ring: 50,
    mutedForeground: 64,
    surfaceRaised: 3.88,
    control: 0,
    controlHover: 3.88,
    glass: 72,
    photoOverlay: 85,
    overlayBorder: 6,
  );

  static const dark = TryOnMixSteps(
    muted: 14,
    border: 20,
    input: 40,
    ring: 60,
    mutedForeground: 70,
    surfaceRaised: 5,
    control: 10,
    controlHover: 14,
    glass: 94,
    photoOverlay: 96,
    overlayBorder: 10,
  );

  final double muted, border, input, ring, mutedForeground, surfaceRaised;
  final double control, controlHover, glass, photoOverlay, overlayBorder;

  /// By the web's token names (`mix-muted`, `opacity-glass`, …).
  Map<String, double> toMap() => {
    'mix-muted': muted,
    'mix-border': border,
    'mix-input': input,
    'mix-ring': ring,
    'mix-muted-foreground': mutedForeground,
    'mix-surface-raised': surfaceRaised,
    'mix-control': control,
    'mix-control-hover': controlHover,
    'opacity-glass': glass,
    'opacity-photo-overlay': photoOverlay,
    'opacity-overlay-border': overlayBorder,
  };
}

/// `color-mix(in srgb, a p%, b)`, rounded to 8 bits as the web's fallbacks.
Color mixSrgb(Color a, double percent, Color b) {
  final p = percent / 100;
  int channel(double x, double y) => (((p * x) + (1 - p) * y) * 255).round().clamp(0, 255);
  return Color.fromARGB(255, channel(a.r, b.r), channel(a.g, b.g), channel(a.b, b.b));
}

/// `color-mix(in oklab, a p%, b)`.
Color mixOklab(Color a, double percent, Color b) {
  final p = percent / 100;
  final la = _toOklab(a), lb = _toOklab(b);
  final mixed = [for (var i = 0; i < 3; i++) p * la[i] + (1 - p) * lb[i]];
  final rgb = _fromOklab(mixed);
  int channel(double v) => (v.clamp(0, 1) * 255).round();
  return Color.fromARGB(255, channel(rgb[0]), channel(rgb[1]), channel(rgb[2]));
}

double _toLinear(double c) =>
    c <= 0.04045 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
double _fromLinear(double c) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * math.pow(c, 1 / 2.4).toDouble() - 0.055;
double _cbrt(double x) => x < 0 ? -math.pow(-x, 1 / 3).toDouble() : math.pow(x, 1 / 3).toDouble();

List<double> _toOklab(Color color) {
  final r = _toLinear(color.r), g = _toLinear(color.g), b = _toLinear(color.b);
  final l = _cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  final m = _cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  final s = _cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

List<double> _fromOklab(List<double> lab) {
  final [L, a, b] = lab;
  final l = math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3).toDouble();
  final m = math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3).toDouble();
  final s = math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3).toDouble();
  double clamp(double c) => _fromLinear(c.clamp(0, 1));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/// The tokens and appearance below a try-on widget.
class TryOnTheme extends InheritedWidget {
  const TryOnTheme({super.key, required this.tokens, required super.child});

  final TryOnTokens tokens;

  static TryOnTokens of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<TryOnTheme>()?.tokens ?? TryOnTokens.light;

  @override
  bool updateShouldNotify(TryOnTheme oldWidget) => oldWidget.tokens != tokens;
}
