import 'dart:async';

import 'package:flutter/material.dart';

import '../generated/state_machine.dart';
import '../generated/studio_vaai_core.dart' as core;
import 'components.dart';
import 'fit.dart';
import 'flow_image.dart';
import 'messages.dart';
import 'scope.dart';
import 'screens.dart';
import 'theme.dart';

/// MF2 context flags for a variant label, as the web's `variantLabelValues`.
Map<String, Object> variantLabelValues(core.VariantLabel? label) {
  final variant = label ?? core.VariantLabel(axes: [], formats: []);
  final present = variant.axes.where((a) => a.label.isNotEmpty);
  return {
    'variant': variant,
    'hasVariant': present.isNotEmpty ? 'yes' : 'no',
    'hasSize': present.any((a) => a.role == AxisRole.size) ? 'yes' : 'no',
    'hasColor': present.any((a) => a.role == AxisRole.color) ? 'yes' : 'no',
  };
}

String itemDisplayText(ItemDisplay display) => switch (display) {
  TextItemDisplay(:final text) => text,
  ColorItemDisplay(:final alt) => alt,
  ImageItemDisplay(:final alt) => alt,
  GlyphItemDisplay(:final alt) => alt,
  _ => '',
};

List<VariantAxis> _axes(Iterable<VariantRow> rows) => [
  for (final r in rows)
    VariantAxis(
      role: r.role,
      key: r.key,
      label: r.label,
      displayOptions: r.displayOptions,
      items: [for (final i in r.items) AxisItem(key: i.key, display: i.display)],
    ),
];

/// The variant label of [variantId] along [rows] (`variantLabelValue`).
core.VariantLabel labelFor(
  String variantId,
  List<Variant> variants,
  Iterable<VariantRow> rows,
  List<VariantLabelFormat> formats,
) => core.variantLabelForForeignIds(
  foreignIds: variants.where((v) => v.id == variantId).firstOrNull?.foreignIds,
  axes: _axes(rows),
  formats: formats,
);

/// A size label as plain text (the web's `sizeLabelText`): its size axes in
/// the host's format, or joined with " / ".
String sizeLabelText(core.VariantLabel label) {
  final sizes = label.axes.where((a) => a.role == AxisRole.size && a.label.isNotEmpty);
  final format = label.formats.where((f) => f.role == AxisRole.size).firstOrNull?.format;
  if (format == null) return sizes.map((a) => a.label).join(' / ');
  return sizes.fold(format, (text, a) => text.replaceFirst('{${a.key}}', a.label));
}

/// The current selection's label (`selectionLabelValue`).
core.VariantLabel selectionLabel(SelectionView selection) => core.selectionLabelValue(
  rows: [
    for (final r in selection.rows)
      core.VariantLabelRow(
        key: r.key,
        role: r.role,
        items: [
          for (final i in r.items) core.VariantLabelItem(display: i.display, selected: i.selected),
        ],
      ),
  ],
  formats: selection.labelFormats,
);

enum TryOnPhase { ready, generating, error }

/// What the try-on screen does on the shopper's input; the renderer turns
/// each into a flow action.
class TryOnCallbacks {
  const TryOnCallbacks({
    required this.select,
    required this.showTryOn,
    required this.showAxisItem,
    required this.setPicker,
    required this.tryOn,
    required this.replacePhoto,
    required this.addToCart,
    required this.download,
    required this.retryFit,
    required this.selectRecommendation,
  });
  final void Function(String axis, String item) select;
  final void Function(String tryOnId) showTryOn;
  final void Function(String axis, String item) showAxisItem;
  final void Function(bool open) setPicker;
  final void Function(String variantId) tryOn;
  final VoidCallback replacePhoto;
  final void Function(String tryOnId, String variantId) addToCart;
  final void Function(String tryOnId) download;
  final void Function(String tryOnId) retryFit;
  final VoidCallback selectRecommendation;
}

/// Variant selection and try-on results (`sv-try-on-view-screen`).
class TryOnResultScreen extends StatelessWidget {
  const TryOnResultScreen({
    super.key,
    required this.navigation,
    required this.productName,
    required this.selection,
    required this.presentation,
    required this.product,
    required this.tryOns,
    required this.prices,
    required this.unavailable,
    required this.photo,
    required this.result,
    required this.resultImageState,
    required this.phase,
    required this.callbacks,
    this.error,
    this.statusMessage,
    this.requestPending = false,
    this.busy = false,
    this.cart,
    this.downloadEnabled = false,
    this.downloadVisible = false,
    this.downloadPending = false,
    this.fit,
    this.fitDetailsOpen = false,
    this.onFitDetails,
    this.activeCalloutKey,
    this.onActiveCallout,
    this.recovery = const [],
    this.pickerNotes = const [],
    this.resultAspect,
    this.wide = false,
    this.sizeNote,
  });

