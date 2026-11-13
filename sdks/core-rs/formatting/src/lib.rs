//! Messages in Unicode MessageFormat 2 (MF2), formatted to parts.
//!
//! A message is compiled once for a locale and then formatted with named
//! arguments into the parts MF2 defines: text, formatted placeholders,
//! markup and fallbacks, with the Default Bidi Strategy's isolation around
//! placeholders. Nothing is flattened to a string, so markup such as
//! `{#b}…{/b}` or `{#link href=|…|}…{/link}` reaches the renderer, which
//! decides how it looks.
//!
//! The functions are MF2's `:string`, `:number` and `:integer`, plus `:list`,
//! which joins a list argument the way the locale writes a conjunction
//! ("A, B und C"). Locale data comes from CLDR: plural rules and number
//! symbols through the MF2 engine, list patterns through ICU4X.

mod locale;
mod variant_label;
pub use locale::canonicalize_locale;
pub use variant_label::{LabelAxis, LabelFormat, VariantLabel};

use std::any::Any;
use std::fmt::{self, Write as _};

use icu_list::ListFormatter;
use icu_list::options::{ListFormatterOptions, ListLength};
use icu_locale_core::Locale;
use mf2_catalog::writer;
use mf2_runtime::{
    Arg, CustomValue, ErrorSink, FallbackSource, FnContext, FormatContext, FormatError, Formatter,
    Function, Host, Isolation, MsgId, Options, Part, PartSink, Registry, Sink, SubPartSink, Value,
};
use writeable::Writeable as _;

/// A message compiled for one locale, ready to format many times.
#[derive(Debug)]
pub struct Message {
    catalog: mf2_catalog::Catalog,
}

/// A named argument's value.
#[derive(Debug, Clone, PartialEq)]
pub enum Argument {
    /// Typed, caller-localized axis values for `:variantLabel`.
    VariantLabel(VariantLabel),
    String(String),
    Number(f64),
    Integer(i64),
    /// The items of a list, for `:list`.
    List(Vec<String>),
}

/// A formatted message: its parts in order, and what went wrong while
/// formatting. A message with errors still formats, showing fallbacks.
#[derive(Debug, Clone, PartialEq)]
pub struct FormattedMessage {
    pub parts: Vec<MessagePart>,
    pub errors: Vec<MessageError>,
}

/// A part of a formatted message, as MF2 defines formatted parts.
/// Concatenated, the parts' text is the message as a string.
#[derive(Debug, Clone, PartialEq)]
pub enum MessagePart {
    /// Literal text from the message.
    Text { value: String },
    /// A placeholder formatted as a string.
    String {
        locale: String,
        dir: Direction,
        id: Option<String>,
        value: String,
    },
    /// A placeholder formatted as a number, in its locale's sub-parts.
    Number {
        locale: String,
        dir: Direction,
        id: Option<String>,
        parts: Vec<NumberPart>,
    },
    /// Markup: it writes no text, it says how the text between an open and
    /// its close is meant to look.
    Markup {
        kind: MarkupKind,
        name: String,
        id: Option<String>,
        options: Vec<MarkupOption>,
    },
    /// A placeholder that could not be formatted, shown as `{source}`.
    Fallback { source: String },
    /// A bidi isolation control around a placeholder.
    BidiIsolation { value: String },
}

/// A placeholder's text direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Ltr,
    Rtl,
    Auto,
}

/// Whether markup opens, closes, or stands alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkupKind {
    Open,
    Close,
    Standalone,
}

/// One option of a markup element, e.g. a link's `href`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkupOption {
    pub name: String,
    pub value: String,
}

/// One sub-part of a formatted number: its kind (`integer`, `group`,
/// `decimal`, `fraction`, `minusSign`, …) and text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumberPart {
    pub kind: String,
    pub value: String,
}

/// What went wrong while formatting, by MF2's error names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageError {
    UnresolvedVariable,
    UnknownFunction,
    BadSelector,
    BadOperand,
    BadOption,
    BadVariantKey,
    UnsupportedOperation,
    MessageFunctionError,
    MissingFallbackVariant,
    Other,
}

