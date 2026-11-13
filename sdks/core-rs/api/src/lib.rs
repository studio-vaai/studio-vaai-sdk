//! The studio vaai public API client, generated from the TypeSpec contract.
//!
//! `generated.rs` is written by `sdks/api/emitters/rust-client.js` from `sdks/api/public`: the
//! models, errors and, per operation, a request builder, a response parser and an async method
//! on [`ApiClient`]. The rest is hand-written: the [`HttpTransport`] each platform implements
//! with its own HTTP stack, the client, and the decoding the generated code calls.
//!
//! The client never opens a connection itself. It builds the whole request (URL, headers,
//! credentials, JSON body), hands it to the host's transport, and turns the response into a
//! typed result or a typed [`ApiError`]. With the `uniffi` feature, `studio-vaai-core` exports it
//! to Swift, Kotlin and the web in its own namespace.

// `ApiError::Problem` carries the typed problem by value: UniFFI passes records and enums by
// value and cannot box them, and every call returns through this error.
#![allow(clippy::result_large_err)]

mod client;
#[rustfmt::skip]
mod generated;
mod runtime;

pub use client::{ApiClient, ClientConfig, HttpTransport, TransportError, api_version};
pub use generated::*;
pub use runtime::{ApiError, HttpHeader, HttpRequest, HttpResponse, RequestContext};

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
