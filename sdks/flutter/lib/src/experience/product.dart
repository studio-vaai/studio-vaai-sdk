import 'package:flutter/foundation.dart';

import '../generated/api.dart' show ProductDetails;
import '../generated/state_machine.dart';
import '../session.dart';

/// The product to try on: by its studio vaai product ID, or by the shop's own.
@immutable
final class TryOnProductReference {
  const TryOnProductReference.id(String this.productId) : foreignId = null;
  const TryOnProductReference.foreignId(String this.foreignId) : productId = null;

  final String? productId;
  final String? foreignId;

  Future<ProductDetails> lookup(StudioVaai sdk) =>
      foreignId != null ? sdk.productByForeignId(foreignId!) : sdk.product(productId!);

  @override
  bool operator ==(Object other) =>
      other is TryOnProductReference &&
      other.productId == productId &&
      other.foreignId == foreignId;

  @override
  int get hashCode => Object.hash(productId, foreignId);
}

/// A variant's storefront price (formatted, as shown) and stock.
@immutable
final class VariantCommerce {
  const VariantCommerce({this.price, this.inStock});

  /// The formatted price, such as `€49.95`.
  final String? price;

  /// False when the storefront cannot sell the variant now.
  final bool? inStock;
}

/// How the host shows a product: its axes in display order, with every name,
/// label and swatch; the variant selected; and, optionally, prices and stock.
/// The same shape as the web SDK's `presentProduct` result.
@immutable
final class ProductPresentation {
  const ProductPresentation({
    required this.axes,
    required this.variantId,
    this.labelFormats = const [],
    this.chosenAxes = const [],
    this.commerce,
  });

  /// Every axis once, in display order.
  final List<VariantAxis> axes;

  /// Caller-owned combination formats for variant labels.
  final List<VariantLabelFormat> labelFormats;

  /// The variant selected.
  final String variantId;

  /// The axes the shopper chose on purpose, such as the colour picked on
  /// the product page; the size recommendation may change the others.
  final List<String> chosenAxes;

  /// Initial prices and stock, by studio vaai variant ID.
  final Map<String, VariantCommerce>? commerce;
}

/// Builds the presentation of the product the API returned.
typedef PresentProduct = ProductPresentation Function(ProductDetails details);

/// The flow's host product for the API's [details], as the host presents it.
({HostProduct hostProduct, Map<String, VariantCommerce>? commerce}) productPresentationFor(
  ProductDetails details,
  PresentProduct present,
) {
  final presentation = present(details);
  return (
    hostProduct: HostProduct(
      product: Product(
        id: details.productId,
        variants: [
          for (final v in details.variants) Variant(id: v.id, foreignIds: v.foreignVariantIds),
        ],
      ),
      axes: presentation.axes,
      labelFormats: presentation.labelFormats,
      variantId: presentation.variantId,
      chosenAxes: presentation.chosenAxes,
    ),
    commerce: presentation.commerce,
  );
}

/// Live commerce over the initial: prices to show, and the variants out of stock.
({Map<String, String> prices, List<String> unavailable}) resolveCommerce(
  Map<String, VariantCommerce>? initial,
  Map<String, VariantCommerce>? live,
) {
  final prices = <String, String>{};
  final unavailable = <String>[];
  for (final id in {...?initial?.keys, ...?live?.keys}) {
    final price = live?[id]?.price ?? initial?[id]?.price;
    if (price != null) prices[id] = price;
    if ((live?[id]?.inStock ?? initial?[id]?.inStock) == false) unavailable.add(id);
  }
  unavailable.sort();
  return (prices: prices, unavailable: unavailable);
}

/// A presentation with one text-chip axis per foreign-ID key, in the order the
/// API lists them, each item labelled by its own foreign ID: enough to try a
/// product on without a storefront catalogue. Name the size axis in
/// [roles] (`{'size': AxisRole.size}`) for size-aware labels.
ProductPresentation simpleProductPresentation(
  ProductDetails details, {
  Map<String, AxisRole> roles = const {},
  Map<String, String> labels = const {},
  String? variantId,
}) {
  final keys = <String>[];
  final items = <String, List<String>>{};
  for (final variant in details.variants) {
    for (final MapEntry(:key, :value) in variant.foreignVariantIds.entries) {
      if (!keys.contains(key)) keys.add(key);
      final values = items.putIfAbsent(key, () => []);
      if (!values.contains(value)) values.add(value);
    }
  }
  return ProductPresentation(
    axes: [
      for (final key in keys)
        VariantAxis(
          role: roles[key],
          key: key,
          label: labels[key],
          items: [
            for (final item in items[key]!) AxisItem(key: item, display: TextItemDisplay(item)),
          ],
        ),
    ],
    variantId: variantId ?? details.variants.first.id,
  );
}