  final ScreenNavigation navigation;
  final String? productName;
  final SelectionView selection;
  final PresentationView presentation;
  final Product? product;
  final List<TryOn> tryOns;
  final Map<String, String> prices;
  final List<String> unavailable;
  final Widget photo;

  /// The result image, once the flow shows one.
  final Widget? result;

  /// `loading`, `ready`, `error`, or null without a result.
  final String? resultImageState;
  final TryOnPhase phase;
  final TryOnCallbacks callbacks;
  final String? error, statusMessage;
  final bool requestPending, busy;
  final ResultActionView? cart;
  final bool downloadEnabled;

  /// Whether the host can take a download: the control shows over every
  /// result, disabled while unavailable.
  final bool downloadVisible;

  /// A download in progress: the control stays, with a spinner beside it.
  final bool downloadPending;
  final FitView? fit;
  final bool fitDetailsOpen;
  final ValueChanged<bool>? onFitDetails;

  /// The pinned callout, while the fit details are open.
  final String? activeCalloutKey;
  final ValueChanged<String?>? onActiveCallout;
  final List<Widget> recovery, pickerNotes;
  final double? resultAspect;

  /// The web's wide layout: the picker always open, beside the image.
  final bool wide;

  /// Said on the picker's size row in place of the recommendation: why the
  /// fit gate refuses the selected size, and the size to try instead.
  final String? sizeNote;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final m = scope.messages;
    final t = scope.tokens;
    final variants = product?.variants ?? const <Variant>[];
    final rows = selection.rows;
    final formats = selection.labelFormats;
    final results = [for (final id in presentation.tryOns) ...tryOns.where((r) => r.id == id)];
    final displayed = presentation.displayed;
    final shown = displayed is TryOnDisplayedImage
        ? results.where((r) => r.id == displayed.tryOnId).firstOrNull
        : null;
    final selecting = shown == null || presentation.mode == PresentationMode.selection;
    final hasPicker = rows.isNotEmpty;
    final pickerOpen =
        hasPicker && (wide || selecting || presentation.mode == PresentationMode.editingVariant);
    // Over the image only on narrow screens; wide, the picker sits in the panel.
    final pickerOverImage = pickerOpen && !wide;
    final imageReady = resultImageState == null || resultImageState == 'ready';
    final locked = busy;

    final shownLabel = shown == null
        ? null
        : labelFor(shown.key.variantId, variants, rows, formats);
    final shownValues = variantLabelValues(shownLabel);
    final selectedValues = variantLabelValues(selectionLabel(selection));
    final title = productName ?? m.text('sessionIntro.defaultProductName');
    final summary = shown == null ? '' : m.text('tryOnView.variantSummary', shownValues);
    final provenance = shown == null ? '' : m.text('tryOnView.aiGeneratedLabel');
    final subtitle = selecting && shown == null
        ? m.text('sizeAndStyleSelection.variantSubtitle')
        : [summary, provenance].where((p) => p.isNotEmpty).join(' · ');
    final shownVariantId = shown?.key.variantId;
    final shownPrice = shownVariantId == null ? null : prices[shownVariantId];
    final shownSoldOut = shownVariantId != null && unavailable.contains(shownVariantId);
    final cartVariantId = selecting || shownSoldOut ? null : shownVariantId;
    final errorText =
        error ??
        (phase == TryOnPhase.error ? m.text('tryOnView.variantTryOnFailed', selectedValues) : '');
    final progress = m.text('tryOnView.busyMessages.0');
    final status =
        statusMessage ??
        (phase == TryOnPhase.generating
            ? progress
            : (selecting && busy ? m.text('sizeAndStyleSelection.busyTryOnSr') : null));

