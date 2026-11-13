//! Formatting: messages in Unicode MessageFormat 2, formatted to parts so a
//! renderer can style their markup (bold, links, …) instead of receiving a
//! flattened string.

mod variant_label;
pub use variant_label::{
    VariantLabel, VariantLabelAxis, VariantLabelItem, VariantLabelRow, selection_label_value,
    variant_label_for_foreign_ids,
};

use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

/// The SDK's shipped MF2 messages and locale data.
#[derive(Debug, uniffi::Object)]
pub struct MessageCatalog(formatting::Catalog);

#[uniffi::export]
impl MessageCatalog {
    /// Select SDK text and exact value formatting using the caller's locale policy.
    #[uniffi::constructor]
    pub fn new(locale: String, has_host_messages: bool) -> Result<Arc<Self>, FormattingError> {
        formatting::Catalog::for_locale(&locale, has_host_messages)
            .map(|catalog| Arc::new(Self(catalog)))
            .map_err(|error| FormattingError::InvalidMessage {
                message: error.message,
            })
    }

    pub fn locale(&self) -> String {
        self.0.locale().to_owned()
    }

    pub fn catalog_locale(&self) -> String {
        self.0.catalog_locale().to_owned()
    }

    pub fn format_to_parts(
        &self,
        key: String,
        values: HashMap<String, MessageArgument>,
    ) -> Option<FormattedMessage> {
        let arguments: Vec<_> = values
            .iter()
            .map(|(name, value)| (name.as_str(), value.clone().into()))
            .collect();
        self.0.format_to_parts(&key, &arguments).map(Into::into)
    }

    /// A host override compiled against the shipped catalog's locale data.
    pub fn compile(&self, source: String) -> Result<Arc<Message>, FormattingError> {
        self.0
            .compile(&source)
            .map(|message| Arc::new(Message(message)))
            .map_err(|error| FormattingError::InvalidMessage {
                message: error.message,
            })
    }
}

#[uniffi::export]
pub fn message_locales() -> Vec<String> {
    formatting::Catalog::locales().map(str::to_owned).collect()
}

/// A message compiled for one locale, ready to format many times.
#[derive(Debug, uniffi::Object)]
pub struct Message(formatting::Message);

#[uniffi::export]
impl Message {
    /// Compiles MF2 `source` for `locale` (a BCP 47 tag such as `de` or
    /// `en-US`).
    #[uniffi::constructor]
    pub fn new(locale: String, source: String) -> Result<Arc<Self>, FormattingError> {
        formatting::Message::compile(&locale, &source)
            .map(|message| Arc::new(Message(message)))
            .map_err(|error| FormattingError::InvalidMessage {
                message: error.message,
            })
    }

    /// The locale the message was compiled for.
    pub fn locale(&self) -> String {
        self.0.locale().to_owned()
    }

    /// Formats the message with named `values` into parts. (Not `arguments`:
    /// the generated TypeScript would declare a parameter by that name, which
    /// an ECMAScript module rejects.)
    pub fn format_to_parts(&self, values: HashMap<String, MessageArgument>) -> FormattedMessage {
        let arguments: Vec<(&str, formatting::Argument)> = values
            .iter()
            .map(|(name, argument)| (name.as_str(), argument.clone().into()))
            .collect();
        self.0.format_to_parts(&arguments).into()
    }
}

/// A message that does not compile.
#[derive(Debug, uniffi::Error)]
pub enum FormattingError {
    /// Its syntax or data model is invalid, or its locale tag is malformed.
    InvalidMessage { message: String },
}

impl fmt::Display for FormattingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FormattingError::InvalidMessage { message } => f.write_str(message),
        }
    }
}

impl std::error::Error for FormattingError {}

/// A named argument's value.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum MessageArgument {
    /// A caller-localized variant operand for `:variantLabel`.
    VariantLabel {
        value: VariantLabel,
    },
    String {
        value: String,
    },
    Number {
        value: f64,
    },
    Integer {
        value: i64,
    },
    /// The items of a list, for `:list`.
    List {
        items: Vec<String>,
    },
}

impl From<MessageArgument> for formatting::Argument {
    fn from(argument: MessageArgument) -> Self {
        match argument {
            MessageArgument::VariantLabel { value } => {
                formatting::Argument::VariantLabel(value.into())
            }
            MessageArgument::String { value } => formatting::Argument::String(value),
            MessageArgument::Number { value } => formatting::Argument::Number(value),
            MessageArgument::Integer { value } => formatting::Argument::Integer(value),
            MessageArgument::List { items } => formatting::Argument::List(items),
        }
    }
}

