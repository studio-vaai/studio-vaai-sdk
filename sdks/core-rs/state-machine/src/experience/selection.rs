//! The selection: the flow's product, how the host shows its axes, the
//! variant selected and which of its items were chosen, the rows the axes
//! are shown as, and asking the storefront to add a variant to the cart.

use std::collections::BTreeSet;

use super::presentation::{AutoStart, DisplayedImage, refusal};
use super::size_recommendation::variant_unavailable;
use super::{DefaultController, Plan, Purpose};
use crate::domain::*;
use crate::error::Rejection;
use crate::ids::*;
use crate::values::*;

/// The product as the host shows it: the backend's product, how its axes are
/// shown, and the variant selected.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct HostProduct {
    /// The product, as the backend lists it; the session shows it.
    pub product: Product,
    /// How the host shows the product's axes: every axis once, in display
    /// order.
    pub axes: Vec<VariantAxis>,
    /// Caller-owned combination formats for labels, independent of locale.
    pub label_formats: Vec<VariantLabelFormat>,
    /// The variant selected.
    pub variant_id: VariantId,
    /// The axes whose item the host chose on purpose, such as the colorway
    /// the shopper picked on the product page; the size recommendation may
    /// change the others. All of them make the selection explicit.
    pub chosen_axes: Vec<AxisKey>,
}

/// One axis the shopper chooses along, as the host shows it. The host
/// supplies every name, label and image; the backend supplies none.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct VariantAxis {
    /// Optional meaning for context-specific labels; never inferred from its key.
    pub role: Option<AxisRole>,
    /// The axis, as the variants' foreign IDs name it.
    pub key: AxisKey,
    /// The axis's heading, such as `Size`; `None` when its items speak for
    /// themselves.
    pub label: Option<String>,
    /// Semantic rendering hints; omitted uses chips in the picker.
    pub display_options: Option<AxisDisplayOptions>,
    /// Its items in display order, each once. An item no variant has is
    /// shown unavailable, and a variant with an item not shown here is
    /// never chosen through the rows.
    pub items: Vec<AxisItem>,
}

/// Optional axis meaning used by label formatting, never by variant selection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum AxisRole {
    Size,
    Color,
    Style,
}

/// A caller-owned format such as `W{waist} L{inseam}`. Each selected
/// axis key must occur exactly once; inserted values remain literal text.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct VariantLabelFormat {
    /// Applies to axes with this role, or all axes when omitted.
    pub role: Option<AxisRole>,
    pub format: String,
}

/// One item of an axis, as the host shows it.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct AxisItem {
    /// The shop's identifier of the item, as the variants' foreign IDs
    /// name it.
    pub key: ForeignId,
    /// How it is shown.
    pub display: ItemDisplay,
}

/// How the host shows one item of an axis, as its storefront does.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ItemDisplay {
    /// As text, such as `XXL (EU 52-54)`.
    Text {
        /// The text, in the shopper's language.
        text: String,
    },
    /// As a color swatch.
    Color {
        /// The color.
        hex: HexColor,
        /// What the color shows, for those who cannot see it, such as
        /// `Black/Black`.
        alt: String,
    },
    /// As an image, such as a colorway's swatch photo.
    Image {
        /// Where the image is.
        url: ImageUrl,
        /// What the image shows, for those who cannot see it, such as
        /// `Black/Black`.
        alt: String,
    },
    /// As a shared glyph with a visible, localized name.
    Glyph {
        /// The glyph's meaning; each platform draws it in its own icon set.
        glyph: ItemGlyph,
        /// The visible name, also used when the glyph cannot be seen.
        alt: String,
    },
}

/// Platform-independent glyphs for variant items. These describe the item,
/// rather than prescribing a platform's asset name or rendering technique.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ItemGlyph {
    /// A garment worn buttoned.
    ShirtButtoned,
    /// A garment worn open.
    ShirtOpen,
}

/// How a platform composes an axis, independent of its item displays.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct AxisDisplayOptions {
    /// The control used for the axis's items.
    pub control: AxisControl,
    /// The semantic region; platforms choose responsive geometry themselves.
    pub placement: AxisPlacement,
}