    // The primary action, as the web's `primaryAction`.
    final next = presentation.primaryAction;
    var primaryLabel = 'tryOn';
    String? primaryVariant;
    // What "Try on …" names: the selection, or the size offered in its place.
    var tryOnValues = selectedValues;
    switch (next) {
      case TryPrimaryTryOnAction(:final variantId):
        primaryVariant = variantId;
      case RetryPrimaryTryOnAction(:final variantId):
        primaryLabel = 'retry';
        primaryVariant = variantId;
      case TryNextFittingPrimaryTryOnAction(:final variantId):
        // The fit gate refuses the selection: the button offers the next size
        // that can be tried on, and pressing it selects that size and tries it.
        primaryVariant = variantId;
        tryOnValues = variantLabelValues(labelFor(variantId, variants, rows, formats));
      case AlreadyWearingPrimaryTryOnAction():
        primaryLabel = 'wearing';
      case UnavailablePrimaryTryOnAction():
        // Closed: nothing can be tried on now (a refusal with no size left, a
        // sold-out variant, a request in flight).
        break;
      case null:
        break;
    }
    final opensPicker = hasPicker && !pickerOpen;
    // The picker's heading, the same open or collapsed (the web's `pickerHeading`).
    final pickerRows = rows.where(
      (r) => r.displayOptions?.placement != AxisPlacement.resultToolbar,
    );
    String pickerHeading({required bool hasResult}) => m.text('tryOnView.pickerHeading', {
      'hasResult': hasResult ? 'yes' : 'no',
      'hasSize': pickerRows.any((r) => r.role == AxisRole.size) ? 'yes' : 'no',
      'hasColor': pickerRows.any((r) => r.role == AxisRole.color) ? 'yes' : 'no',
    });
    final String primaryText = opensPicker
        ? pickerHeading(hasResult: true)
        : switch (primaryLabel) {
            'retry' =>
              presentation.retryVariantId == null
                  ? m.text('experience.retryTryOn')
                  : m.text('experience.retryNamedTryOn', {
                      'variant': labelFor(presentation.retryVariantId!, variants, rows, formats),
                    }),
            'wearing' => m.text('tryOnView.wearingVariant', selectedValues),
            _ => m.text('tryOnView.tryOnVariant', tryOnValues),
          };