/// A formatted message: its parts in order, and what went wrong while
/// formatting. A message with errors still formats, showing fallbacks.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FormattedMessage {
    pub parts: Vec<MessagePart>,
    pub errors: Vec<MessageError>,
}

impl From<formatting::FormattedMessage> for FormattedMessage {
    fn from(message: formatting::FormattedMessage) -> Self {
        FormattedMessage {
            parts: message.parts.into_iter().map(MessagePart::from).collect(),
            errors: message.errors.into_iter().map(MessageError::from).collect(),
        }
    }
}

/// A part of a formatted message, as MF2 defines formatted parts.
/// Concatenated, the parts' text is the message as a string.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
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

impl From<formatting::MessagePart> for MessagePart {
    fn from(part: formatting::MessagePart) -> Self {
        use formatting::MessagePart as P;
        match part {
            P::Text { value } => MessagePart::Text { value },
            P::String {
                locale,
                dir,
                id,
                value,
            } => MessagePart::String {
                locale,
                dir: dir.into(),
                id,
                value,
            },
            P::Number {
                locale,
                dir,
                id,
                parts,
            } => MessagePart::Number {
                locale,
                dir: dir.into(),
                id,
                parts: parts.into_iter().map(NumberPart::from).collect(),
            },
            P::Markup {
                kind,
                name,
                id,
                options,
            } => MessagePart::Markup {
                kind: kind.into(),
                name,
                id,
                options: options.into_iter().map(MarkupOption::from).collect(),
            },
            P::Fallback { source } => MessagePart::Fallback { source },
            P::BidiIsolation { value } => MessagePart::BidiIsolation { value },
        }
    }
}

/// A placeholder's text direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum Direction {
    Ltr,
    Rtl,
    Auto,
}

impl From<formatting::Direction> for Direction {
    fn from(dir: formatting::Direction) -> Self {
        match dir {
            formatting::Direction::Ltr => Direction::Ltr,
            formatting::Direction::Rtl => Direction::Rtl,
            formatting::Direction::Auto => Direction::Auto,
        }
    }
}

/// Whether markup opens, closes, or stands alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MarkupKind {
    Open,
    Close,
    Standalone,
}

impl From<formatting::MarkupKind> for MarkupKind {
    fn from(kind: formatting::MarkupKind) -> Self {
        match kind {
            formatting::MarkupKind::Open => MarkupKind::Open,
            formatting::MarkupKind::Close => MarkupKind::Close,
            formatting::MarkupKind::Standalone => MarkupKind::Standalone,
        }
    }
}

/// One option of a markup element, e.g. a link's `href`.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct MarkupOption {
    pub name: String,
    pub value: String,
}

impl From<formatting::MarkupOption> for MarkupOption {
    fn from(option: formatting::MarkupOption) -> Self {
        MarkupOption {
            name: option.name,
            value: option.value,
        }
    }
}

/// One sub-part of a formatted number: its kind (`integer`, `group`,
/// `decimal`, `fraction`, `minusSign`, …) and text.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct NumberPart {
    pub kind: String,
    pub value: String,
}

impl From<formatting::NumberPart> for NumberPart {
    fn from(part: formatting::NumberPart) -> Self {
        NumberPart {
            kind: part.kind,
            value: part.value,
        }
    }
}

/// What went wrong while formatting, by MF2's error names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
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

impl From<formatting::MessageError> for MessageError {
    fn from(error: formatting::MessageError) -> Self {
        use formatting::MessageError as E;
        match error {
            E::UnresolvedVariable => MessageError::UnresolvedVariable,
            E::UnknownFunction => MessageError::UnknownFunction,
            E::BadSelector => MessageError::BadSelector,
            E::BadOperand => MessageError::BadOperand,
            E::BadOption => MessageError::BadOption,
            E::BadVariantKey => MessageError::BadVariantKey,
            E::UnsupportedOperation => MessageError::UnsupportedOperation,
            E::MessageFunctionError => MessageError::MessageFunctionError,
            E::MissingFallbackVariant => MessageError::MissingFallbackVariant,
            E::Other => MessageError::Other,
        }
    }
}