/// The interaction control used to draw an axis.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum AxisControl {
    /// Separate choice chips.
    Chips,
    /// One segmented control.
    Segmented,
}

/// Where an axis belongs in the default experience.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum AxisPlacement {
    /// Selects the next variant, inside the variant picker.
    Picker,
    /// Switches the displayed result, beside its history.
    ResultToolbar,
}

/// The selection, as the view shows it.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SelectionView {
    /// The host's formats, unchanged; item text is already localized by the caller.
    pub label_formats: Vec<VariantLabelFormat>,
    /// The selected variant.
    pub variant_id: VariantId,
    /// The axes whose item the host or shopper chose.
    pub chosen_axes: Vec<AxisKey>,
    /// Whether the size recommendation picked the items on the other axes.
    pub recommended: bool,
    /// The variant selected by applying the current size recommendation.
    pub recommended_variant_id: Option<VariantId>,
    /// The product's axes as rows to choose from.
    pub rows: Vec<VariantRow>,
}

/// One axis as a row of items to choose from, in the host's order.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct VariantRow {
    /// The host axis's explicit semantic role.
    pub role: Option<AxisRole>,
    /// The axis.
    pub key: AxisKey,
    /// Its heading, if the host gave one.
    pub label: Option<String>,
    /// The host's semantic rendering hints, unchanged.
    pub display_options: Option<AxisDisplayOptions>,
    /// Its items, in the host's order.
    pub items: Vec<VariantRowItem>,
}

/// One item of a row, with what choosing it does.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct VariantRowItem {
    /// The shop's identifier of the item.
    pub key: ForeignId,
    /// How the host shows it.
    pub display: ItemDisplay,
    /// Whether the selected variant has it.
    pub selected: bool,
    /// Whether a variant has it together with the selection's items on
    /// every other axis; otherwise choosing it changes some of those too.
    pub available: bool,
    /// The variant choosing it selects; `None` when no variant has it.
    pub variant_id: Option<VariantId>,
    /// Why the backend refused to try that variant on the body, once a
    /// try-on of it was refused.
    pub refusal: Option<RefusalReason>,
}

/// Host inputs installed with the initial product in one commit.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct InitialProductInstallation {
    pub token: InteractionToken,
    pub active: bool,
    pub unavailable_variants: Vec<VariantId>,
}

/// The host's current product installation, including changes for the same product ID.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ProductInstallation {
    pub product_id: ProductId,
    /// The host's desired product and display inputs.
    pub request: InteractionToken,
    /// Identity of this specific attempt, also used to scope stock updates.
    pub token: InteractionToken,
    pub status: ProductInstallationStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ProductInstallationStatus {
    Pending,
    Ready,
    Failed,
}

/// The product, the selected variant and the cart.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SelectionAction {
    SetProductActive {
        active: bool,
    },
    BeginProductInstallation {
        product_id: ProductId,
        token: InteractionToken,
    },
    FinishProductInstallation {
        token: InteractionToken,
        host_product: Option<HostProduct>,
        unavailable_variants: Vec<VariantId>,
    },
    /// The storefront changed which variants it allows shoppers to try on.
    SetUnavailableVariants {
        variant_ids: Vec<VariantId>,
        /// The accepted installation these facts describe. Omit only before
        /// a host installation is established.
        #[cfg_attr(feature = "uniffi", uniffi(default))]
        installation: Option<InteractionToken>,
    },
    /// Updates the storefront's explicit options for the installed product.
    SetStorefrontSelection {
        options: ForeignIds,
        #[cfg_attr(feature = "uniffi", uniffi(default))]
        installation: Option<InteractionToken>,
    },
    /// The host shows another product, the same one changed, or another
    /// selection of it; the session shows it from then on. Sent again
    /// unchanged, it changes nothing.
    HostProductUpdated {
        /// The product as the host now shows it.
        host_product: HostProduct,
        /// Install stock in the same transition, if provided.
        #[cfg_attr(feature = "uniffi", uniffi(default))]
        unavailable_variants: Option<Vec<VariantId>>,
    },
    /// Chooses an item on one axis without trying it on: the variant with
    /// it that keeps the most of the selection's other items, chosen ones
    /// first. The size recommendation never changes the axis afterwards.
    SelectItem {
        /// The axis.
        axis: AxisKey,
        /// The item chosen on it.
        item: ForeignId,
    },
    /// Asks the host to add a variant. The host closes the flow after its cart accepts it.
    RequestResultCart {
        try_on_id: TryOnId,
        variant_id: VariantId,
    },
    RequestAddToCart {
        /// The exact variant the shopper chose to add.
        variant_id: VariantId,
    },
}