/// A message that does not compile: its syntax or data model is invalid, or
/// its locale is unknown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompileError {
    pub message: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CompileError {}

include!(concat!(env!("OUT_DIR"), "/catalogs.rs"));

/// The SDK's own messages for one locale, compiled when the SDK was built.
#[derive(Debug)]
pub struct Catalog {
    inner: mf2_catalog::Catalog,
    catalog_locale: &'static str,
}

impl Catalog {
    /// The locales the SDK ships messages for.
    pub fn locales() -> impl Iterator<Item = &'static str> {
        CATALOGS.iter().map(|(tag, _)| *tag)
    }

    /// The shipped catalog for `locale`, or for its language when the exact
    /// tag is not shipped (`de-CH` → `de`).
    pub fn shipped(locale: &str) -> Option<Catalog> {
        let language = locale.parse::<Locale>().ok()?.id.language;
        let (catalog_locale, bytes) = CATALOGS
            .iter()
            .find(|(tag, _)| *tag == locale)
            .or_else(|| CATALOGS.iter().find(|(tag, _)| *tag == language.as_str()))?;
        let inner = mf2_catalog::Catalog::from_static(bytes, MANIFEST_HASH).ok()?;
        Some(Catalog {
            inner,
            catalog_locale,
        })
    }

    /// Select SDK text independently from the exact locale used to format values.
    /// Unsupported languages use English formatting unless the caller supplies
    /// a message catalog (including an empty or partial catalog).
    pub fn for_locale(locale: &str, has_host_messages: bool) -> Result<Self, CompileError> {
        let selection = locale::resolve(locale, has_host_messages);
        let mut catalog = Self::shipped(selection.catalog).ok_or_else(|| CompileError {
            message: format!("no messages ship for {:?}", selection.catalog),
        })?;
        if catalog.locale() != selection.format {
            catalog.inner = locale::with_format_locale(&catalog.inner, &selection.format)?;
        }
        Ok(catalog)
    }

    /// The exact tag used for MF2 value formatting.
    pub fn locale(&self) -> &str {
        self.inner.locale()
    }

    /// The language of the shipped SDK text, before caller overrides.
    pub fn catalog_locale(&self) -> &str {
        self.catalog_locale
    }

    /// Formats the SDK message `key` (e.g. `sessionIntro.legalFooter`);
    /// `None` when there is no such message.
    pub fn format_to_parts(
        &self,
        key: &str,
        arguments: &[(&str, Argument)],
    ) -> Option<FormattedMessage> {
        let index = IDS.binary_search(&key).ok()?;
        let id = MsgId::from_raw(u32::try_from(index).ok()?);
        Some(format(&self.inner, id, arguments))
    }

    /// Compiles MF2 `source` — a host's override — against this catalog's
    /// exact formatting locale, with its CLDR number and plural data.
    pub fn compile(&self, source: &str) -> Result<Message, CompileError> {
        let parsed = mf2_syntax::parse_model(source);
        let model = match parsed.message {
            Some(model) if parsed.diagnostics.is_empty() => model,
            _ => {
                let message = parsed
                    .diagnostics
                    .into_vec()
                    .iter()
                    .map(|diagnostic| match &diagnostic.span {
                        Some(span) => {
                            format!("{:?} at {}..{}", diagnostic.kind, span.start, span.end)
                        }
                        None => format!("{:?}", diagnostic.kind),
                    })
                    .collect::<Vec<_>>()
                    .join("; ");
                return Err(CompileError { message });
            }
        };
        let analysis = mf2_syntax::analyze(&model);
        let slots: Vec<&str> = analysis.externals.iter().map(|name| &*name.nfc).collect();
        let options = locale::writer_options(self.locale())?;
        let invalid = |error: &dyn fmt::Display| CompileError {
            message: error.to_string(),
        };
        let (bytes, manifest) =
            writer::single(&model, &slots, &options).map_err(|e| invalid(&e))?;
        let catalog = mf2_catalog::Catalog::new(bytes, manifest.hash()).map_err(|e| invalid(&e))?;
        Ok(Message { catalog })
    }
}