    final stage = StageFrame(
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (result == null || !imageReady) photo,
          ?result,
          if (phase == TryOnPhase.generating) GeneratingOverlay(text: progress),
          if (shown != null && !selecting && phase != TryOnPhase.generating) ...[
            if (fit case FitReady(
              :final callouts,
              :final subject,
            ) when fitDetailsOpen && !pickerOverImage)
              LayoutBuilder(
                builder: (context, box) => FitCalloutsOverlay(
                  callouts: callouts,
                  subject: subject,
                  aspect: resultAspect,
                  activeKey: activeCalloutKey,
                  onSelect: (key) => onActiveCallout?.call(key),
                  // The cards keep clear of the download button.
                  keepOut: [if (downloadVisible) Rect.fromLTWH(box.maxWidth - 60, 12, 48, 48)],
                ),
              ),
            // The download control stays in place while it is unavailable or
            // busy, so it never flashes: disabled, and a spinner beside it
            // once a download takes longer than a moment.
            if (downloadVisible) ...[
              if (downloadPending)
                const Positioned(
                  top: 12 + 14,
                  right: 12 + 48 + 8,
                  child: _DelayedSpinner(key: ValueKey('try-on-download-busy')),
                ),
              Positioned(
                top: 12,
                right: 12,
                child: Semantics(
                  button: true,
                  enabled: downloadEnabled && !downloadPending && !locked && imageReady,
                  label: m.text('tryOnView.downloadImage'),
                  excludeSemantics: true,
                  child: Material(
                    key: const ValueKey('try-on-download'),
                    color: t.glass,
                    shape: CircleBorder(side: BorderSide(color: t.glassBorder)),
                    child: IconButton(
                      tooltip: m.text('tryOnView.downloadImage'),
                      onPressed: !downloadEnabled || downloadPending || locked || !imageReady
                          ? null
                          : () => callbacks.download(shown.id),
                      icon: Icon(
                        Icons.download_outlined,
                        size: 20,
                        color: t.foreground.withValues(
                          alpha: downloadEnabled || downloadPending ? 1 : 0.4,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ],
      ),
    );

    final picker = !hasPicker
        ? null
        : _PickerCard(
            title: pickerHeading(hasResult: shown != null),
            open: pickerOpen,
            canClose: !wide && !selecting && phase != TryOnPhase.error,
            plain: wide,
            onClose: () => callbacks.setPicker(false),
            error: pickerOpen ? errorText : '',
            notes: pickerNotes,
            child: VariantPicker(
              // On the glass card a row that overflows scrolls out to its edges.
              edgeInset: wide ? 0 : _PickerCard.inset,
              selection: selection,
              sizeNote: sizeNote,
              tried: presentation.triedItems,
              prices: prices,
              unavailable: unavailable,
              disabled: locked,
              recommended:
                  selection.recommendedVariantId == null ||
                      unavailable.contains(selection.recommendedVariantId)
                  ? null
                  : labelFor(
                      selection.recommendedVariantId!,
                      variants,
                      rows.where((r) => r.role == AxisRole.size),
                      formats,
                    ),
              onSelect: callbacks.select,
              onSelectRecommendation: callbacks.selectRecommendation,
            ),
          );

    final summaryPanel = shown == null
        ? null
        : IgnorePointer(
            ignoring: selecting || pickerOverImage,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Wide, as on the web, the fit score leads and the picker's
                // marks show what was tried; the variant history is a phone's.
                if (wide && fit != null) _fitBar(fit!, shown, shownValues, locked, imageReady, m),
                _History(
                  results: wide ? const [] : results,
                  shown: shown,
                  disabled: locked,
                  labelOf: (id) => labelFor(
                    id,
                    variants,
                    rows.where((r) => r.displayOptions?.placement != AxisPlacement.resultToolbar),
                    formats,
                  ),
                  swatchOf: (id) => _swatch(id, variants, rows),
                  toolbar: [
                    for (final row in presentation.axisRows)
                      if (row.displayOptions?.placement == AxisPlacement.resultToolbar) row,
                  ],
                  onShow: callbacks.showTryOn,
                  onShowAxisItem: callbacks.showAxisItem,
                ),
                if (!wide && fit != null) ...[
                  const SizedBox(height: 8),
                  _fitBar(fit!, shown, shownValues, locked, imageReady, m),
                ],
              ],
            ),
          );

    return Semantics(
      label: shown == null
          ? null
          : [title, summary, provenance].where((p) => p.isNotEmpty).join(' · '),
      child: TryOnScreen(
        title: title,
        subtitle: subtitle,
        back: navigation.back,
        onBack: navigation.onBack,
        onClose: navigation.onClose,
        busy: locked,
        statusMessage: status,
        stage: stage,
        stageOverlay: pickerOverImage ? picker : null,
        panel: wide
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (summaryPanel != null) ...[summaryPanel, const SizedBox(height: 24)],
                  ?picker,
                ],
              )
            : (pickerOpen ? null : summaryPanel),
        beforeActions: [
          ...recovery,
          if (errorText.isNotEmpty && !pickerOpen) TryOnMessage(errorText),
          if (!selecting && shownSoldOut)
            Semantics(
              liveRegion: true,
              child: Text(
                m.text('tryOnView.variantSoldOut', shownValues),
                style: TextStyle(fontSize: 14, color: t.mutedForeground),
              ),
            ),
        ],
        primary: TryOnButton(
          label: primaryText,
          busy: locked || (!opensPicker && requestPending),
          onPressed: opensPicker
              ? (locked ? null : () => callbacks.setPicker(true))
              : (locked || requestPending || primaryVariant == null)
              ? null
              : () => callbacks.tryOn(primaryVariant!),
        ),
        secondary: TryOnButton(
          label: selecting
              ? m.text('sizeAndStyleSelection.useAnotherImage')
              : m.text('tryOnView.addVariantToCart', {
                  // A result the rows cannot name borrows the selection's name
                  // when it is the same variant: never "this variant" while one is named.
                  ...(shownValues['hasVariant'] == 'no' && shownVariantId == selection.variantId
                      ? selectedValues
                      : shownValues),
                  'price': shownPrice ?? '',
                  'hasPrice': shownPrice == null ? 'no' : 'yes',
                }),
          variant: ButtonVariant.ghost,
          busy: cart?.pending == true,
          onPressed: locked
              ? null
              : selecting
              ? callbacks.replacePhoto
              : (cart?.pending == true ||
                    cartVariantId == null ||
                    cart?.available != true ||
                    !imageReady)
              ? null
              : () => callbacks.addToCart(shown.id, cartVariantId),
        ),
      ),
    );
  }

  Widget _fitBar(
    FitView fit,
    TryOn shown,
    Map<String, Object> shownValues,
    bool locked,
    bool imageReady,
    TryOnMessages m,
  ) => FitScoreBar(
    fit: fit,
    label: fit is FitFailed
        ? m.text('tryOnView.fitScoreUnavailable')
        : m.text('tryOnView.fitScoreForVariant', shownValues),
    open: fitDetailsOpen,
    busy: locked || !imageReady,
    onToggle: onFitDetails,
    onRetry: () => callbacks.retryFit(shown.id),
  );

  static ({Color? color, String? image}) _swatch(
    String id,
    List<Variant> variants,
    List<VariantRow> rows,
  ) {
    final variant = variants.where((v) => v.id == id).firstOrNull;
    for (final row in rows.where((r) => r.role == AxisRole.color)) {
      final item = row.items.where((i) => i.key == variant?.foreignIds[row.key]).firstOrNull;
      switch (item?.display) {
        case ColorItemDisplay(:final hex):
          return (color: parseHex(hex), image: null);
        case ImageItemDisplay(:final url):
          return (color: null, image: url);
        default:
          break;
      }
    }
    return (color: null, image: null);
  }
}

/// A swatch too close to white to show on a pale panel without an outline:
/// the web's contrast with white below 1.3.
bool isLightSwatch(Color color) {
  final l = color.computeLuminance();
  return (1 + 0.05) / (l + 0.05) < 1.3;
}

Color? parseHex(String hex) {
  var value = hex.trim().replaceFirst('#', '');
  if (value.length == 3) value = value.split('').map((c) => '$c$c').join();
  if (value.length != 6) return null;
  final parsed = int.tryParse(value, radix: 16);
  return parsed == null ? null : Color(0xFF000000 | parsed);
}

class _PickerCard extends StatelessWidget {
  const _PickerCard({
    required this.title,
    required this.open,
    required this.canClose,
    this.plain = false,
    required this.onClose,
    required this.error,
    required this.notes,
    required this.child,
  });