/// What happened to the selection.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SelectionEvent {
    /// A request to the storefront, not proof the cart changed.
    AddToCartRequested { request: super::CartRequest },
}

/// How the host shows the product's axes, and the variant the flow tries
/// on.
#[derive(Clone, Debug)]
pub(super) struct Selection {
    /// How the host shows the axes, in display order.
    pub axes: Vec<VariantAxis>,
    pub label_formats: Vec<VariantLabelFormat>,
    /// What the host last selected, which tells a changed host product from
    /// one sent again.
    pub host: HostSelection,
    storefront_options: Option<ForeignIds>,
    /// The selected variant.
    pub variant_id: VariantId,
    /// The axes whose item the host or shopper chose; the size
    /// recommendation never changes them.
    pub chosen: BTreeSet<AxisKey>,
    /// The size recommendation that picked the items on the other axes,
    /// until an item is chosen.
    pub recommended_by: Option<SizeRecommendationKey>,
}

/// What the host selected: a variant, and the axes chosen on purpose.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct HostSelection {
    /// The variant.
    pub variant_id: VariantId,
    /// The axes whose item the host chose on purpose.
    pub chosen: BTreeSet<AxisKey>,
}

impl Selection {
    /// `variant_id` of `product`, its axes shown as `axes`, with the host
    /// having chosen the items on `chosen_axes`; refused unless `axes` shows
    /// every axis of the product once, each item once, and both the
    /// variant and the chosen axes are the product's.
    pub fn new(
        product: &Product,
        axes: Vec<VariantAxis>,
        label_formats: Vec<VariantLabelFormat>,
        variant_id: VariantId,
        chosen_axes: Vec<AxisKey>,
    ) -> Result<Self, Rejection> {
        let product_axes: BTreeSet<_> = product.axes().collect();
        let shown: BTreeSet<_> = axes.iter().map(|a| &a.key).collect();
        if shown != product_axes || shown.len() != axes.len() {
            return Err(Rejection::AxesNotShownOnce);
        }
        for axis in &axes {
            let mut items = BTreeSet::new();
            if !axis
                .items
                .iter()
                .all(|i| !i.key.is_empty() && items.insert(&i.key))
            {
                return Err(Rejection::ItemsNotShownOnce);
            }
        }
        product
            .variant(variant_id)
            .ok_or(Rejection::UnknownVariant)?;
        let chosen: BTreeSet<_> = chosen_axes.into_iter().collect();
        if !chosen.iter().all(|a| product_axes.contains(a)) {
            return Err(Rejection::AxisNotOfProduct);
        }
        Ok(Self {
            axes,
            label_formats,
            host: HostSelection {
                variant_id,
                chosen: chosen.clone(),
            },
            storefront_options: None,
            variant_id,
            chosen,
            recommended_by: None,
        })
    }

    /// Whether the host changed only display data for the same product choices.
    fn same_choices(&self, other: &Self) -> bool {
        self.host == other.host
            && self.axes.len() == other.axes.len()
            && self.axes.iter().all(|axis| {
                other.axes.iter().any(|updated| {
                    axis.key == updated.key
                        && axis.items.len() == updated.items.len()
                        && axis
                            .items
                            .iter()
                            .all(|item| updated.items.iter().any(|other| item.key == other.key))
                })
            })
    }

    /// Whether the host or shopper chose the item on every axis.
    pub fn explicit(&self) -> bool {
        self.chosen.len() == self.axes.len()
    }