impl Message {
    /// Compiles caller-supplied MF2 `source` for the exact formatting locale.
    pub fn compile(locale: &str, source: &str) -> Result<Self, CompileError> {
        if locale.replace('_', "-").parse::<Locale>().is_err() {
            return Err(CompileError {
                message: format!("{locale:?} is not a BCP 47 locale tag"),
            });
        }
        let catalog = Catalog::for_locale(locale, true)?;
        catalog.compile(source)
    }

    /// The locale the message was compiled for.
    pub fn locale(&self) -> &str {
        self.catalog.locale()
    }

    /// Formats the message with named `arguments` into parts.
    pub fn format_to_parts(&self, arguments: &[(&str, Argument)]) -> FormattedMessage {
        format(&self.catalog, MsgId::from_raw(0), arguments)
    }
}

/// Formats message `id` of `catalog` with named `arguments` into parts.
fn format(
    catalog: &mf2_catalog::Catalog,
    id: MsgId,
    arguments: &[(&str, Argument)],
) -> FormattedMessage {
    let lists: Vec<ListArgument> = arguments
        .iter()
        .filter_map(|(_, argument)| match argument {
            Argument::List(items) => Some(ListArgument(items.clone())),
            _ => None,
        })
        .collect();
    let mut lists = lists.iter();
    let args: Vec<(&str, Arg<'_>)> = arguments
        .iter()
        .map(|(name, argument)| {
            let arg = match argument {
                Argument::VariantLabel(value) => Arg::Custom(value),
                Argument::String(value) => Arg::Str(value),
                Argument::Number(value) => Arg::Float(*value),
                Argument::Integer(value) => Arg::Int(*value),
                Argument::List(_) => match lists.next() {
                    Some(list) => Arg::Custom(list),
                    None => Arg::Unset,
                },
            };
            (*name, arg)
        })
        .collect();

    let formatter = Formatter::new(catalog, &REGISTRY, &CONTEXT);
    let mut parts = Parts::default();
    let mut errors = Errors::default();
    formatter.parts_named(id, &args, &mut parts, &mut errors);
    FormattedMessage {
        parts: parts.0,
        errors: errors.0,
    }
}

/// The functions messages may call, and the formatter of bare numbers.
static FUNCTIONS: [(&str, &dyn Function); 6] = [
    ("integer", &mf2_fn_number::INTEGER),
    ("list", &LIST),
    ("number", &mf2_fn_number::NUMBER),
    ("percent", &mf2_fn_number::PERCENT),
    ("string", &mf2_runtime::functions::STRING),
    ("variantLabel", &variant_label::VARIANT_LABEL),
];
static REGISTRY: Registry = Registry::new(&FUNCTIONS).with_numbers(&mf2_fn_number::NUMBERS);
static HOST: CoreHost = CoreHost;
static CONTEXT: FormatContext = FormatContext::new(&HOST);

/// The platform services the engine asks for. Floats print in Rust's
/// shortest round-trip form; there is no time-zone data, which only the
/// date functions (not registered) would need.
struct CoreHost;

impl Host for CoreHost {
    fn f64_to_text<'b>(&self, x: f64, buf: &'b mut [u8; 32]) -> Option<&'b str> {
        let len = {
            let mut out = ByteWriter {
                buf: &mut *buf,
                len: 0,
            };
            let magnitude = x.abs();
            let written = if magnitude != 0.0 && !(1e-6..1e21).contains(&magnitude) {
                write!(out, "{x:e}")
            } else {
                write!(out, "{x}")
            };
            written.ok()?;
            out.len
        };
        std::str::from_utf8(&buf[..len]).ok()
    }
}

/// Writes into a fixed buffer, failing when it is full.
struct ByteWriter<'b> {
    buf: &'b mut [u8; 32],
    len: usize,
}

impl fmt::Write for ByteWriter<'_> {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        let end = self.len.checked_add(s.len()).ok_or(fmt::Error)?;
        self.buf
            .get_mut(self.len..end)
            .ok_or(fmt::Error)?
            .copy_from_slice(s.as_bytes());
        self.len = end;
        Ok(())
    }
}

/// A list argument, handed to the engine as a custom value.
struct ListArgument(Vec<String>);

