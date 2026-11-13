//! Values with a meaning of their own, each its own type: text the backend,
//! the shop or the host supplies, and the quantities the experience reads.
//!
//! Free-form text for people (messages, reasons) stays a `String`. In the
//! bindings, each type here is its underlying string or number under its
//! own type name.

use std::fmt;

macro_rules! text {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(pub String);

        impl $name {
            pub fn is_empty(&self) -> bool {
                self.0.is_empty()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl From<String> for $name {
            fn from(text: String) -> Self {
                Self(text)
            }
        }

        impl From<&str> for $name {
            fn from(text: &str) -> Self {
                Self(text.into())
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> String {
                value.0
            }
        }

        impl PartialEq<str> for $name {
            fn eq(&self, other: &str) -> bool {
                self.0 == other
            }
        }

        impl PartialEq<&str> for $name {
            fn eq(&self, other: &&str) -> bool {
                self.0 == *other
            }
        }

        #[cfg(feature = "uniffi")]
        uniffi::custom_type!($(#[$doc])* $name, String);
    };
}

text! {
    /// An axis a product's variants differ along, in the shop's own terms,
    /// such as `colorway` or `size`.
    AxisKey
}
text! {
    /// The shop's own identifier of an item on one axis, such as the
    /// colorway `IX7055-259` or the size `XS`.
    ForeignId
}
text! {
    /// Where an image is: a try-on's, or an item's swatch.
    ImageUrl
}
text! {
    /// A color as `#rrggbb`, such as a colorway's swatch `#1a1a1a`.
    HexColor
}

/// A body height in centimeters.
#[derive(Clone, Copy, Debug, Default, PartialEq, PartialOrd)]
pub struct HeightCm(pub f64);

impl HeightCm {
    /// Whether it can be a body's height: finite and positive.
    pub fn is_valid(self) -> bool {
        self.0.is_finite() && self.0 > 0.0
    }
}

impl fmt::Display for HeightCm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} cm", self.0)
    }
}

impl From<f64> for HeightCm {
    fn from(centimeters: f64) -> Self {
        Self(centimeters)
    }
}

impl From<HeightCm> for f64 {
    fn from(height: HeightCm) -> f64 {
        height.0
    }
}

#[cfg(feature = "uniffi")]
uniffi::custom_type!(
    /// A body height in centimeters.
    HeightCm,
    f64
);

/// How closely a size matches the product's intended fit, from 0 to 1; 1 is
/// the intended fit.
#[derive(Clone, Copy, Debug, Default, PartialEq, PartialOrd)]
pub struct FitMatch(pub f64);

impl FitMatch {
    /// Whether it is on the scale: from 0 to 1.
    pub fn is_valid(self) -> bool {
        (0.0..=1.0).contains(&self.0)
    }
}

impl fmt::Display for FitMatch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<f64> for FitMatch {
    fn from(fraction: f64) -> Self {
        Self(fraction)
    }
}

impl From<FitMatch> for f64 {
    fn from(fit_match: FitMatch) -> f64 {
        fit_match.0
    }
}

#[cfg(feature = "uniffi")]
uniffi::custom_type!(
    /// How closely a size matches the product's intended fit, from 0 to 1.
    FitMatch,
    f64
);

/// A point on the host's monotonic clock, in milliseconds; never wall-clock
/// time, and comparable only with points from the same clock.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct MonotonicMillis(pub u64);

impl MonotonicMillis {
    /// This point plus `millis`; `None` past the clock's range.
    pub fn checked_add(self, millis: u64) -> Option<Self> {
        self.0.checked_add(millis).map(Self)
    }
}

impl fmt::Display for MonotonicMillis {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ms", self.0)
    }
}

impl From<u64> for MonotonicMillis {
    fn from(millis: u64) -> Self {
        Self(millis)
    }
}

impl From<MonotonicMillis> for u64 {
    fn from(point: MonotonicMillis) -> u64 {
        point.0
    }
}

#[cfg(feature = "uniffi")]
uniffi::custom_type!(
    /// A point on the host's monotonic clock, in milliseconds.
    MonotonicMillis,
    u64
);
