//! Identifiers and counters, each its own type.
//!
//! Every identifier is a UUID. The backend, the shop and the host supply
//! some; the state machine mints the rest itself, deterministically: it
//! draws no randomness and reads no clock, so it derives them from a UUID
//! the host supplies (see [`Minter`]).
//!
//! In the bindings, an identifier is a string (the hyphenated UUID) and a
//! counter an unsigned 64-bit integer, each under its own type name.

use std::fmt;
use std::marker::PhantomData;

use uuid::{Builder, Uuid};

use crate::error::Rejection;

macro_rules! id {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(pub Uuid);

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Display::fmt(&self.0, f)
            }
        }

        impl From<Uuid> for $name {
            fn from(uuid: Uuid) -> Self {
                Self(uuid)
            }
        }

        impl From<$name> for Uuid {
            fn from(id: $name) -> Uuid {
                id.0
            }
        }

        impl From<$name> for String {
            fn from(id: $name) -> String {
                id.0.to_string()
            }
        }

        impl TryFrom<String> for $name {
            type Error = uuid::Error;

            fn try_from(text: String) -> Result<Self, Self::Error> {
                Uuid::parse_str(&text).map(Self)
            }
        }

        #[cfg(feature = "uniffi")]
        uniffi::custom_type!($(#[$doc])* $name, String);
    };
}

macro_rules! counter {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(pub u64);

        impl $name {
            /// The next value; `None` once the counter is exhausted.
            pub fn next(self) -> Option<Self> {
                self.0.checked_add(1).map(Self)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Display::fmt(&self.0, f)
            }
        }

        impl From<$name> for u64 {
            fn from(counter: $name) -> u64 {
                counter.0
            }
        }

        impl From<u64> for $name {
            fn from(value: u64) -> Self {
                Self(value)
            }
        }

        #[cfg(feature = "uniffi")]
        uniffi::custom_type!($(#[$doc])* $name, u64);
    };
}

id! {
    /// A runtime instance, chosen by the host: a new random UUID for every
    /// runtime, from which the runtime mints its own identifiers.
    RuntimeId
}
id! {
    /// One physical operation the domain started, minted by the runtime.
    OperationId
}
id! {
    /// One logical try-on request, minted by the domain.
    TryOnRequestId
}
id! {
    /// One effect batch, minted by the runtime.
    BatchId
}
id! {
    /// One effect driver, minted by the runtime.
    DriverId
}
id! {
    /// One device interaction of a flow (a picker, a camera acquisition, a
    /// timer, a capture), minted by the flow; a stale one is ignored.
    InteractionToken
}
id! {
    /// A body, from the backend.
    BodyId
}
id! {
    /// A try-on, from the backend.
    TryOnId
}
id! {
    /// A product, from the shop's catalog.
    ProductId
}
id! {
    /// A variant of a product, from the shop's catalog.
    VariantId
}
id! {
    /// A photo in the host's media registry, which keeps its bytes, previews
    /// and capture metadata.
    MediaId
}
id! {
    /// The host's lease on a live camera stream.
    LeaseId
}

counter! {
    /// A body's acknowledged height revision: each successful SetHeight
    /// takes the next one, so a revision is never reused, even across
    /// bodies.
    BodyRevision
}
counter! {
    /// Identifies the installed backend catalogue within this runtime.
    CatalogueRevision
}
counter! {
    /// Counts a runtime's committed transitions.
    RuntimeRevision
}

/// The session's flow, minted by the runtime; not part of the API. A new
/// flow replaces the session's flow, and the old one's handle then refuses
/// every call. It also seeds the flow's interaction tokens, so no flow
/// accepts another's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FlowId(pub Uuid);

impl From<Uuid> for FlowId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

/// What a minted identifier identifies; part of its value, so identifiers of
/// different kinds never coincide.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Kind {
    Operation = 1,
    Request = 2,
    Flow = 3,
    Batch = 4,
    Driver = 5,
    Interaction = 7,
}