    /// Whether every item of `variant` is shown, so the rows can choose it.
    pub fn shows(&self, variant: &Variant) -> bool {
        self.axes.iter().all(|axis| {
            variant
                .foreign_ids
                .get(&axis.key)
                .is_some_and(|id| axis.items.iter().any(|i| &i.key == id))
        })
    }

    /// Of `candidates`, the shown one keeping the most of the selection's
    /// items, chosen ones first; the first one wins a tie. With
    /// `keep_chosen`, only those keeping every chosen item qualify.
    pub(super) fn closest<'a>(
        &self,
        product: &'a Product,
        base: VariantId,
        candidates: impl Iterator<Item = &'a Variant>,
        chosen_axes: &BTreeSet<AxisKey>,
        keep_chosen: bool,
    ) -> Option<&'a Variant> {
        let current = &product.variant(base)?.foreign_ids;
        let mut best: Option<(&Variant, (usize, usize))> = None;
        for variant in candidates.filter(|v| self.shows(v)) {
            let chosen = variant.foreign_ids.agreement(current, chosen_axes);
            if keep_chosen && chosen != chosen_axes.len() {
                continue;
            }
            let score = (
                chosen,
                variant.foreign_ids.agreement(current, product.axes()),
            );
            if best.is_none_or(|(_, b)| score > b) {
                best = Some((variant, score));
            }
        }
        best.map(|(variant, _)| variant)
    }

    /// The variant choosing `item` on `axis` selects: one with that item
    /// keeping the most of the selection's other items.
    pub fn target<'a>(
        &self,
        product: &'a Product,
        axis: &AxisKey,
        item: &ForeignId,
    ) -> Option<&'a Variant> {
        let with_item = product
            .variants
            .iter()
            .filter(|v| v.foreign_ids.get(axis) == Some(item));
        self.closest(product, self.variant_id, with_item, &self.chosen, false)
    }

    /// Chooses `item` on `axis`: selects its target, and counts the axis as
    /// chosen; a chosen axis whose item the target changes no longer is.
    pub fn choose(
        &mut self,
        product: &Product,
        axis: &AxisKey,
        target: &Variant,
    ) -> Result<(), Rejection> {
        let current = product
            .variant(self.variant_id)
            .ok_or(Rejection::UnknownVariant)?;
        self.chosen
            .retain(|a| target.foreign_ids.get(a) == current.foreign_ids.get(a));
        self.chosen.insert(axis.clone());
        self.variant_id = target.id;
        self.recommended_by = None;
        Ok(())
    }

    /// Lets the size recommendation pick the items on the axes not chosen:
    /// in the best-scoring size that has a variant keeping every chosen
    /// item, the one keeping the most of the others. A size with a
    /// `refused` variant is skipped, whatever its other items: the backend
    /// refuses a size for the body. Returns whether one did.
    pub fn seed(
        &mut self,
        product: &Product,
        recommendation: &SizeRecommendation,
        refused: impl Fn(VariantId) -> bool,
        unavailable: impl Fn(VariantId) -> bool,
    ) -> bool {
        let seeded =
            self.recommendation_target(product, recommendation, &self.chosen, refused, unavailable);
        match seeded {
            Some(variant) => {
                self.variant_id = variant;
                self.recommended_by = Some(recommendation.key.clone());
                true
            }
            None => false,
        }
    }

    fn recommendation_target(
        &self,
        product: &Product,
        recommendation: &SizeRecommendation,
        chosen_axes: &BTreeSet<AxisKey>,
        refused: impl Fn(VariantId) -> bool,
        unavailable: impl Fn(VariantId) -> bool,
    ) -> Option<VariantId> {
        let closest = |ids: &[VariantId]| {
            self.closest(
                product,
                self.variant_id,
                product
                    .variants
                    .iter()
                    .filter(|v| ids.contains(&v.id) && !refused(v.id) && !unavailable(v.id)),
                chosen_axes,
                true,
            )
        };
        (!recommendation.no_suitable_size)
            .then(|| {
                closest(&recommendation.preferred).or_else(|| {
                    recommendation
                        .scores
                        .iter()
                        .filter(|size| !size.variant_ids.iter().any(|id| refused(*id)))
                        .find_map(|size| closest(&size.variant_ids))
                })
            })
            .flatten()
            .map(|variant| variant.id)
    }

    /// Recommends size again while keeping the shopper's chosen non-size axes.
    pub(super) fn recommended_variant(&self, snapshot: &DomainSnapshot) -> Option<VariantId> {
        let product = snapshot.product.as_ref()?;
        let recommendation = snapshot.size_recommendation.as_ref()?;
        let size_axes: BTreeSet<_> = self
            .axes
            .iter()
            .filter(|axis| axis.role == Some(AxisRole::Size))
            .map(|axis| axis.key.clone())
            .collect();
        if size_axes.is_empty() {
            return None;
        }
        let chosen_axes = self.chosen.difference(&size_axes).cloned().collect();
        self.recommendation_target(
            product,
            recommendation,
            &chosen_axes,
            |id| refusal(snapshot, id).is_some(),
            |id| variant_unavailable(snapshot, id),
        )
    }

    pub(super) fn choose_recommended_variant(&mut self, variant_id: VariantId) {
        self.variant_id = variant_id;
        self.chosen.extend(
            self.axes
                .iter()
                .filter(|axis| axis.role == Some(AxisRole::Size))
                .map(|axis| axis.key.clone()),
        );
        self.recommended_by = None;
    }

    /// The axes as rows to choose from: each item with the variant choosing
    /// it selects, and that variant's `refusal`, if the backend refused it.
    pub fn rows(
        &self,
        product: &Product,
        refusal: impl Fn(VariantId) -> Option<RefusalReason>,
    ) -> Vec<VariantRow> {
        let Some(current) = product.variant(self.variant_id) else {
            return Vec::new();
        };
        self.axes
            .iter()
            .map(|axis| VariantRow {
                key: axis.key.clone(),
                role: axis.role,
                label: axis.label.clone(),
                display_options: axis.display_options,
                items: axis
                    .items
                    .iter()
                    .map(|item| {
                        let target = self.target(product, &axis.key, &item.key);
                        VariantRowItem {
                            key: item.key.clone(),
                            display: item.display.clone(),
                            selected: current.foreign_ids.get(&axis.key) == Some(&item.key),
                            available: target.is_some_and(|t| {
                                t.foreign_ids.same_beside(&current.foreign_ids, &axis.key)
                            }),
                            variant_id: target.map(|t| t.id),
                            refusal: target.and_then(|t| refusal(t.id)),
                        }
                    })
                    .collect(),
            })
            .collect()
    }

    /// Whether the domain's current size recommendation picked the items
    /// on the axes nobody chose.
    pub fn recommended(&self, snapshot: &DomainSnapshot) -> bool {
        !variant_unavailable(snapshot, self.variant_id)
            && refusal(snapshot, self.variant_id).is_none()
            && self.recommended_by.as_ref().is_some_and(|key| {
                snapshot
                    .size_recommendation
                    .as_ref()
                    .is_some_and(|r| &r.key == key)
            })
    }

    /// What the view shows of the selection, with the product's rows.
    pub fn view(&self, snapshot: &DomainSnapshot) -> SelectionView {
        SelectionView {
            label_formats: self.label_formats.clone(),
            variant_id: self.variant_id,
            chosen_axes: self.chosen.iter().cloned().collect(),
            recommended: self.recommended(snapshot),
            recommended_variant_id: self.recommended_variant(snapshot),
            rows: snapshot
                .product
                .as_ref()
                .map(|p| self.rows(p, |id| refusal(snapshot, id)))
                .unwrap_or_default(),
        }
    }
}

