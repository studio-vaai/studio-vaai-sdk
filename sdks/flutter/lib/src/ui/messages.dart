import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

import '../generated/studio_vaai_core.dart' as core;

/// The experience's text: the core's MessageFormat 2 catalog (the same keys
/// and translations as the web SDK) for [locale], with the host's MF2
/// overrides compiled against it. Every message is formatted in Rust.
final class TryOnMessages {
  TryOnMessages(String locale, {Map<String, String>? overrides})
    : _catalog = core.MessageCatalog(locale: locale, hasHostMessages: overrides != null) {
    try {
      for (final MapEntry(:key, :value) in (overrides ?? const {}).entries) {
        _compiled[key] = _catalog.compile(source: value);
      }
    } catch (_) {
      dispose();
      rethrow;
    }
  }

  final core.MessageCatalog _catalog;
  final _compiled = <String, core.Message>{};
  final _cache = <String, core.FormattedMessage?>{};
  bool _disposed = false;

  /// The locales the catalog ships.
  static List<String> get locales => core.messageLocales();

  /// The locale formatting uses (the requested one, canonicalized).
  String get locale => _catalog.locale();

  /// The catalog's locale whose text is shown, such as `de` for `de-AT`.
  String get catalogLocale => _catalog.catalogLocale();

  /// The message's parts, or `null` for an unknown key.
  core.FormattedMessage? format(String key, [Map<String, Object> values = const {}]) {
    if (_disposed) return null;
    final cacheable = values.isEmpty;
    if (cacheable && _cache.containsKey(key)) return _cache[key];
    final arguments = {for (final e in values.entries) e.key: _argument(e.value)};
    final message =
        _compiled[key]?.formatToParts(values: arguments) ??
        _catalog.formatToParts(key: key, values: arguments);
    if (cacheable) _cache[key] = message;
    return message;
  }

  /// The message as plain text: markup dropped, as the web's `ui.text`.
  String text(String key, [Map<String, Object> values = const {}]) {
    final message = format(key, values);
    if (message == null) return '';
    final out = StringBuffer();
    for (final part in message.parts) {
      switch (part) {
        case core.TextMessagePart(:final value) ||
            core.StringMessagePart(:final value) ||
            core.BidiIsolationMessagePart(:final value):
          out.write(value);
        case core.NumberMessagePart(:final parts):
          for (final p in parts) {
            out.write(p.value);
          }
        case core.FallbackMessagePart(:final source):
          out.write('{$source}');
        default:
          break;
      }
    }
    return out.toString();
  }

  /// The message with its markup as styled spans: `link` (its `href`
  /// opens through [onLink]), `b`/`strong`, `i`/`em` and `br`. Nothing
  /// else is interpreted, as on the web.
  InlineSpan rich(
    String key, {
    Map<String, Object> values = const {},
    TextStyle? linkStyle,
    void Function(Uri uri)? onLink,
    List<GestureRecognizer>? recognizers,
  }) {
    final message = format(key, values);
    if (message == null) return const TextSpan();
    final root = _Frame('');
    final parents = <_Frame>[];
    var current = root;
    for (final part in message.parts) {
      switch (part) {
        case core.TextMessagePart(:final value) ||
            core.StringMessagePart(:final value) ||
            core.BidiIsolationMessagePart(:final value):
          current.children.add(value);
        case core.NumberMessagePart(:final parts):
          current.children.add(parts.map((p) => p.value).join());
        case core.FallbackMessagePart(:final source):
          current.children.add('{$source}');
        case core.MarkupMessagePart(:final kind, :final name, :final options):
          if (kind == core.MarkupKind.open) {
            parents.add(current);
            final href = options.where((o) => o.name == 'href').firstOrNull?.value;
            current = _Frame(name, href: _safeHref(href));
          } else if (kind == core.MarkupKind.close && current.name == name && parents.isNotEmpty) {
            final parent = parents.removeLast();
            parent.children.add(current);
            current = parent;
          } else if (kind == core.MarkupKind.standalone && name == 'br') {
            current.children.add('\n');
          }
        default:
          break;
      }
    }
    while (parents.isNotEmpty) {
      final parent = parents.removeLast();
      parent.children.add(current);
      current = parent;
    }
    return _span(root, linkStyle, onLink, recognizers);
  }

  InlineSpan _span(
    _Frame frame,
    TextStyle? linkStyle,
    void Function(Uri)? onLink,
    List<GestureRecognizer>? recognizers,
  ) {
    final children = [
      for (final child in frame.children)
        child is _Frame ? _span(child, linkStyle, onLink, recognizers) : TextSpan(text: '$child'),
    ];
    switch (frame.name) {
      case 'link' when frame.href != null:
        final uri = Uri.parse(frame.href!);
        final recognizer = TapGestureRecognizer()..onTap = () => onLink?.call(uri);
        recognizers?.add(recognizer);
        return TextSpan(
          style: linkStyle,
          recognizer: recognizer,
          semanticsLabel: null,
          children: children,
        );
      case 'b' || 'strong':
        return TextSpan(
          style: const TextStyle(fontWeight: FontWeight.w600),
          children: children,
        );
      case 'i' || 'em':
        return TextSpan(
          style: const TextStyle(fontStyle: FontStyle.italic),
          children: children,
        );
      default:
        return TextSpan(children: children);
    }
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    for (final message in _compiled.values) {
      message.dispose();
    }
    _compiled.clear();
    _cache.clear();
    _catalog.dispose();
  }
}

core.MessageArgument _argument(Object value) => switch (value) {
  final String s => core.StringMessageArgument(s),
  final num n => core.NumberMessageArgument(n.toDouble()),
  final core.VariantLabel label => core.VariantLabelMessageArgument(label),
  final Iterable<String> items => core.ListMessageArgument(items.toList()),
  _ => core.StringMessageArgument('$value'),
};

String? _safeHref(String? value) {
  if (value == null || value.isEmpty) return null;
  final uri = Uri.tryParse(value);
  if (uri == null) return null;
  final scheme = uri.hasScheme ? uri.scheme : 'https';
  return const {'https', 'http', 'mailto'}.contains(scheme) ? value : null;
}

final class _Frame {
  _Frame(this.name, {this.href});
  final String name;
  final String? href;
  final children = <Object>[];
}