/// An identifier type the state machine mints itself.
pub(crate) trait Minted: From<Uuid> {
    /// The kind its identifiers carry.
    const KIND: Kind;
}

impl Minted for OperationId {
    const KIND: Kind = Kind::Operation;
}
impl Minted for TryOnRequestId {
    const KIND: Kind = Kind::Request;
}
impl Minted for FlowId {
    const KIND: Kind = Kind::Flow;
}
impl Minted for BatchId {
    const KIND: Kind = Kind::Batch;
}
impl Minted for DriverId {
    const KIND: Kind = Kind::Driver;
}
impl Minted for InteractionToken {
    const KIND: Kind = Kind::Interaction;
}

/// Mints identifiers from a seed UUID: version 8 UUIDs whose upper half folds
/// in the seed's entropy and whose lower half holds the kind and a number.
/// Minting is deterministic; identifiers of one kind order by number, and
/// two seeds collide only with negligible probability.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Minter {
    /// Both halves of the seed, combined.
    prefix: u64,
}

impl Minter {
    /// Numbers stay below this, under the kind's bits.
    const LIMIT: u64 = 1 << 56;

    fn new(seed: Uuid) -> Self {
        let (high, low) = seed.as_u64_pair();
        Self { prefix: high ^ low }
    }

    /// The identifier of kind `kind` with number `number`.
    fn mint(self, kind: Kind, number: u64) -> Result<Uuid, Rejection> {
        if number >= Self::LIMIT {
            return Err(Rejection::Exhausted);
        }
        let low = ((kind as u64) << 56) | number;
        let bytes = Uuid::from_u64_pair(self.prefix, low).into_bytes();
        Ok(Builder::from_custom_bytes(bytes).into_uuid())
    }
}

/// The identifiers of one type, minted in order from a seed: the runtime's
/// ID for the runtime's and the domain's, a flow's ID for the flow's.
#[derive(Debug)]
pub(crate) struct Sequence<T> {
    /// Mints from the seed.
    minter: Minter,
    /// How many were minted.
    issued: u64,
    /// The identifier type minted.
    minted: PhantomData<fn() -> T>,
}

// By hand: derived impls would demand the same of `T`.
impl<T> Clone for Sequence<T> {
    fn clone(&self) -> Self {
        Self {
            minter: self.minter,
            issued: self.issued,
            minted: PhantomData,
        }
    }
}

impl<T> PartialEq for Sequence<T> {
    fn eq(&self, other: &Self) -> bool {
        self.minter == other.minter && self.issued == other.issued
    }
}

impl<T: Minted> Sequence<T> {
    pub(crate) fn new(seed: Uuid) -> Self {
        Self {
            minter: Minter::new(seed),
            issued: 0,
            minted: PhantomData,
        }
    }

    /// The next identifier; refused once the space is exhausted.
    pub(crate) fn next(&mut self) -> Result<T, Rejection> {
        let number = self.issued.checked_add(1).ok_or(Rejection::Exhausted)?;
        let id = self.minter.mint(T::KIND, number)?;
        self.issued = number;
        Ok(id.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minted_identifiers_are_distinct_ordered_and_seeded() {
        let a = Minter::new(Uuid::from_u128(0x1234_5678_9abc_def0_0fed_cba9_8765_4321));
        let b = Minter::new(Uuid::from_u128(
            0x0fed_cba9_8765_4321_1234_5678_9abc_def0 + 1,
        ));
        let first = a.mint(Kind::Request, 1).unwrap();
        let second = a.mint(Kind::Request, 2).unwrap();
        assert!(first < second);
        assert_ne!(first, a.mint(Kind::Operation, 1).unwrap());
        assert_ne!(first, b.mint(Kind::Request, 1).unwrap());
        assert_eq!(first, a.mint(Kind::Request, 1).unwrap());
        assert_eq!(first.get_version_num(), 8);
        assert!(a.mint(Kind::Request, Minter::LIMIT).is_err());
    }
}