impl DefaultController {
    pub(super) fn selection_action(
        &mut self,
        action: SelectionAction,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        match action {
            SelectionAction::SetProductActive { active } => {
                self.product_active = active;
                if !active {
                    self.presence_action(super::PresenceAction::Close, snapshot, plan)?;
                }
            }
            SelectionAction::BeginProductInstallation { product_id, token } => {
                if snapshot.product.as_ref().map(|product| product.id) != Some(product_id) {
                    self.presence_action(super::PresenceAction::Close, snapshot, plan)?;
                }
                self.product_installation = Some(ProductInstallation {
                    product_id,
                    request: token,
                    token: self.token()?,
                    status: ProductInstallationStatus::Pending,
                });
            }
            SelectionAction::FinishProductInstallation {
                token,
                host_product,
                unavailable_variants,
            } => {
                let Some(installation) = self.product_installation.as_mut().filter(|install| {
                    install.token == token && install.status == ProductInstallationStatus::Pending
                }) else {
                    return Ok(());
                };
                let Some(host_product) = host_product else {
                    installation.status = ProductInstallationStatus::Failed;
                    return Ok(());
                };
                if installation.product_id != host_product.product.id {
                    return Err(Rejection::NoProductShown);
                }
                installation.status = ProductInstallationStatus::Ready;
                self.install_host_product(
                    host_product,
                    Some(unavailable_variants),
                    snapshot,
                    plan,
                )?;
                if plan.commands.is_empty() {
                    self.policy(snapshot, plan)?;
                }
            }
            SelectionAction::SetUnavailableVariants {
                variant_ids,
                installation,
            } => {
                if match self.product_installation {
                    Some(current) => {
                        current.status != ProductInstallationStatus::Ready
                            || installation != Some(current.token)
                    }
                    None => installation.is_some(),
                } {
                    return Ok(());
                }
                let mut variant_ids = variant_ids;
                variant_ids.sort_unstable();
                variant_ids.dedup();
                self.issue.take_if(|issue| {
                    matches!(issue, super::Issue::StockUnavailable { variant_id, .. }
                    if !variant_ids.contains(variant_id))
                });
                if snapshot.unavailable_variants != variant_ids {
                    plan.command(
                        Purpose::UpdateStock,
                        TryOnCommand::SetUnavailableVariants { variant_ids },
                    );
                }
            }
            SelectionAction::SetStorefrontSelection {
                options,
                installation,
            } => {
                if self.product_available()
                    && self.product_installation.map(|current| current.token) == installation
                {
                    self.set_storefront_selection(options, snapshot, plan);
                }
            }
            SelectionAction::HostProductUpdated {
                host_product,
                unavailable_variants,
            } => {
                // A synchronous host update supersedes any in-flight installation.
                // Carry stock only for variants that survive a managed catalogue update.
                let unavailable_variants = unavailable_variants.or_else(|| {
                    self.product_installation.map(|_| {
                        if snapshot.product.as_ref().map(|product| product.id)
                            != Some(host_product.product.id)
                        {
                            return Vec::new();
                        }
                        snapshot
                            .unavailable_variants
                            .iter()
                            .copied()
                            .filter(|id| host_product.product.variant(*id).is_some())
                            .collect()
                    })
                });
                let token = self.token()?;
                self.product_installation = Some(ProductInstallation {
                    token,
                    request: token,
                    product_id: host_product.product.id,
                    status: ProductInstallationStatus::Ready,
                });
                self.install_host_product(host_product, unavailable_variants, snapshot, plan)?;
            }
            SelectionAction::SelectItem { axis, item } => {
                self.select(axis, item, snapshot, plan)?
            }
            SelectionAction::RequestResultCart {
                try_on_id,
                variant_id,
            } => {
                self.request_cart(variant_id, Some(try_on_id), snapshot, plan)?;
            }
            SelectionAction::RequestAddToCart { variant_id } => {
                self.request_cart(variant_id, None, snapshot, plan)?;
            }
        }
        Ok(())
    }

