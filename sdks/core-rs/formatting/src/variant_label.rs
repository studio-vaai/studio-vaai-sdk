//! `:variantLabel` composes caller-localized values. It never translates,
//! evaluates caller labels as MF2, or reaches into a session/selection.

use std::any::Any;
use std::collections::{BTreeMap, BTreeSet};

use mf2_runtime::{CustomValue, ErrorSink, FnContext, FormatError, Function, Options, Sink, Value};

#[derive(Clone, Debug, PartialEq)]
pub struct VariantLabel {
    pub axes: Vec<LabelAxis>,
    pub formats: Vec<LabelFormat>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct LabelAxis {
    pub key: String,
    pub role: Option<String>,
    pub label: String,
}
#[derive(Clone, Debug, PartialEq)]
pub struct LabelFormat {
    pub role: Option<String>,
    pub format: String,
}
impl CustomValue for VariantLabel {
    fn as_any(&self) -> Option<&dyn Any> {
        Some(self)
    }
}

pub struct VariantLabelFunction;
pub static VARIANT_LABEL: VariantLabelFunction = VariantLabelFunction;
struct FormattedLabel(String);

impl Function for VariantLabelFunction {
    fn resolve<'a>(
        &self,
        _cx: &FnContext<'_>,
        operand: Option<&Value<'a>>,
        options: &Options<'_, 'a>,
        errs: &mut dyn ErrorSink,
    ) -> Option<Value<'a>> {
        let Some(Value::Custom(custom)) = operand else {
            errs.error(FormatError::BadOperand);
            return None;
        };
        let Some(label) = custom
            .as_any()
            .and_then(|value| value.downcast_ref::<VariantLabel>())
        else {
            errs.error(FormatError::BadOperand);
            return None;
        };
        if options.iter().any(|(key, _)| key != "role") {
            errs.error(FormatError::BadOption);
            return None;
        }
        let role = match options.get("role") {
            None => None,
            Some(option) => match option.value {
                Value::Str(role) if matches!(*role, "size" | "color" | "style") => Some(*role),
                _ => {
                    errs.error(FormatError::BadOption);
                    return None;
                }
            },
        };
        match compose(label, role) {
            Ok(text) => Some(Value::Boxed(Box::new(FormattedLabel(text)))),
            Err(()) => {
                errs.error(FormatError::BadOperand);
                None
            }
        }
    }
    fn format(&self, _cx: &FnContext<'_>, value: &Value<'_>, out: &mut dyn Sink) {
        if let Value::Boxed(value) = value
            && let Some(FormattedLabel(text)) = value.downcast_ref::<FormattedLabel>()
        {
            out.push_str(text)
        }
    }
}

/// Validates placeholders against exactly the selected axes. Single-pass
/// substitution preserves braces and markup-looking text inside value labels.
fn compose(value: &VariantLabel, role: Option<&str>) -> Result<String, ()> {
    let axes: Vec<_> = value
        .axes
        .iter()
        .filter(|axis| role.is_none() || axis.role.as_deref() == role)
        .collect();
    if axes.is_empty() {
        return Ok(String::new());
    }
    let formats: Vec<_> = value
        .formats
        .iter()
        .filter(|format| format.role.as_deref() == role)
        .collect();
    if formats.len() > 1 {
        return Err(());
    }
    let Some(format) = formats.first() else {
        return Ok(axes
            .iter()
            .map(|axis| axis.label.as_str())
            .collect::<Vec<_>>()
            .join(if role == Some("size") { " / " } else { " · " }));
    };
    let values: BTreeMap<_, _> = axes
        .iter()
        .map(|axis| (axis.key.as_str(), axis.label.as_str()))
        .collect();
    if values.len() != axes.len() || format.format.is_empty() || format.format.chars().count() > 512
    {
        return Err(());
    }
    let mut seen = BTreeSet::new();
    let mut out = String::new();
    let mut remaining = format.format.as_str();
    while let Some(start) = remaining.find(['{', '}']) {
        if remaining.as_bytes()[start] != b'{' {
            return Err(());
        }
        out.push_str(&remaining[..start]);
        remaining = &remaining[start + 1..];
        let end = remaining.find(['{', '}']).ok_or(())?;
        if remaining.as_bytes()[end] != b'}' {
            return Err(());
        }
        let key = &remaining[..end];
        let label = values.get(key).ok_or(())?;
        if !seen.insert(key) {
            return Err(());
        }
        out.push_str(label);
        remaining = &remaining[end + 1..];
    }
    out.push_str(remaining);
    if seen.len() != values.len() {
        return Err(());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Argument, Message, MessagePart};
    fn data() -> VariantLabel {
        VariantLabel {
            axes: vec![
                LabelAxis {
                    key: "w".into(),
                    role: Some("size".into()),
                    label: "27".into(),
                },
                LabelAxis {
                    key: "l".into(),
                    role: Some("size".into()),
                    label: "30 kurz".into(),
                },
                LabelAxis {
                    key: "finish".into(),
                    role: Some("color".into()),
                    label: "Naturweiß".into(),
                },
            ],
            formats: vec![LabelFormat {
                role: Some("size".into()),
                format: "W{w} / L{l}".into(),
            }],
        }
    }
    #[test]
    fn formats_roles_and_caller_combinations_without_translating() {
        let message = Message::compile("de", "{$variant :variantLabel role=|color|} in {$variant :variantLabel role=|size|} anprobieren").unwrap();
        let result = message.format_to_parts(&[("variant", Argument::VariantLabel(data()))]);
        assert!(result.errors.is_empty());
        let text: String = result
            .parts
            .iter()
            .filter_map(|part| match part {
                MessagePart::Text { value } | MessagePart::String { value, .. } => {
                    Some(value.as_str())
                }
                _ => None,
            })
            .collect();
        assert_eq!(text, "Naturweiß in W27 / L30 kurz anprobieren");
    }
    #[test]
    fn absent_roles_are_empty_and_unknown_options_are_errors() {
        assert_eq!(compose(&data(), Some("style")), Ok(String::new()));
        let message = Message::compile("en", "{$variant :variantLabel role=|unknown|}").unwrap();
        assert!(
            !message
                .format_to_parts(&[("variant", Argument::VariantLabel(data()))])
                .errors
                .is_empty()
        );
    }
    #[test]
    fn bad_formats_fail_and_inserted_text_is_never_evaluated() {
        for bad in [
            "{w}",
            "{w}{l}{w}",
            "{other}{l}",
            "{w}{l",
            "{w}}{l}",
            "{w}{l}",
        ] {
            let mut value = data();
            value.formats[0].format = bad.into();
            if bad == "{w}{l}" {
                value.axes[0].label = "{l}<b>".into();
                assert_eq!(compose(&value, Some("size")), Ok("{l}<b>30 kurz".into()));
            } else {
                assert!(compose(&value, Some("size")).is_err());
            }
        }
    }
}
