/**
 * `@studio-vaai/react-components/primitives` — the styled, low-level building
 * blocks (Button, Sheet, Text, layout/Swatch, `cn`) re-exported from `./ui` and
 * `./typography`. Hosts assembling their own flow reach for these; the package
 * root entry instead ships the batteries / default-flow components built on top.
 */
export {
  ActionsSection,
  type ActionsSectionProps,
  Button,
  buttonVariants,
  type ButtonProps,
  type ButtonRenderProps,
  Checkbox,
  Chip,
  type ChipProps,
  cn,
  GuideGraphic,
  type GuideGraphicProps,
  ImageView,
  type ImageViewProps,
  Sheet,
  SheetBackdrop,
  SheetBleed,
  SheetBleedInset,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetPortal,
  SheetTrigger,
  SheetViewport,
  sheetBackdropVariants,
  sheetContentVariants,
  sheetViewportVariants,
  type SheetBackdropProps,
  type SheetBleedInsetProps,
  type SheetBleedProps,
  type SheetContentProps,
  type SheetViewportProps,
  Swatch,
  type SwatchProps,
  VStack,
  type VStackGap,
  type VStackProps,
} from "./ui/index.js";
export {
  legalTextClassName,
  Text,
  textVariants,
  type TextProps,
  type TextVariant,
} from "./typography/index.js";