  /// The card's inset; the picker's rows scroll out to the card's edges.
  static const inset = 12.0;

  final String title;
  final bool open, canClose;

  /// Without the glass card: the wide layout's panel.
  final bool plain;
  final VoidCallback onClose;
  final String error;
  final List<Widget> notes;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    final heading = Text(
      title,
      style: TextStyle(
        fontSize: 14,
        height: 20 / 14,
        fontWeight: FontWeight.w500,
        color: t.foreground,
      ),
    );
    // On the card, everything but the rows keeps the card's inset.
    Widget padded(Widget child) => plain
        ? child
        : Padding(
            padding: const EdgeInsets.symmetric(horizontal: inset),
            child: child,
          );
    Widget closable() => InkWell(
      onTap: onClose,
      child: Semantics(
        button: true,
        expanded: true,
        child: Row(
          children: [
            Expanded(child: heading),
            Icon(Icons.keyboard_arrow_up, size: 18, color: t.foreground),
          ],
        ),
      ),
    );
    final content = Semantics(
      container: true,
      label: title,
      explicitChildNodes: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Semantics(header: true, child: padded(canClose ? closable() : heading)),
          const SizedBox(height: 8),
          child,
          for (final note in notes) ...[const SizedBox(height: 8), padded(note)],
          if (error.isNotEmpty) ...[const SizedBox(height: 8), padded(TryOnMessage(error))],
        ],
      ),
    );
    // Wide, the panel has no glass card: the web's `sv-glass.panel` turns transparent.
    // Wide, the picker sits in the panel on a muted card, as the web's.
    return plain
        ? Container(
            key: const ValueKey('try-on-picker-card'),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: t.muted,
              borderRadius: BorderRadius.circular(TryOnTokens.radiusLg),
            ),
            child: content,
          )
        : TryOnGlass(
            padding: const EdgeInsets.symmetric(vertical: inset),
            child: content,
          );
  }
}

/// The product's axes as rows of chips, swatches or segments (`sv-variant-picker`).
class VariantPicker extends StatelessWidget {
  const VariantPicker({
    super.key,
    required this.selection,
    required this.tried,
    required this.prices,
    required this.unavailable,
    required this.disabled,
    required this.recommended,
    required this.onSelect,
    required this.onSelectRecommendation,
    this.sizeNote,
    this.edgeInset = 0,
  });

  final SelectionView selection;
  final Map<String, List<String>>? tried;
  final Map<String, String> prices;
  final List<String> unavailable;
  final bool disabled;
  final core.VariantLabel? recommended;
  final void Function(String axis, String item) onSelect;
  final VoidCallback onSelectRecommendation;

  /// Said about the selected size in place of the recommendation, such as why
  /// the fit gate refuses it.
  final String? sizeNote;

  /// The inset of the panel the picker sits in. The picker spans the panel's
  /// full width: labels keep the inset, and a row of choices longer than the
  /// panel scrolls sideways out to its edges, with the same inset at either end.
  final double edgeInset;

  /// The picker's width up to which the size row's badge slot sits on a line
  /// of its own (the web's container query, 24rem).
  static const narrowWidth = 384.0;

  /// The badge slot's fixed height (the web's 1.375rem): whether it holds the
  /// recommendation, a note in its place, or nothing, the size row keeps one
  /// height and the chips below never move.
  static const badgeSlotHeight = 22.0;

