//! What the generated operations are built from: the request and response the host's transport
//! carries, the client's per-request context, and the decoding of success and problem bodies.

use std::fmt;

use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::generated::ApiProblem;

/// One HTTP header.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

/// A request for the host to send. The client has built all of it; the host only moves bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct HttpRequest {
    /// `GET`, `POST`, `PATCH`, `DELETE`, ...
    pub method: String,
    /// The absolute URL, query included.
    pub url: String,
    pub headers: Vec<HttpHeader>,
    /// The body's bytes (JSON), when the operation has one.
    pub body: Option<Vec<u8>>,
    /// The operation accepts or sets a session cookie: a browser uses
    /// `credentials: "include"` when using cookies. Native hosts can ignore it.
    pub with_credentials: bool,
}

impl HttpRequest {
    pub(crate) fn header(&mut self, name: &str, value: String) {
        self.headers.push(HttpHeader {
            name: name.to_owned(),
            value,
        });
    }

    pub(crate) fn json_body<T: serde::Serialize + WireModel>(
        &mut self,
        body: &T,
    ) -> Result<(), ApiError> {
        let value = wire_value(body).map_err(|error| ApiError::InvalidRequest {
            reason: format!("encode the request body: {error}"),
        })?;
        self.header("Content-Type", "application/json".to_owned());
        self.body = Some(serde_json::to_vec(&value).expect("a JSON value always serializes"));
        Ok(())
    }
}

pub(crate) fn wire_value<T: serde::Serialize + WireModel>(
    body: &T,
) -> Result<Value, serde_json::Error> {
    let mut value = serde_json::to_value(body)?;
    if let Value::Object(object) = &mut value {
        for (name, constant) in T::CONSTANTS {
            object.insert((*name).to_owned(), Value::String((*constant).to_owned()));
        }
    }
    Ok(value)
}

pub(crate) fn serialize_wire_model<T: serde::Serialize + WireModel, S: serde::Serializer>(
    body: &T,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let value = wire_value(body).map_err(serde::ser::Error::custom)?;
    serde::Serialize::serialize(&value, serializer)
}

#[allow(dead_code)]
pub(crate) fn serialize_optional_wire_model<
    T: serde::Serialize + WireModel,
    S: serde::Serializer,
>(
    body: &Option<T>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match body {
        Some(body) => serialize_wire_model(body, serializer),
        None => serializer.serialize_none(),
    }
}

/// What the host's transport received.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<HttpHeader>,
    pub body: Vec<u8>,
}

/// Everything a request needs besides its own arguments: where the API is, the shop's key, and
/// the session.
#[derive(Debug, Clone)]
pub struct RequestContext {
    pub base_url: String,
    pub client_api_key: String,
    pub api_version: String,
    pub client_version: String,
    pub bearer_token: Option<String>,
}

impl RequestContext {
    pub(crate) fn request(
        &self,
        method: &str,
        path: &str,
        query: &[(&str, String)],
    ) -> HttpRequest {
        let mut url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        for (index, (name, value)) in query.iter().enumerate() {
            url.push(if index == 0 { '?' } else { '&' });
            url.push_str(&encode_query_component(name));
            url.push('=');
            url.push_str(&encode_query_component(value));
        }
        let mut request = HttpRequest {
            method: method.to_owned(),
            url,
            headers: Vec::new(),
            body: None,
            with_credentials: false,
        };
        request.header(
            "Accept",
            "application/json, application/problem+json".to_owned(),
        );
        request.header("X-Client-Version", self.client_version.clone());
        request
    }

    pub(crate) fn authorize_bearer(&self, request: &mut HttpRequest) {
        if let Some(token) = &self.bearer_token {
            request.header("Authorization", format!("Bearer {token}"));
        }
    }
}

/// What the generated code knows about a model's wire format beyond its fields: the properties
/// the contract fixes to one literal, and the properties typed as a union of literals.
pub trait WireModel {
    const CONSTANTS: &'static [(&'static str, &'static str)];
    const LITERAL_UNIONS: &'static [(&'static str, &'static [&'static str])];
}