impl CustomValue for ListArgument {
    fn as_any(&self) -> Option<&dyn Any> {
        Some(self)
    }
}

/// `:list`: the operand's items joined as the locale writes a conjunction,
/// in its long form ("size, color and length" / "Größe, Farbe und Länge").
/// A single string is a one-item list. It formats as a string.
struct ListFunction;

static LIST: ListFunction = ListFunction;

/// What `:list` resolved to: the joined text.
struct JoinedList(String);

impl Function for ListFunction {
    fn resolve<'a>(
        &self,
        cx: &FnContext<'_>,
        operand: Option<&Value<'a>>,
        _options: &Options<'_, 'a>,
        errs: &mut dyn ErrorSink,
    ) -> Option<Value<'a>> {
        let items: Vec<String> = match operand {
            Some(Value::Custom(custom)) => match custom
                .as_any()
                .and_then(|any| any.downcast_ref::<ListArgument>())
            {
                Some(list) => list.0.clone(),
                None => vec![custom.as_str()?.to_owned()],
            },
            Some(Value::Str(item)) => vec![(*item).to_owned()],
            _ => {
                errs.error(FormatError::BadOperand);
                return None;
            }
        };
        let Some(formatter) = list_formatter(cx.locale()) else {
            errs.error(FormatError::UnsupportedOperation);
            return None;
        };
        let joined = formatter
            .format(items.iter())
            .write_to_string()
            .into_owned();
        Some(Value::Boxed(Box::new(JoinedList(joined))))
    }

    fn format(&self, _cx: &FnContext<'_>, value: &Value<'_>, out: &mut dyn Sink) {
        if let Value::Boxed(boxed) = value
            && let Some(JoinedList(text)) = boxed.downcast_ref::<JoinedList>()
        {
            out.push_str(text);
        }
    }
}

/// The long conjunction list formatter for `locale`, falling back through
/// its parent locales to the root.
fn list_formatter(locale: &str) -> Option<ListFormatter> {
    let locale: Locale = locale.parse().ok()?;
    ListFormatter::try_new_and(
        (&locale).into(),
        ListFormatterOptions::default().with_length(ListLength::Wide),
    )
    .ok()
}

/// Collects the engine's parts as [`MessagePart`]s.
#[derive(Default)]
struct Parts(Vec<MessagePart>);

impl PartSink for Parts {
    fn part(&mut self, part: Part<'_>) {
        let part = match part {
            Part::Text(value) => MessagePart::Text {
                value: value.to_owned(),
            },
            Part::BidiIsolation(isolation) => MessagePart::BidiIsolation {
                value: isolation_text(isolation).to_owned(),
            },
            Part::Expression(expression) => {
                let locale = expression.locale().to_owned();
                let dir = direction(expression.dir());
                let id = expression.id().map(str::to_owned);
                if expression.kind() == "number" {
                    let mut parts = NumberParts::default();
                    expression.sub_parts(&mut parts);
                    MessagePart::Number {
                        locale,
                        dir,
                        id,
                        parts: parts.0,
                    }
                } else {
                    let mut value = String::new();
                    expression.write(&mut value);
                    MessagePart::String {
                        locale,
                        dir,
                        id,
                        value,
                    }
                }
            }
            Part::Markup(markup) => MessagePart::Markup {
                kind: match markup.kind() {
                    mf2_runtime::MarkupKind::Open => MarkupKind::Open,
                    mf2_runtime::MarkupKind::Close => MarkupKind::Close,
                    mf2_runtime::MarkupKind::Standalone => MarkupKind::Standalone,
                },
                name: markup.name().to_owned(),
                id: markup.id().map(str::to_owned),
                options: markup
                    .options()
                    .filter_map(|(name, value)| {
                        Some(MarkupOption {
                            name: name.to_owned(),
                            value: option_text(value)?,
                        })
                    })
                    .collect(),
            },
            Part::Fallback(source) => MessagePart::Fallback {
                source: fallback_text(source),
            },
            _ => return,
        };
        self.0.push(part);
    }
}

/// Collects a number's sub-parts.
#[derive(Default)]
struct NumberParts(Vec<NumberPart>);

