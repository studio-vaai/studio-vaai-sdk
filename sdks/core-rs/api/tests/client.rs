//! The generated client against a scripted transport: the requests it builds, and how it reads
//! success, problem and broken responses.

use std::sync::{Arc, Mutex};

use api::{
    API_VERSION, ApiClient, ApiError, ApiProblem, ClientConfig, CreateCookieSessionBody,
    CreateTryOnBody, HttpRequest, HttpResponse, HttpTransport, SessionUnauthorizedProblemKind,
    TransportError,
};

/// Answers every request with one scripted response and keeps the requests it saw.
struct Scripted {
    response: Result<HttpResponse, TransportError>,
    seen: Mutex<Vec<HttpRequest>>,
}

#[async_trait::async_trait]
impl HttpTransport for Scripted {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
        self.seen.lock().unwrap().push(request);
        self.response.clone()
    }
}

fn client(status: u16, body: &str) -> (Arc<ApiClient>, Arc<Scripted>) {
    scripted(Ok(HttpResponse {
        status,
        headers: vec![],
        body: body.as_bytes().to_vec(),
    }))
}

fn scripted(response: Result<HttpResponse, TransportError>) -> (Arc<ApiClient>, Arc<Scripted>) {
    let transport = Arc::new(Scripted {
        response,
        seen: Mutex::new(vec![]),
    });
    let config = ClientConfig {
        base_url: "https://api.example.test/".into(),
        client_api_key: "sv_client_test".into(),
        client_name: Some("studio-vaai-swift".into()),
    };
    (ApiClient::new(config, transport.clone()), transport)
}

fn header<'a>(request: &'a HttpRequest, name: &str) -> Option<&'a str> {
    request
        .headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

const TRY_ON: &str = r##"{"tryOnId":"t1","status":"completed","variantId":"v1","imageUrl":"https://img.test/t1.jpg","scene":{"overlayColor":"#ffffff"}}"##;

#[test]
fn a_try_on_request_carries_the_shop_key_the_session_and_the_variant() {
    let (client, transport) = client(201, TRY_ON);
    client.set_bearer_token(Some("token-1".into()));
    let body = CreateTryOnBody {
        variant_id: "v1".into(),
        body_revision_id: Some("revision-1".into()),
    };
    let result =
        pollster::block_on(client.create_try_on("p 1/2".into(), "b1".into(), body)).unwrap();
    assert_eq!(result.try_on_id, "t1");
    assert_eq!(result.variant_id.as_deref(), Some("v1"));

    let request = &transport.seen.lock().unwrap()[0];
    assert_eq!(request.method, "POST");
    // The path segment is percent-encoded; the base URL's trailing slash is not doubled.
    assert_eq!(
        request.url,
        "https://api.example.test/products/p%201%2F2/try-on?bodyId=b1"
    );
    assert_eq!(header(request, "X-Client-Api-Key"), Some("sv_client_test"));
    assert_eq!(header(request, "X-Api-Version"), Some(API_VERSION));
    assert_eq!(
        header(request, "X-Client-Version"),
        Some(format!("studio-vaai-swift/{API_VERSION}").as_str())
    );
    assert_eq!(header(request, "Authorization"), Some("Bearer token-1"));
    assert_eq!(header(request, "Content-Type"), Some("application/json"));
    // It accepts the session cookie too: a browser sends it with credentials.
    assert!(request.with_credentials);
    let sent: serde_json::Value = serde_json::from_slice(request.body.as_ref().unwrap()).unwrap();
    assert_eq!(
        sent,
        serde_json::json!({ "variantId": "v1", "bodyRevisionId": "revision-1" })
    );
}

#[test]
fn a_public_operation_sends_no_session() {
    let (client, transport) = client(
        200,
        r#"{"productId":"p1","variants":[{"id":"v1","foreignVariantIds":{"size":"S"},"foreignId":"SKU-1"}]}"#,
    );
    client.set_bearer_token(Some("token-1".into()));
    let product = pollster::block_on(client.get_product_details("p1".into())).unwrap();
    assert_eq!(product.variants[0].foreign_id.as_deref(), Some("SKU-1"));
    assert_eq!(product.variants[0].foreign_variant_ids["size"], "S");

    let request = &transport.seen.lock().unwrap()[0];
    assert_eq!(header(request, "Authorization"), None);
    assert!(!request.with_credentials);
    assert_eq!(request.body, None);
}

