//! The platform bindings of the studio vaai SDK core.
//!
//! One implementation, compiled into every SDK, all from the same UniFFI
//! annotations: Swift and Kotlin bindings from uniffi-bindgen, and
//! TypeScript for the web (WebAssembly) and React Native from
//! uniffi-bindgen-react-native.
//!
//! Each subdomain of the core is one module here; its logic lives in a
//! plain-Rust crate beside this one where it has no platform code:
//!
//! - [`formatting`]: messages in Unicode MessageFormat 2, formatted to parts
//!   (the `formatting` crate), with its bindings here.
//! - [`image_metadata`]: what body estimation needs from a photo (the
//!   `image-metadata` crate), with its bindings here.
//! - [`state_machine`]: the try-on session's domain, its default
//!   experience, and the ordered effects the host performs for them. The
//!   `state-machine` crate exports its own types, in its own UniFFI
//!   namespace, behind its `uniffi` feature; this crate links it in.

uniffi::setup_scaffolding!();

// The wasm2 player needs the allocator and panic hook this crate exports;
// nothing references it, so force the link.
#[cfg(target_arch = "wasm32")]
extern crate uniffi_runtime_wasm as _;

pub use api;
pub mod experience_api;
pub mod formatting;
pub mod image_metadata;
pub use state_machine;
