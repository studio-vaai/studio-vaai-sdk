import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/widgets.dart';

/// A presentation of the scripted product: a size axis, M selected.
ProductPresentation scriptedPresentation(ProductDetails details) => ProductPresentation(
  axes: [
    VariantAxis(
      role: AxisRole.size,
      key: 'size',
      label: 'Size',
      items: [
        AxisItem(key: 'M', display: TextItemDisplay('M')),
        AxisItem(key: 'L', display: TextItemDisplay('L')),
      ],
    ),
  ],
  variantId: details.variants.first.id,
);
