import 'package:flutter/material.dart';

import 'messages.dart';
import 'theme.dart';

/// Loads a remote image, such as a try-on result. Defaults to `TryOnNetworkImage`.
typedef TryOnImageProvider = ImageProvider Function(String url);

/// What every screen reads: the text, the tokens, and the host's hooks.
class TryOnScope extends InheritedWidget {
  const TryOnScope({
    super.key,
    required this.messages,
    required this.tokens,
    required this.appearance,
    required this.imageProvider,
    this.onLink,
    required super.child,
  });

  final TryOnMessages messages;
  final TryOnTokens tokens;
  final TryOnAppearance appearance;
  final TryOnImageProvider imageProvider;

  /// Opens a link from the copy (terms, privacy). Unset: links are not tappable.
  final void Function(Uri uri)? onLink;

  static TryOnScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<TryOnScope>();
    assert(scope != null, 'No TryOnScope above this widget.');
    return scope!;
  }

  /// Shorthand for [TryOnMessages.text].
  static String text(BuildContext context, String key, [Map<String, Object> values = const {}]) =>
      of(context).messages.text(key, values);

  @override
  bool updateShouldNotify(TryOnScope oldWidget) =>
      oldWidget.messages != messages ||
      oldWidget.tokens != tokens ||
      oldWidget.appearance != appearance ||
      oldWidget.imageProvider != imageProvider ||
      oldWidget.onLink != onLink;
}

/// The Material theme the screens render with, from the tokens: the same
/// font stack, sizes and colors as the web components.
ThemeData tryOnThemeData(TryOnTokens t, TryOnAppearance appearance) {
  final brightness = appearance == TryOnAppearance.dark ? Brightness.dark : Brightness.light;
  final base = TextTheme(
    bodyLarge: TextStyle(fontSize: 16, height: 1.5, color: t.foreground),
    bodyMedium: TextStyle(fontSize: 14, height: 20 / 14, color: t.foreground),
    bodySmall: TextStyle(fontSize: 12, height: 16 / 12, color: t.mutedForeground),
    titleMedium: TextStyle(
      fontSize: 16,
      height: 1.5,
      fontWeight: FontWeight.w600,
      color: t.foreground,
    ),
    labelLarge: TextStyle(fontSize: 16, height: 1.5, fontWeight: FontWeight.w500),
  ).apply(fontFamily: TryOnTokens.fontFamily, fontFamilyFallback: TryOnTokens.fontFamilyFallback);
  return ThemeData(
    brightness: brightness,
    useMaterial3: true,
    fontFamily: TryOnTokens.fontFamily,
    fontFamilyFallback: TryOnTokens.fontFamilyFallback,
    scaffoldBackgroundColor: t.background,
    canvasColor: t.background,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: t.primary,
      onPrimary: t.primaryForeground,
      secondary: t.foreground,
      onSecondary: t.background,
      error: t.destructive,
      onError: t.primaryForeground,
      surface: t.background,
      onSurface: t.foreground,
      outline: t.border,
    ),
    textTheme: base,
    dividerColor: t.border,
    focusColor: t.ring.withValues(alpha: 0.3),
    textSelectionTheme: TextSelectionThemeData(cursorColor: t.foreground),
  );
}