/// Why a call failed.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
pub enum ApiError {
    /// The API answered with a problem (`application/problem+json`).
    Problem { status: u16, problem: ApiProblem },
    /// A status the operation does not declare, with a body that is not a problem.
    UnexpectedStatus { status: u16, body: String },
    /// A declared response whose body did not decode.
    Decode { status: u16, reason: String },
    /// The host's transport could not complete the request.
    Transport { reason: String },
    /// The request could not be built.
    InvalidRequest { reason: String },
    /// The host did not send the request.
    NotSent { reason: String },
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Problem { status, problem } => write!(f, "HTTP {status}: {}", problem.kind()),
            Self::UnexpectedStatus { status, .. } => write!(f, "unexpected HTTP status {status}"),
            Self::Decode { status, reason } => {
                write!(f, "HTTP {status}: undecodable body: {reason}")
            }
            Self::Transport { reason } | Self::NotSent { reason } => {
                write!(f, "transport: {reason}")
            }
            Self::InvalidRequest { reason } => write!(f, "invalid request: {reason}"),
        }
    }
}

impl std::error::Error for ApiError {}

pub(crate) fn decode_json<T: DeserializeOwned>(response: &HttpResponse) -> Result<T, ApiError> {
    serde_json::from_slice(&response.body).map_err(|error| ApiError::Decode {
        status: response.status,
        reason: error.to_string(),
    })
}

/// How well a body fits one error model (none when it contradicts a literal the model fixes),
/// and the body as that model.
type Fit = dyn Fn(&Value) -> Option<(u32, ApiProblem)>;

/// One error model an error status allows.
pub struct Candidate(Box<Fit>);

/// A candidate for model `T`. A body fits it when every literal `T` fixes is present and equal;
/// it fits better the more fixed literals and known union values it carries.
pub fn candidate<T: DeserializeOwned + WireModel + 'static>(
    wrap: fn(T) -> ApiProblem,
) -> Candidate {
    Candidate(Box::new(move |value| {
        let mut score = 0;
        for (name, constant) in T::CONSTANTS {
            if value.get(*name).and_then(Value::as_str) != Some(*constant) {
                return None;
            }
            score += 10;
        }
        for (name, known) in T::LITERAL_UNIONS {
            if value
                .get(*name)
                .and_then(Value::as_str)
                .is_some_and(|v| known.contains(&v))
            {
                score += 2;
            }
        }
        serde_json::from_value::<T>(value.clone())
            .ok()
            .map(|model| (score, wrap(model)))
    }))
}

/// The problem an error response carries: the best-fitting candidate, else the generic problem,
/// else the status and raw body.
pub fn decode_problem<G: DeserializeOwned>(
    response: &HttpResponse,
    candidates: &[Candidate],
    other: fn(G) -> ApiProblem,
) -> ApiError {
    let status = response.status;
    let Ok(value) = serde_json::from_slice::<Value>(&response.body) else {
        return unexpected(response);
    };
    let mut best: Option<(u32, ApiProblem)> = None;
    for Candidate(fit) in candidates {
        if let Some((score, problem)) = fit(&value)
            && best.as_ref().is_none_or(|(top, _)| score > *top)
        {
            best = Some((score, problem));
        }
    }
    match best {
        Some((_, problem)) => ApiError::Problem { status, problem },
        None => match serde_json::from_value::<G>(value) {
            Ok(generic) => ApiError::Problem {
                status,
                problem: other(generic),
            },
            Err(_) => unexpected(response),
        },
    }
}

/// A status the operation does not declare: a problem if the body is one, else the raw body.
pub fn unexpected_status<G: DeserializeOwned>(
    response: &HttpResponse,
    other: fn(G) -> ApiProblem,
) -> ApiError {
    match serde_json::from_slice::<G>(&response.body) {
        Ok(generic) => ApiError::Problem {
            status: response.status,
            problem: other(generic),
        },
        Err(_) => unexpected(response),
    }
}

fn unexpected(response: &HttpResponse) -> ApiError {
    ApiError::UnexpectedStatus {
        status: response.status,
        body: String::from_utf8_lossy(&response.body).into_owned(),
    }
}

/// Percent-encodes a path segment: everything but RFC 3986's unreserved characters.
pub fn encode_path_segment(segment: &str) -> String {
    encode(segment)
}

fn encode_query_component(component: &str) -> String {
    encode(component)
}

fn encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}
