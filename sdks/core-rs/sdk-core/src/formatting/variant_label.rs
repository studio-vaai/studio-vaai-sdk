//! Typed axis-label operands at the platform boundary. Axis roles and
//! combination formats are the experience's own types, not another model.
use state_machine::{AxisKey, AxisRole, ForeignIds, ItemDisplay, VariantAxis, VariantLabelFormat};

#[derive(Clone, Debug, PartialEq, uniffi::Record)]
pub struct VariantLabel {
    pub axes: Vec<VariantLabelAxis>,
    pub formats: Vec<VariantLabelFormat>,
}
#[derive(Clone, Debug, PartialEq, uniffi::Record)]
pub struct VariantLabelAxis {
    pub key: AxisKey,
    pub role: Option<AxisRole>,
    /// The caller's already-localized item label, used literally.
    pub label: String,
}

/// The label-bearing part of a picker row.
#[derive(uniffi::Record)]
pub struct VariantLabelRow {
    pub key: AxisKey,
    pub role: Option<AxisRole>,
    pub items: Vec<VariantLabelItem>,
}

#[derive(uniffi::Record)]
pub struct VariantLabelItem {
    pub display: ItemDisplay,
    pub selected: bool,
}

impl VariantLabelAxis {
    fn from_display(key: AxisKey, role: Option<AxisRole>, display: &ItemDisplay) -> Self {
        let label = match display {
            ItemDisplay::Text { text } => text,
            ItemDisplay::Color { alt, .. }
            | ItemDisplay::Image { alt, .. }
            | ItemDisplay::Glyph { alt, .. } => alt,
        };
        Self {
            key,
            role,
            label: label.clone(),
        }
    }
}

/// Builds a label from the selected items in the host's display order.
#[uniffi::export]
pub fn selection_label_value(
    rows: Vec<VariantLabelRow>,
    formats: Vec<VariantLabelFormat>,
) -> VariantLabel {
    let axes = rows
        .into_iter()
        .filter_map(|row| {
            let item = row.items.iter().find(|item| item.selected)?;
            Some(VariantLabelAxis::from_display(
                row.key,
                row.role,
                &item.display,
            ))
        })
        .collect();
    VariantLabel { axes, formats }
}

/// Builds a label for a specific variant, independent of the current selection.
#[uniffi::export]
pub fn variant_label_for_foreign_ids(
    foreign_ids: Option<ForeignIds>,
    axes: Vec<VariantAxis>,
    formats: Vec<VariantLabelFormat>,
) -> VariantLabel {
    let axes = axes
        .into_iter()
        .filter_map(|axis| {
            let key = foreign_ids.as_ref()?.get(&axis.key)?;
            let item = axis.items.iter().find(|item| item.key == *key)?;
            Some(VariantLabelAxis::from_display(
                axis.key,
                axis.role,
                &item.display,
            ))
        })
        .collect();
    VariantLabel { axes, formats }
}

fn role_name(role: AxisRole) -> String {
    match role {
        AxisRole::Size => "size",
        AxisRole::Color => "color",
        AxisRole::Style => "style",
    }
    .into()
}
impl From<VariantLabel> for formatting::VariantLabel {
    fn from(value: VariantLabel) -> Self {
        Self {
            axes: value
                .axes
                .into_iter()
                .map(|axis| formatting::LabelAxis {
                    key: axis.key.into(),
                    role: axis.role.map(role_name),
                    label: axis.label,
                })
                .collect(),
            formats: value
                .formats
                .into_iter()
                .map(|format| formatting::LabelFormat {
                    role: format.role.map(role_name),
                    format: format.format,
                })
                .collect(),
        }
    }
}