impl SubPartSink for NumberParts {
    fn sub_part(&mut self, kind: &str, text: &str) {
        self.0.push(NumberPart {
            kind: kind.to_owned(),
            value: text.to_owned(),
        });
    }
}

/// Collects formatting errors.
#[derive(Default)]
struct Errors(Vec<MessageError>);

impl ErrorSink for Errors {
    fn error(&mut self, error: FormatError) {
        self.0.push(match error {
            FormatError::UnresolvedVariable => MessageError::UnresolvedVariable,
            FormatError::UnknownFunction => MessageError::UnknownFunction,
            FormatError::BadSelector => MessageError::BadSelector,
            FormatError::BadOperand => MessageError::BadOperand,
            FormatError::BadOption => MessageError::BadOption,
            FormatError::BadVariantKey => MessageError::BadVariantKey,
            FormatError::UnsupportedOperation => MessageError::UnsupportedOperation,
            FormatError::MessageFunctionError => MessageError::MessageFunctionError,
            FormatError::MissingFallbackVariant => MessageError::MissingFallbackVariant,
            _ => MessageError::Other,
        });
    }
}

fn isolation_text(isolation: Isolation) -> &'static str {
    isolation.as_str()
}

fn direction(dir: mf2_catalog::Dir) -> Direction {
    match dir {
        mf2_catalog::Dir::Ltr => Direction::Ltr,
        mf2_catalog::Dir::Rtl => Direction::Rtl,
        _ => Direction::Auto,
    }
}

/// A markup option's value as text; options that are not text or a number
/// (none MF2 markup literals produce) are left out.
fn option_text(value: &Value<'_>) -> Option<String> {
    match value {
        Value::Str(text) | Value::Decimal(text) => Some((*text).to_owned()),
        Value::Int(int) => Some(int.to_string()),
        Value::Float(float) => Some(float.to_string()),
        Value::Custom(custom) => custom.as_str().map(str::to_owned),
        _ => None,
    }
}