  /// The host's axis name, else "Size:" or "Color:" by the axis role, with
  /// the selected value (the web's `#rowLabel`).
  static String? rowLabel(TryOnMessages m, VariantRow row, String value) {
    final label = row.label;
    if (label != null && label.isNotEmpty) {
      return value.isEmpty
          ? label
          : m.text('tryOnView.variantAxisLabel', {'axisLabel': label, 'valueLabel': value});
    }
    if (row.role == AxisRole.size) {
      return m.text('tryOnView.sizeAxisLabel', {
        'hasSize': value.isEmpty ? 'no' : 'yes',
        'sizeLabel': value,
      });
    }
    if (row.role == AxisRole.color && value.isNotEmpty) {
      return m.text('tryOnView.colorAxisLabel', {'colorLabel': value});
    }
    return label;
  }

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final m = scope.messages;
    final t = scope.tokens;
    final firstSize = selection.rows.where((r) => r.role == AxisRole.size).firstOrNull?.key;
    final labelStyle = TextStyle(
      fontSize: 13,
      height: 1.25,
      fontWeight: FontWeight.w300,
      color: t.foreground,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final (index, row) in selection.rows.indexed) ...[
          if (index > 0) const SizedBox(height: 12),
          Builder(
            builder: (context) {
              final selected = row.items.where((i) => i.selected).firstOrNull;
              final value = selected == null ? '' : itemDisplayText(selected.display);
              final label = rowLabel(m, row, value);
              final note = row.key == firstSize ? sizeNote : null;
              final recommendation = recommended != null && row.key == firstSize
                  ? m.text('tryOnView.recommendedVariant', {'variant': recommended!})
                  : null;
              final triedItems = tried?[row.key] ?? const [];
              final segmented = row.displayOptions?.control == AxisControl.segmented;
              final labelText = (label ?? '').isEmpty ? null : Text(label!, style: labelStyle);
              Widget? heading;
              if (row.key == firstSize) {
                // A note replaces the recommendation: the badge is the steady
                // state, the note the interruption. Both share one slot.
                final Widget? badge = note != null
                    ? _SizeNote(note)
                    : (recommendation == null
                          ? null
                          : _RecommendationBadge(
                              label: recommendation,
                              onTap: disabled ? null : onSelectRecommendation,
                            ));
                final slot = SizedBox(
                  key: const ValueKey('try-on-size-badge-slot'),
                  height: badgeSlotHeight,
                  child: Align(alignment: AlignmentDirectional.centerStart, child: badge),
                );
                // Beside the label where the picker is wide, on a line of its
                // own where it is narrow.
                heading = LayoutBuilder(
                  builder: (context, box) => box.maxWidth <= narrowWidth
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          mainAxisSize: MainAxisSize.min,
                          children: [?labelText, const SizedBox(height: 4), slot],
                        )
                      : Row(
                          children: [
                            ?labelText,
                            const SizedBox(width: 6),
                            Expanded(child: slot),
                          ],
                        ),
                );
              } else if (labelText != null) {
                heading = labelText;
              }
              final inset = EdgeInsets.symmetric(horizontal: edgeInset);
              final options = [
                for (final item in row.items)
                  _Option(
                    row: row,
                    item: item,
                    segmented: segmented,
                    // The core marks an item whose choice selects a variant already tried.
                    tried: item.tried || triedItems.contains(item.key),
                    soldOut: item.variantId != null && unavailable.contains(item.variantId),
                    recommended:
                        row.role == AxisRole.size &&
                        item.selected &&
                        selection.recommended &&
                        !selection.chosenAxes.contains(row.key),
                    disabled: disabled || item.variantId == null,
                    onTap: () => onSelect(row.key, item.key),
                  ),
              ];
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (heading != null) ...[
                    Padding(padding: inset, child: heading),
                    const SizedBox(height: 6),
                  ],
                  if (segmented)
                    Padding(
                      padding: inset,
                      child: Wrap(runSpacing: 8, children: options),
                    )
                  else
                    SingleChildScrollView(
                      key: ValueKey('try-on-picker-row-${row.key}'),
                      scrollDirection: Axis.horizontal,
                      padding: inset,
                      child: Row(
                        children: [
                          for (final (i, option) in options.indexed) ...[
                            if (i > 0) const SizedBox(width: 8),
                            option,
                          ],
                        ],
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ],
    );
  }
}

/// The size recommendation's badge; tapping it selects the recommended size.
class _RecommendationBadge extends StatelessWidget {
  const _RecommendationBadge({required this.label, required this.onTap});
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    return Opacity(
      opacity: onTap == null ? 0.5 : 1,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(TryOnTokens.radiusFull),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: t.positiveMuted,
            borderRadius: BorderRadius.circular(TryOnTokens.radiusFull),
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12, color: t.positiveForeground),
          ),
        ),
      ),
    );
  }
}

