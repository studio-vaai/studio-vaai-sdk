import 'package:flutter/material.dart';

import '../generated/state_machine.dart';
import '../generated/studio_vaai_core.dart' as core;
import 'components.dart';
import 'fit.dart';
import 'flow_image.dart';
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
    this.fit,
    this.fitDetailsOpen = false,
    this.onFitDetails,
    this.activeCalloutKey,
    this.onActiveCallout,
    this.recovery = const [],
    this.pickerNotes = const [],
    this.resultAspect,
    this.wide = false,
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
    switch (next) {
      case TryPrimaryTryOnAction(:final variantId):
        primaryVariant = variantId;
      case RetryPrimaryTryOnAction(:final variantId):
        primaryLabel = 'retry';
        primaryVariant = variantId;
      case AlreadyWearingPrimaryTryOnAction():
        primaryLabel = 'wearing';
      default:
        break;
    }
    final opensPicker = hasPicker && !pickerOpen;
    final String primaryText = opensPicker
        ? m.text('tryOnView.variantPickerGenericTitle')
        : switch (primaryLabel) {
            'retry' =>
              presentation.retryVariantId == null
                  ? m.text('experience.retryTryOn')
                  : m.text('experience.retryNamedTryOn', {
                      'variant': labelFor(presentation.retryVariantId!, variants, rows, formats),
                    }),
            'wearing' => m.text('tryOnView.wearingVariant', selectedValues),
            _ => m.text('tryOnView.tryOnVariant', selectedValues),
          };

    final stage = StageFrame(
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (result == null || !imageReady) photo,
          ?result,
          if (phase == TryOnPhase.generating) GeneratingOverlay(text: progress),
          if (shown != null && !selecting && phase != TryOnPhase.generating) ...[
            if (fit case FitReady(:final callouts) when fitDetailsOpen && !pickerOverImage)
              FitCalloutsOverlay(
                callouts: callouts,
                aspect: resultAspect,
                activeKey: activeCalloutKey,
                onSelect: (key) => onActiveCallout?.call(key),
              ),
            if (downloadEnabled)
              Positioned(
                top: 12,
                right: 12,
                child: Semantics(
                  button: true,
                  label: m.text('tryOnView.downloadImage'),
                  excludeSemantics: true,
                  child: Material(
                    color: t.glass,
                    shape: CircleBorder(side: BorderSide(color: t.glassBorder)),
                    child: IconButton(
                      tooltip: m.text('tryOnView.downloadImage'),
                      onPressed: locked || !imageReady ? null : () => callbacks.download(shown.id),
                      icon: Icon(Icons.download_outlined, size: 20, color: t.foreground),
                    ),
                  ),
                ),
              ),
          ],
        ],
      ),
    );

    final picker = !hasPicker
        ? null
        : _PickerCard(
            open: pickerOpen,
            canClose: !wide && !selecting && phase != TryOnPhase.error,
            plain: wide,
            onClose: () => callbacks.setPicker(false),
            error: pickerOpen ? errorText : '',
            notes: pickerNotes,
            child: VariantPicker(
              selection: selection,
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
                _History(
                  results: results,
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
                if (fit != null) ...[
                  const SizedBox(height: 8),
                  FitScoreBar(
                    fit: fit,
                    label: fit is FitFailed
                        ? m.text('tryOnView.fitScoreUnavailable')
                        : m.text('tryOnView.fitScoreForVariant', shownValues),
                    open: fitDetailsOpen,
                    busy: locked || !imageReady,
                    onToggle: onFitDetails,
                    onRetry: () => callbacks.retryFit(shown.id),
                  ),
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
                  if (summaryPanel != null) ...[summaryPanel, const SizedBox(height: 16)],
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
                  ...shownValues,
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

Color? parseHex(String hex) {
  var value = hex.trim().replaceFirst('#', '');
  if (value.length == 3) value = value.split('').map((c) => '$c$c').join();
  if (value.length != 6) return null;
  final parsed = int.tryParse(value, radix: 16);
  return parsed == null ? null : Color(0xFF000000 | parsed);
}

class _PickerCard extends StatelessWidget {
  const _PickerCard({
    required this.open,
    required this.canClose,
    this.plain = false,
    required this.onClose,
    required this.error,
    required this.notes,
    required this.child,
  });

  final bool open, canClose;

  /// Without the glass card: the wide layout's panel.
  final bool plain;
  final VoidCallback onClose;
  final String error;
  final List<Widget> notes;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final m = scope.messages;
    final t = scope.tokens;
    final title = m.text('sizeAndStyleSelection.variantSectionLabel');
    final heading = Text(
      title,
      style: TextStyle(
        fontSize: 14,
        height: 20 / 14,
        fontWeight: FontWeight.w500,
        color: t.foreground,
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
          Semantics(
            header: true,
            child: canClose
                ? InkWell(
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
                  )
                : heading,
          ),
          const SizedBox(height: 8),
          child,
          for (final note in notes) ...[const SizedBox(height: 8), note],
          if (error.isNotEmpty) ...[const SizedBox(height: 8), TryOnMessage(error)],
        ],
      ),
    );
    // Wide, the panel has no glass card: the web's `sv-glass.panel` turns transparent.
    return plain ? content : TryOnGlass(child: content);
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
  });

  final SelectionView selection;
  final Map<String, List<String>>? tried;
  final Map<String, String> prices;
  final List<String> unavailable;
  final bool disabled;
  final core.VariantLabel? recommended;
  final void Function(String axis, String item) onSelect;
  final VoidCallback onSelectRecommendation;

  @override
  Widget build(BuildContext context) {
    final scope = TryOnScope.of(context);
    final m = scope.messages;
    final t = scope.tokens;
    final firstSize = selection.rows.where((r) => r.role == AxisRole.size).firstOrNull?.key;
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
              final label = (row.label == null || row.label!.isEmpty || value.isEmpty)
                  ? row.label
                  : m.text('tryOnView.variantAxisLabel', {
                      'axisLabel': row.label!,
                      'valueLabel': value,
                    });
              final recommendation = recommended != null && row.key == firstSize
                  ? m.text('tryOnView.recommendedVariant', {'variant': recommended!})
                  : null;
              final triedItems = tried?[row.key] ?? const [];
              final segmented = row.displayOptions?.control == AxisControl.segmented;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if ((label ?? '').isNotEmpty || recommendation != null)
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if ((label ?? '').isNotEmpty)
                          Text(
                            label!,
                            style: TextStyle(
                              fontSize: 13,
                              height: 1.25,
                              fontWeight: FontWeight.w300,
                              color: t.foreground,
                            ),
                          ),
                        if (recommendation != null)
                          InkWell(
                            onTap: disabled ? null : onSelectRecommendation,
                            borderRadius: BorderRadius.circular(TryOnTokens.radiusFull),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: t.positiveMuted,
                                borderRadius: BorderRadius.circular(TryOnTokens.radiusFull),
                              ),
                              child: Text(
                                recommendation,
                                style: TextStyle(fontSize: 12, color: t.positiveForeground),
                              ),
                            ),
                          ),
                      ],
                    ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: segmented ? 0 : 8,
                    runSpacing: 8,
                    children: [
                      for (final item in row.items)
                        _Option(
                          row: row,
                          item: item,
                          segmented: segmented,
                          tried: triedItems.contains(item.key),
                          soldOut: item.variantId != null && unavailable.contains(item.variantId),
                          recommended:
                              row.role == AxisRole.size &&
                              item.selected &&
                              selection.recommended &&
                              !selection.chosenAxes.contains(row.key),
                          disabled: disabled || item.variantId == null,
                          onTap: () => onSelect(row.key, item.key),
                        ),
                    ],
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
    final dimmed = soldOut || item.refusal != null || !item.available;
    final mark = (row.role == AxisRole.size && item.selected) || tried;
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
        final fg = item.selected && !segmented && !glyph ? t.primaryForeground : t.foreground;
        body = Container(
          constraints: BoxConstraints(
            minWidth: segmented || glyph ? 0 : 44,
            minHeight: segmented || glyph ? 32 : 44,
          ),
          padding: EdgeInsets.symmetric(horizontal: segmented || glyph ? 10 : 12),
          decoration: BoxDecoration(
            color: item.selected && !segmented && !glyph ? t.primary : t.background,
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
                  decoration: soldOut ? TextDecoration.lineThrough : null,
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
              if (mark)
                Positioned(
                  top: -3,
                  right: -3,
                  child: Container(
                    width: 16,
                    height: 16,
                    decoration: BoxDecoration(
                      color: t.primary,
                      shape: BoxShape.circle,
                      border: Border.all(color: t.background, width: 1.5),
                    ),
                    child: Icon(Icons.check, size: 10, color: t.primaryForeground),
                  ),
                ),
              if (item.refusal != null)
                Positioned(
                  bottom: -6,
                  left: 0,
                  right: 0,
                  child: Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: BoxDecoration(
                        color: t.destructiveMuted,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        item.refusal == RefusalReason.garmentTooSmall
                            ? m.text('sizeAndStyleSelection.sizeGateTooSmallBadge')
                            : m.text('sizeAndStyleSelection.sizeGateTooLargeBadge'),
                        style: TextStyle(fontSize: 9, color: t.destructiveForeground),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
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
          border: Border.all(color: t.border),
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
