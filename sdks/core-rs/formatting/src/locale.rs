//! Caller locale policy and the CLDR data for that exact formatting tag.
//!
//! Product labels remain caller-provided strings. Only SDK message selection
//! and MF2 number/list/plural formatting belong here.

use icu_locale_core::Locale;
use mf2_catalog::{Catalog, Manifest, MsgId, writer};
use mf2_locale_data::{LocaleNeeds, NumberNeeds};

use crate::CompileError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LocaleSelection {
    pub catalog: &'static str,
    pub format: String,
}

/// Normalize the host's BCP 47 tag. Invalid input uses the SDK's English default.
pub fn canonicalize_locale(tag: &str) -> String {
    tag.replace('_', "-")
        .parse::<Locale>()
        .map_or_else(|_| "en".to_owned(), |locale| locale.to_string())
}

pub(crate) fn resolve(tag: &str, has_host_messages: bool) -> LocaleSelection {
    let tag = canonicalize_locale(tag);
    let language = tag.split('-').next().unwrap_or("en");
    let shipped = match language {
        "de" => Some("de"),
        "en" => Some("en"),
        _ => None,
    };
    LocaleSelection {
        catalog: shipped.unwrap_or("en"),
        format: if shipped.is_some() || has_host_messages {
            tag
        } else {
            "en".to_owned()
        },
    }
}

pub(crate) fn writer_options(tag: &str) -> Result<writer::Options, CompileError> {
    let invalid = |error: mf2_locale_data::Error| CompileError {
        message: error.to_string(),
    };
    let mut options = writer::Options::new(tag, mf2_locale_data::direction(tag).map_err(invalid)?);
    options.cldr_version = Some(mf2_locale_data::CLDR_VERSION);
    let mut needs = LocaleNeeds::default();
    needs.cardinal = true;
    needs.ordinal = true;
    let mut numbers = NumberNeeds::default();
    numbers.symbols = true;
    numbers.percent = true;
    needs.numbers = numbers;
    options.locale_entries = mf2_locale_data::locale_entries(tag, &needs).map_err(invalid)?;
    Ok(options)
}

/// Reuse the compiled message models and manifest, replacing only locale
/// metadata and CLDR entries. Runs once when the exact formatting tag differs.
pub(crate) fn with_format_locale(catalog: &Catalog, tag: &str) -> Result<Catalog, CompileError> {
    let invalid = |error: &dyn std::fmt::Display| CompileError {
        message: error.to_string(),
    };
    let manifest = Manifest::read(crate::MANIFEST_BYTES).map_err(|error| invalid(&error))?;
    let messages = (0..catalog.message_count())
        .map(|id| {
            mf2_catalog::decode(catalog, MsgId::from_raw(id)).map_err(|error| invalid(&error))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let references = messages.iter().map(Some).collect::<Vec<_>>();
    let bytes = writer::catalog(&manifest, &references, &writer_options(tag)?)
        .map_err(|error| invalid(&error))?;
    Catalog::new(bytes, manifest.hash()).map_err(|error| invalid(&error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Argument, MessagePart};

    fn text(message: crate::FormattedMessage) -> String {
        assert!(message.errors.is_empty(), "{:?}", message.errors);
        message
            .parts
            .into_iter()
            .map(|part| match part {
                MessagePart::Text { value } | MessagePart::String { value, .. } => value,
                MessagePart::Number { parts, .. } => {
                    parts.into_iter().map(|part| part.value).collect()
                }
                _ => String::new(),
            })
            .collect()
    }

    #[test]
    fn region_data_formats_numbers_and_lists_without_changing_shipped_text() {
        let swiss = crate::Catalog::for_locale("de-CH", false).unwrap();
        assert_eq!(swiss.locale(), "de-CH");
        assert_eq!(swiss.catalog_locale(), "de");
        assert_eq!(
            text(
                swiss
                    .format_to_parts("sessionIntro.sheetTitle", &[])
                    .unwrap()
            ),
            "Bereit zur Anprobe?"
        );
        let number = swiss.compile("{$value :number}").unwrap();
        assert_eq!(
            text(number.format_to_parts(&[("value", Argument::Number(1234.5))])),
            "1'234.5"
        );
        let german = crate::Catalog::for_locale("de", false).unwrap();
        assert_eq!(
            text(
                german
                    .compile("{$value :number}")
                    .unwrap()
                    .format_to_parts(&[("value", Argument::Number(1234.5))])
            ),
            "1.234,5"
        );
        assert_eq!(
            text(
                german
                    .compile("{$value :percent}")
                    .unwrap()
                    .format_to_parts(&[("value", Argument::Number(0.5))])
            ),
            "50\u{a0}%"
        );
        let british = crate::Catalog::for_locale("en-GB", false).unwrap();
        assert_eq!(
            text(
                british
                    .compile("{$values :list}")
                    .unwrap()
                    .format_to_parts(&[(
                        "values",
                        Argument::List(vec!["A".into(), "B".into(), "C".into()])
                    )])
            ),
            "A, B and C"
        );
    }

    #[test]
    fn caller_catalog_presence_opts_into_unsupported_locale_formatting() {
        let plain = crate::Catalog::for_locale("fr-CA", false).unwrap();
        assert_eq!(plain.locale(), "en");
        let caller = crate::Catalog::for_locale("fr-CA", true).unwrap();
        assert_eq!(caller.locale(), "fr-CA");
        assert_eq!(caller.catalog_locale(), "en");
        assert_eq!(
            text(
                caller
                    .format_to_parts("sessionIntro.sheetTitle", &[])
                    .unwrap()
            ),
            "Ready to try it on?"
        );
        let values = [(
            "values",
            Argument::List(vec!["A".into(), "B".into(), "C".into()]),
        )];
        assert_eq!(
            text(
                plain
                    .compile("{$values :list}")
                    .unwrap()
                    .format_to_parts(&values)
            ),
            "A, B, and C"
        );
        assert_eq!(
            text(
                caller
                    .compile("{$values :list}")
                    .unwrap()
                    .format_to_parts(&values)
            ),
            "A, B et C"
        );
    }

    #[test]
    fn caller_locale_policy_matches_catalog_and_format_independently() {
        assert_eq!(canonicalize_locale("de_ch"), "de-CH");
        assert_eq!(canonicalize_locale("not a locale!"), "en");
        assert_eq!(
            resolve("de-CH", false),
            LocaleSelection {
                catalog: "de",
                format: "de-CH".into()
            }
        );
        assert_eq!(
            resolve("fr-CA", false),
            LocaleSelection {
                catalog: "en",
                format: "en".into()
            }
        );
        assert_eq!(
            resolve("fr-CA", true),
            LocaleSelection {
                catalog: "en",
                format: "fr-CA".into()
            }
        );
    }
}