#[test]
fn cookie_session_creation_accepts_cookies_before_authentication() {
    let (api, transport) = client(200, r#"{"challenge":"prepare-1"}"#);
    api.set_bearer_token(Some("unrelated-token".into()));
    pollster::block_on(api.prepare_cookie_session()).unwrap();
    let requests = transport.seen.lock().unwrap();
    assert!(requests[0].with_credentials);
    assert_eq!(header(&requests[0], "Authorization"), None);

    let (api, transport) = client(201, r#"{"expiresAt":"2099-01-01T00:00:00Z"}"#);
    pollster::block_on(api.create_cookie_session(CreateCookieSessionBody {
        data_processing_consent: true,
        cookie_challenge: "prepare-1".into(),
    }))
    .unwrap();
    let requests = transport.seen.lock().unwrap();
    assert!(requests[0].with_credentials);
    assert_eq!(header(&requests[0], "Authorization"), None);
}

#[test]
fn a_size_rejection_is_told_apart_by_its_reason() {
    let body = r#"{"kind":"try-on-size-rejected","title":"Size rejected","tryOnId":"t2","reason":"garment_too_large","recommendedForeignIds":{"size":"M"}}"#;
    let (client, _) = client(422, body);
    let error = pollster::block_on(client.create_try_on(
        "p1".into(),
        "b1".into(),
        CreateTryOnBody {
            variant_id: "v1".into(),
            body_revision_id: None,
        },
    ))
    .unwrap_err();
    let ApiError::Problem {
        status: 422,
        problem: ApiProblem::TryOnGarmentTooLarge { problem },
    } = &error
    else {
        panic!("expected a too-large rejection, got {error:?}");
    };
    let suggested = problem
        .recommended_foreign_ids
        .as_ref()
        .expect("a suggested size");
    assert_eq!(suggested["size"], "M");
    if let ApiError::Problem { problem, .. } = &error {
        assert_eq!(problem.kind(), "try-on-size-rejected");
    }
}

#[test]
fn a_kind_the_client_does_not_know_still_decodes() {
    let (client, _) = client(
        401,
        r#"{"kind":"session-revoked-by-shop","title":"Revoked"}"#,
    );
    let error = pollster::block_on(client.get_session()).unwrap_err();
    let ApiError::Problem {
        status: 401,
        problem: ApiProblem::SessionUnauthorizedProblem { problem },
    } = error
    else {
        panic!("expected the 401 problem, got {error:?}");
    };
    assert_eq!(
        problem.kind,
        SessionUnauthorizedProblemKind::Unknown {
            value: "session-revoked-by-shop".into()
        }
    );
}

#[test]
fn a_known_kind_decodes_to_its_variant() {
    let (client, _) = client(401, r#"{"kind":"session-expired","title":"Expired"}"#);
    let error = pollster::block_on(client.get_session()).unwrap_err();
    let ApiError::Problem {
        problem: ApiProblem::SessionUnauthorizedProblem { problem },
        ..
    } = error
    else {
        panic!("expected the 401 problem, got {error:?}");
    };
    assert_eq!(problem.kind, SessionUnauthorizedProblemKind::SessionExpired);
}

#[test]
fn an_undeclared_status_keeps_the_body() {
    let (client, _) = client(502, "<html>Bad gateway</html>");
    let error = pollster::block_on(client.get_product_details("p1".into())).unwrap_err();
    assert_eq!(
        error,
        ApiError::UnexpectedStatus {
            status: 502,
            body: "<html>Bad gateway</html>".into()
        }
    );
}

#[test]
fn an_undecodable_success_is_a_decode_error() {
    let (client, _) = client(200, r#"{"productId":"p1"}"#);
    let error = pollster::block_on(client.get_product_details("p1".into())).unwrap_err();
    assert!(
        matches!(error, ApiError::Decode { status: 200, .. }),
        "{error:?}"
    );
}

#[test]
fn a_transport_failure_is_reported_as_such() {
    let (client, _) = scripted(Err(TransportError::Failed {
        reason: "offline".into(),
    }));
    let error = pollster::block_on(client.get_product_details("p1".into())).unwrap_err();
    assert_eq!(
        error,
        ApiError::Transport {
            reason: "offline".into()
        }
    );
}

#[test]
fn an_operation_without_a_body_returns_unit() {
    let (client, transport) = client(204, "");
    client.set_bearer_token(Some("token-1".into()));
    pollster::block_on(client.delete_session()).unwrap();
    assert_eq!(transport.seen.lock().unwrap()[0].method, "DELETE");
}

#[test]
fn numbers_keep_the_contracts_integer_and_float_types() {
    let (client, transport) = client(
        200,
        r#"{"uploadUrl":"https://upload.test/x","method":"PUT","stagingKey":"k1","requiredHeaders":[{"name":"Content-Type","value":"image/jpeg"}],"expiresAt":"2026-11-11T20:00:00Z"}"#,
    );
    client.set_bearer_token(Some("token-1".into()));
    let body = api::PrepareBodyUploadBody {
        content_type: "image/jpeg".into(),
        byte_size: 1_024_000,
        file_name: None,
    };
    let prepared = pollster::block_on(client.prepare_body_upload(body)).unwrap();
    assert_eq!(prepared.staging_key, "k1");
    // `int64` goes out as an integer: `1024000`, not `1024000.0`.
    let sent: serde_json::Value =
        serde_json::from_slice(transport.seen.lock().unwrap()[0].body.as_ref().unwrap()).unwrap();
    assert_eq!(
        sent,
        serde_json::json!({ "contentType": "image/jpeg", "byteSize": 1_024_000 })
    );
    assert!(sent["byteSize"].is_u64(), "{sent}");
}

#[test]
fn every_request_names_the_contract_date_it_was_built_for() {
    let version = api::api_version();
    assert_eq!(version, API_VERSION);
    let bytes = version.as_bytes();
    assert!(
        version.len() == 10 && bytes[4] == b'-' && bytes[7] == b'-',
        "{version} is not YYYY-MM-DD"
    );

    let (client, transport) = client(200, r#"{"status":"healthy"}"#);
    pollster::block_on(client.get_health()).unwrap();
    // The health check takes no shop key, but still names the version it expects.
    let request = &transport.seen.lock().unwrap()[0];
    assert_eq!(
        header(request, "X-Client-Version"),
        Some(format!("studio-vaai-swift/{version}").as_str())
    );
}