    fn set_storefront_selection(
        &mut self,
        options: ForeignIds,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) {
        if self.selection.storefront_options.as_ref() == Some(&options) {
            return;
        }
        let Some(product) = &snapshot.product else {
            return;
        };
        let matches = |variant: &Variant| {
            options
                .iter()
                .all(|(axis, item)| variant.foreign_ids.get(axis) == Some(item))
        };
        let Some(target) = self.selection.closest(
            product,
            self.selection.variant_id,
            product.variants.iter().filter(|variant| matches(variant)),
            &self.selection.chosen,
            false,
        ) else {
            return;
        };
        // A page following a presented result may echo its options while
        // the picker already has a different draft for the next try-on.
        let echoes_result = self.presence.open
            && options.axes().next().is_some()
            && self
                .last_presented_result()
                .and_then(|id| snapshot.try_on(id))
                .and_then(|result| product.variant(result.key.variant_id))
                .is_some_and(|variant| variant.foreign_ids == options);
        let chosen = options.axes().cloned().collect();
        self.selection.storefront_options = Some(options);
        if echoes_result
            || (target.id == self.selection.variant_id && chosen == self.selection.chosen)
        {
            return;
        }
        let variant_changed = self.selection.variant_id != target.id;
        self.selection.variant_id = target.id;
        self.selection.chosen = chosen;
        self.selection.recommended_by = None;
        self.issue = None;
        if self.navigation.on_try_on() {
            if variant_changed {
                self.presentation.open_variant_picker();
            }
            if self.presence.open {
                self.presentation.auto_start = AutoStart::Disarmed;
            }
            if self.try_on_screen_free().is_ok() {
                self.recommend(product, snapshot, plan);
            }
        }
    }