/// A quiet note on the size row, such as why the fit gate refuses the size:
/// the theme's muted surface and text with an info icon, never an error. One
/// line; a longer note ends in an ellipsis and keeps its whole text for
/// screen readers and as its tooltip.
class _SizeNote extends StatelessWidget {
  const _SizeNote(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    final t = TryOnScope.of(context).tokens;
    return Semantics(
      liveRegion: true,
      label: text,
      excludeSemantics: true,
      child: Tooltip(
        message: text,
        excludeFromSemantics: true,
        child: Container(
          key: const ValueKey('try-on-size-note'),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: t.muted,
            borderRadius: BorderRadius.circular(TryOnTokens.radius),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.info_outline, size: 12, color: t.mutedForeground),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  text,
                  maxLines: 1,
                  softWrap: false,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12, height: 1.25, color: t.mutedForeground),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Option extends StatelessWidget {
  const _Option({
    required this.row,
    required this.item,
    required this.segmented,
    required this.tried,
    required this.soldOut,
    required this.recommended,
    required this.disabled,
    required this.onTap,
  });

  final VariantRow row;
  final VariantRowItem item;
  final bool segmented, tried, soldOut, recommended, disabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final m = scope.messages;
    final t = scope.tokens;
    final text = itemDisplayText(item.display);
    final description = [
      if (item.variantId == null)
        m.text('variantPicker.noVariant')
      else if (soldOut)
        m.text('tryOnView.sizeSoldOutSr')
      else if (item.refusal == RefusalReason.garmentTooSmall)
        m.text('variantPicker.refusedTooSmall')
      else if (item.refusal == RefusalReason.garmentTooLarge)
        m.text('variantPicker.refusedTooLarge')
      else if (!item.available)
        m.text('variantPicker.changesOtherAxes'),
      if (recommended) m.text('chip.status.recommended'),
      if (tried) m.text('tryOnView.optionTriedOn'),
    ].join(' ');
    // A size the fit gate refuses is muted and struck through, as the web's
    // `refused` chip: the note on the size row says why, so no badge.
    final refused = item.refusal != null;
    // Refused and sold-out sizes keep the same bubble as every other size;
    // only their text is muted (the picker's panel is itself the muted colour).
    final mutedText = refused || soldOut;
    final dimmed = !item.available;
    // A light check on a tried item; the selected size, once tried, a dark one.
    final current = tried && row.role == AxisRole.size && item.selected;
    Widget body;
    switch (item.display) {
      case ColorItemDisplay(:final hex):
        body = _Swatch(color: parseHex(hex), selected: item.selected);
      case ImageItemDisplay(:final url):
        body = _Swatch(image: url, selected: item.selected);
      default:
        final glyph = item.display is GlyphItemDisplay;
        final icon = switch (item.display) {
          GlyphItemDisplay(glyph: ItemGlyph.shirtButtoned) => Icons.checkroom_outlined,
          GlyphItemDisplay(glyph: ItemGlyph.shirtOpen) => Icons.dry_cleaning_outlined,
          _ => null,
        };
        final filled = item.selected && !segmented && !glyph;
        final fg = filled ? t.primaryForeground : (mutedText ? t.mutedForeground : t.foreground);
        body = Container(
          constraints: BoxConstraints(
            minWidth: segmented || glyph ? 0 : 44,
            minHeight: segmented || glyph ? 32 : 44,
          ),
          padding: EdgeInsets.symmetric(horizontal: segmented || glyph ? 10 : 12),
          decoration: BoxDecoration(
            color: filled ? t.primary : t.background,
            borderRadius: BorderRadius.circular(TryOnTokens.radiusFull),
            border: Border.all(
              color: recommended
                  ? t.positive
                  : (item.selected && (segmented || glyph) ? t.foreground : Colors.transparent),
              width: recommended ? 2 : 1,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 16, color: fg), const SizedBox(width: 6)],
              Text(
                text,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: item.selected ? FontWeight.w600 : FontWeight.w400,
                  color: fg,
                  // Struck through only for the fit gate: a verdict about the body, not stock.
                  decoration: refused && !item.selected ? TextDecoration.lineThrough : null,
                ),
              ),
            ],
          ),
        );
    }
    return Semantics(
      button: true,
      selected: item.selected,
      enabled: !disabled,
      label: '${row.label ?? ''} $text'.trim(),
      hint: description.isEmpty ? null : description,
      excludeSemantics: true,
      child: Opacity(
        opacity: disabled ? 0.4 : (dimmed ? 0.55 : 1),
        child: InkWell(
          onTap: disabled ? null : onTap,
          customBorder: const StadiumBorder(),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              body,
              if (tried) Positioned(top: 1, right: 1, child: _OptionMark(current: current)),
            ],
          ),
        ),
      ),
    );
  }
}

/// A spinner that appears only after a moment, so a quick download does not
/// flash it.
class _DelayedSpinner extends StatefulWidget {
  const _DelayedSpinner({super.key});

  @override
  State<_DelayedSpinner> createState() => _DelayedSpinnerState();
}

class _DelayedSpinnerState extends State<_DelayedSpinner> {
  bool _shown = false;
  late final _timer = Timer(const Duration(milliseconds: 150), () {
    if (mounted) setState(() => _shown = true);
  });

  @override
  void initState() {
    super.initState();
    _timer;
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      _shown ? const TryOnSpinner(size: 20) : const SizedBox.square(dimension: 20);
}

/// The check on an option already tried (the web's `option-mark`): white
/// with a black check, or black with a white check on the selected size.
class _OptionMark extends StatelessWidget {
  const _OptionMark({required this.current});
  final bool current;

