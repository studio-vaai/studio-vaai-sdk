//! The client object the platforms hold, and the transport they give it.

use std::sync::{Arc, Mutex};

use crate::generated::API_VERSION;
use crate::runtime::{ApiError, HttpRequest, HttpResponse, RequestContext};

/// The API version this client speaks: the contract's date (`YYYY-MM-DD`), sent as
/// `X-Api-Version` on every request. A server that supports several versions answers each client
/// in the contract it was built for.
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn api_version() -> String {
    API_VERSION.to_owned()
}

/// Why the host's transport could not complete a request (no network, TLS, a timeout, ...).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
pub enum TransportError {
    Failed {
        reason: String,
    },
    /// The transport can establish that it never sent the request.
    NotSent {
        reason: String,
    },
}

impl std::fmt::Display for TransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Failed { reason } | Self::NotSent { reason } => f.write_str(reason),
        }
    }
}

impl std::error::Error for TransportError {}

#[cfg(feature = "uniffi")]
impl From<uniffi::UnexpectedUniFFICallbackError> for TransportError {
    fn from(error: uniffi::UnexpectedUniFFICallbackError) -> Self {
        Self::Failed {
            reason: error.reason,
        }
    }
}

/// Sends a request the client built, with the platform's own HTTP stack: `URLSession` on iOS,
/// OkHttp (or any client) on Android, `fetch` on the web. Return every response, whatever its
/// status; only fail when there is no response at all.
#[cfg_attr(feature = "uniffi", uniffi::export(with_foreign))]
#[async_trait::async_trait]
pub trait HttpTransport: Send + Sync {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError>;
}

/// Where the API is and which shop calls it.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ClientConfig {
    /// `https://api.studio-vaai.com`, or another environment's.
    pub base_url: String,
    /// The shop's public client key (`sv_client_…`), sent as `X-Client-Api-Key`.
    pub client_api_key: String,
    /// Names the SDK in `X-Client-Version` (`<client_name>/<API_VERSION>`), e.g.
    /// `studio-vaai-swift`. Defaults to `studio-vaai-core`.
    #[cfg_attr(feature = "uniffi", uniffi(default))]
    pub client_name: Option<String>,
}

/// The studio vaai public API: one method per operation of the contract.
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct ApiClient {
    config: ClientConfig,
    transport: Arc<dyn HttpTransport>,
    bearer_token: Arc<Mutex<Option<String>>>,
}

#[cfg_attr(feature = "uniffi", uniffi::export)]
impl ApiClient {
    #[cfg_attr(feature = "uniffi", uniffi::constructor)]
    pub fn new(config: ClientConfig, transport: Arc<dyn HttpTransport>) -> Arc<Self> {
        Arc::new(Self {
            config,
            transport,
            bearer_token: Arc::new(Mutex::new(None)),
        })
    }

    /// Use an operation-scoped transport with the same shop and current credential.
    pub fn with_transport(&self, transport: Arc<dyn HttpTransport>) -> Arc<Self> {
        Arc::new(Self {
            config: self.config.clone(),
            transport,
            bearer_token: Arc::clone(&self.bearer_token),
        })
    }

    /// The session token from `createBearerSession` or `refreshBearerSession`, sent as
    /// `Authorization: Bearer …` to the operations that accept it. `None` signs out.
    pub fn set_bearer_token(&self, token: Option<String>) {
        *self.bearer_token.lock().expect("bearer token lock") = token;
    }
}

impl ApiClient {
    /// Freeze the credential used by this operation while keeping its transport.
    pub fn credential_snapshot(
        &self,
        transport: Arc<dyn HttpTransport>,
        token: Option<String>,
    ) -> Arc<Self> {
        Arc::new(Self {
            config: self.config.clone(),
            transport,
            bearer_token: Arc::new(Mutex::new(token)),
        })
    }

    pub(crate) fn context(&self) -> RequestContext {
        let name = self
            .config
            .client_name
            .as_deref()
            .unwrap_or("studio-vaai-core");
        RequestContext {
            base_url: self.config.base_url.clone(),
            client_api_key: self.config.client_api_key.clone(),
            api_version: API_VERSION.to_owned(),
            client_version: format!("{name}/{API_VERSION}"),
            bearer_token: self.bearer_token.lock().expect("bearer token lock").clone(),
        }
    }

    pub(crate) async fn send(&self, request: HttpRequest) -> Result<HttpResponse, ApiError> {
        self.transport
            .send(request)
            .await
            .map_err(|error| match error {
                TransportError::Failed { reason } => ApiError::Transport { reason },
                TransportError::NotSent { reason } => ApiError::NotSent { reason },
            })
    }
}