    fn install_host_product(
        &mut self,
        host_product: HostProduct,
        unavailable_variants: Option<Vec<VariantId>>,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        let HostProduct {
            product,
            axes,
            label_formats,
            variant_id,
            chosen_axes,
        } = host_product;
        let product = product.validated()?;
        let selection = Selection::new(&product, axes, label_formats, variant_id, chosen_axes)?;
        if snapshot.product.as_ref() == Some(&product) && self.selection.same_choices(&selection) {
            self.selection.axes = selection.axes;
            self.selection.label_formats = selection.label_formats;
            if let Some(variant_ids) = unavailable_variants
                && snapshot.unavailable_variants != variant_ids
            {
                plan.command(
                    Purpose::UpdateStock,
                    TryOnCommand::SetUnavailableVariants { variant_ids },
                );
            }
            return Ok(());
        }
        let product_changed = snapshot.product.as_ref().map(|p| p.id) != Some(product.id);
        let result_removed = match self.presentation.displayed {
            DisplayedImage::TryOn { try_on_id } => snapshot
                .try_on(try_on_id)
                .is_some_and(|result| product.variant(result.key.variant_id).is_none()),
            DisplayedImage::SourcePhoto => false,
        };
        if product_changed || result_removed {
            self.presentation.auto_start = AutoStart::Disarmed;
            self.presentation.displayed = DisplayedImage::SourcePhoto;
            self.presentation.mode = super::PresentationMode::Selection;
        }
        self.detach(snapshot, plan);
        self.selection = selection;
        self.issue = None;
        plan.command(
            Purpose::ShowProduct,
            ProductCommand::Show {
                product,
                unavailable_variants,
            },
        );
        Ok(())
    }

    pub(super) fn product_available(&self) -> bool {
        self.product_active
            && self
                .product_installation
                .is_none_or(|installation| installation.status == ProductInstallationStatus::Ready)
    }

    fn select(
        &mut self,
        axis: AxisKey,
        item: ForeignId,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        self.selection_shown()?;
        let product = snapshot.product.as_ref().ok_or(Rejection::NoProductShown)?;
        let target = self
            .selection
            .target(product, &axis, &item)
            .ok_or(Rejection::NoVariantForItem)?;
        if snapshot.unavailable_variants.contains(&target.id) {
            self.issue = Some(super::Issue::StockUnavailable {
                axis,
                item,
                variant_id: target.id,
            });
            return Ok(());
        }
        self.selection.choose(product, &axis, target)?;
        self.presentation.open_variant_picker();
        if !self.foreground_pending(snapshot) {
            self.detach(snapshot, plan);
        }
        self.presentation.auto_start = AutoStart::Disarmed;
        self.issue = None;
        Ok(())
    }

    /// Whether the selection is shown: on the try-on screen, with no modal
    /// over it.
    pub(super) fn selection_shown(&self) -> Result<(), Rejection> {
        self.unobstructed()?;
        if !self.navigation.on_try_on() {
            return Err(Rejection::SelectionUnavailable);
        }
        Ok(())
    }
}