  @override
  Widget build(BuildContext context) => Container(
    key: ValueKey(current ? 'option-mark-current' : 'option-mark-tried'),
    width: 15,
    height: 15,
    decoration: BoxDecoration(
      color: current ? const Color(0xFF000000) : const Color(0xFFFFFFFF),
      shape: BoxShape.circle,
      boxShadow: [
        BoxShadow(
          color: current ? const Color(0xFFFFFFFF) : const Color(0x29000000),
          spreadRadius: 1,
        ),
      ],
    ),
    child: Icon(
      Icons.check,
      size: 10,
      color: current ? const Color(0xFFFFFFFF) : const Color(0xFF000000),
    ),
  );
}

class _Swatch extends StatelessWidget {
  const _Swatch({this.color, this.image, required this.selected});
  final Color? color;
  final String? image;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final t = scope.tokens;
    final swatch = color;
    return Container(
      width: 44,
      height: 44,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: selected ? t.foreground : Colors.transparent, width: 1.5),
      ),
      child: Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: color ?? t.muted,
          // A light swatch keeps an outline of the input border on its disc,
          // so a white one still shows on a pale panel.
          border: image == null && swatch != null && isLightSwatch(swatch)
              ? Border.all(color: t.input)
              : null,
          image: image == null
              ? null
              : DecorationImage(image: scope.imageProvider(image!), fit: BoxFit.cover),
        ),
      ),
    );
  }
}

/// The tried variants, to switch between results (`sv-history-chip`s).
class _History extends StatelessWidget {
  const _History({
    required this.results,
    required this.shown,
    required this.disabled,
    required this.labelOf,
    required this.swatchOf,
    required this.toolbar,
    required this.onShow,
    required this.onShowAxisItem,
  });

  final List<TryOn> results;
  final TryOn? shown;
  final bool disabled;
  final core.VariantLabel Function(String variantId) labelOf;
  final ({Color? color, String? image}) Function(String variantId) swatchOf;
  final List<PresentedAxis> toolbar;
  final void Function(String tryOnId) onShow;
  final void Function(String axis, String item) onShowAxisItem;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final m = scope.messages;
    final t = scope.tokens;
    if (results.length < 2 && toolbar.isEmpty) return const SizedBox.shrink();
    final chips = <Widget>[];
    if (results.length >= 2) {
      for (final result in results) {
        final variantId = result.key.variantId;
        final values = variantLabelValues(labelOf(variantId));
        var label = m.text('tryOnView.historyVariantLabel', values);
        var accessible = m.text('tryOnView.historyVariantSr', values);
        final same = results.where((r) => r.key.variantId == variantId).toList();
        if (same.length > 1) {
          final number = same.indexWhere((r) => r.id == result.id) + 1;
          label = m.text('experience.resultNumber', {'label': label, 'number': number});
          accessible = m.text('experience.resultNumber', {'label': accessible, 'number': number});
        }
        final swatch = swatchOf(variantId);
        final selected = result.id == shown?.id;
        chips.add(
          Semantics(
            button: true,
            selected: selected,
            label: accessible,
            excludeSemantics: true,
            child: InkWell(
              onTap: disabled ? null : () => onShow(result.id),
              customBorder: const StadiumBorder(),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: t.background,
                  borderRadius: BorderRadius.circular(TryOnTokens.radiusFull),
                  border: Border.all(color: selected ? t.foreground : t.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (swatch.color != null) ...[
                      Container(
                        width: 16,
                        height: 16,
                        decoration: BoxDecoration(
                          color: swatch.color,
                          shape: BoxShape.circle,
                          border: Border.all(color: t.border),
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    Text(label, style: TextStyle(fontSize: 13, color: t.foreground)),
                  ],
                ),
              ),
            ),
          ),
        );
      }
    }
    for (final row in toolbar) {
      for (final item in row.items) {
        final can = item.canShow is AvailableCapability;
        chips.add(
          Semantics(
            button: true,
            selected: item.selected,
            enabled: can && !disabled,
            label: itemDisplayText(item.display),
            excludeSemantics: true,
            child: InkWell(
              onTap: !can || disabled
                  ? null
                  : () => item.tryOnId == null
                        ? onShowAxisItem(row.key, item.key)
                        : onShow(item.tryOnId!),
              customBorder: const StadiumBorder(),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(TryOnTokens.radiusFull),
                  border: Border.all(color: item.selected ? t.foreground : Colors.transparent),
                ),
                child: Text(
                  itemDisplayText(item.display),
                  style: TextStyle(
                    fontSize: 13,
                    color: t.foreground.withValues(alpha: can ? 1 : 0.4),
                  ),
                ),
              ),
            ),
          ),
        );
      }
    }
    return Semantics(
      container: true,
      label: m.text('tryOnView.triedVariantsLabel'),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final c in chips) Padding(padding: const EdgeInsets.only(right: 6), child: c),
          ],
        ),
      ),
    );
  }
}