fn fallback_text(source: FallbackSource<'_>) -> String {
    let mut text = String::new();
    source.write(&mut text);
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    const FSI: &str = "\u{2068}";
    const PDI: &str = "\u{2069}";

    fn format(locale: &str, source: &str, arguments: &[(&str, Argument)]) -> FormattedMessage {
        Message::compile(locale, source)
            .expect("the message compiles")
            .format_to_parts(arguments)
    }

    fn text(value: &str) -> MessagePart {
        MessagePart::Text {
            value: value.to_owned(),
        }
    }

    fn isolation(value: &str) -> MessagePart {
        MessagePart::BidiIsolation {
            value: value.to_owned(),
        }
    }

    fn string(locale: &str, value: &str) -> MessagePart {
        MessagePart::String {
            locale: locale.to_owned(),
            dir: Direction::Auto,
            id: None,
            value: value.to_owned(),
        }
    }

    #[test]
    fn placeholders_are_isolated() {
        let message = format(
            "de",
            "Hallo {$name}!",
            &[("name", Argument::String("Ada".into()))],
        );
        assert_eq!(
            message.parts,
            [
                text("Hallo "),
                isolation(FSI),
                string("de", "Ada"),
                isolation(PDI),
                text("!")
            ]
        );
        assert!(message.errors.is_empty());
    }

    #[test]
    fn list_joins_items_as_the_locale_writes_a_conjunction() {
        let items = || Argument::List(vec!["A".into(), "B".into(), "C".into()]);
        let joined =
            |locale| match &format(locale, "{$items :list}", &[("items", items())]).parts[1] {
                MessagePart::String { value, .. } => value.clone(),
                other => panic!("{other:?}"),
            };
        assert_eq!(joined("de"), "A, B und C");
        assert_eq!(joined("en"), "A, B, and C");
        // A regional variant compiles against its language's catalog.
        assert_eq!(joined("de-CH"), "A, B und C");
    }

    #[test]
    fn numbers_format_in_the_locale_s_sub_parts() {
        let message = format("de", "{$cm} cm", &[("cm", Argument::Number(1234.5))]);
        let MessagePart::Number { parts, .. } = &message.parts[0] else {
            panic!("{:?}", message.parts);
        };
        let rendered: Vec<(&str, &str)> = parts
            .iter()
            .map(|part| (part.kind.as_str(), part.value.as_str()))
            .collect();
        assert_eq!(
            rendered,
            [
                ("integer", "1"),
                ("group", "."),
                ("integer", "234"),
                ("decimal", ","),
                ("fraction", "5")
            ]
        );
    }

    #[test]
    fn markup_comes_through_with_its_options() {
        let message = format(
            "de",
            "Siehe {#link href=|https://example.com|}AGB{/link}.",
            &[],
        );
        assert_eq!(
            message.parts,
            [
                text("Siehe "),
                MessagePart::Markup {
                    kind: MarkupKind::Open,
                    name: "link".into(),
                    id: None,
                    options: vec![MarkupOption {
                        name: "href".into(),
                        value: "https://example.com".into()
                    }],
                },
                text("AGB"),
                MessagePart::Markup {
                    kind: MarkupKind::Close,
                    name: "link".into(),
                    id: None,
                    options: vec![],
                },
                text("."),
            ]
        );
    }

    #[test]
    fn selection_picks_the_matching_variant() {
        let source = ".input {$hasColor :string}\n.match $hasColor\ntrue {{mit Farbe}}\n* {{ohne}}";
        let pick = |value: &str| {
            format(
                "de",
                source,
                &[("hasColor", Argument::String(value.into()))],
            )
            .parts
        };
        assert_eq!(pick("true"), [text("mit Farbe")]);
        assert_eq!(pick("false"), [text("ohne")]);
    }

    #[test]
    fn a_missing_argument_falls_back_and_reports() {
        let message = format("de", "Hallo {$name}!", &[]);
        assert_eq!(
            message.parts[2],
            MessagePart::Fallback {
                source: "$name".into()
            }
        );
        assert_eq!(message.errors, [MessageError::UnresolvedVariable]);
    }

    #[test]
    fn invalid_messages_and_locales_do_not_compile() {
        let error = Message::compile("de", "Hallo {$name").unwrap_err();
        assert_eq!(error.message, "Syntax at 6..12");
        assert!(Message::compile("not a locale!", "Hallo").is_err());
        // Supplying a message source opts into the requested formatting locale.
        assert_eq!(Message::compile("fr", "Bonjour").unwrap().locale(), "fr");
    }

    #[test]
    fn shipped_messages_format_by_key() {
        let catalog = Catalog::shipped("de").expect("German ships");
        let footer = catalog
            .format_to_parts("sessionIntro.legalFooter", &[])
            .expect("the message exists");
        assert!(footer.parts.iter().any(|part| matches!(
            part,
            MessagePart::Markup { kind: MarkupKind::Open, name, .. } if name == "link"
        )));
        assert!(catalog.format_to_parts("no.such.message", &[]).is_none());
        assert_eq!(Catalog::locales().collect::<Vec<_>>(), ["de", "en"]);
    }

    #[test]
    fn overrides_compile_against_the_shipped_locale_data() {
        // German number symbols and English ordinal rules come from the
        // shipped catalogs, not from CLDR tables in the client.
        let cm = format("de", "{$cm} cm", &[("cm", Argument::Number(1234.5))]);
        let MessagePart::Number { parts, .. } = &cm.parts[0] else {
            panic!("{:?}", cm.parts);
        };
        assert_eq!(parts[1].value, ".");
        let place = |n| {
            let source = ".input {$n :number select=ordinal}\n.match $n\none {{{$n}st}}\ntwo {{{$n}nd}}\n* {{{$n}th}}";
            let message = format("en", source, &[("n", Argument::Integer(n))]);
            let text: String = message
                .parts
                .iter()
                .filter_map(|part| match part {
                    MessagePart::Text { value } => Some(value.clone()),
                    MessagePart::Number { parts, .. } => {
                        Some(parts.iter().map(|p| p.value.as_str()).collect())
                    }
                    _ => None,
                })
                .collect();
            text
        };
        assert_eq!(place(1), "1st");
        assert_eq!(place(2), "2nd");
        assert_eq!(place(4), "4th");
    }
}
