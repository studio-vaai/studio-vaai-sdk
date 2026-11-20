import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'generated/api.dart';

/// Sends the requests the core builds with `dart:io`'s [HttpClient].
///
/// The core never opens a connection: it builds every request (URL, headers,
/// body) and hands it to an [HttpTransport]. This one returns every response,
/// whatever its status, and fails only when there is no response at all. Pass
/// your own [HttpClient] to set proxies, certificates or connection limits.
final class IoHttpTransport implements HttpTransport {
  IoHttpTransport({HttpClient? client, this.deadline})
    : _client = client ?? HttpClient(),
      _owned = client == null;

  final HttpClient _client;
  final bool _owned;

  /// When set, a request still running at this time fails as not completed.
  final DateTime? deadline;

  /// The same client, with requests that fail at [deadline].
  IoHttpTransport until(DateTime deadline) => IoHttpTransport(client: _client, deadline: deadline);

  @override
  Future<HttpResponse> send(HttpRequest request) async {
    final remaining = deadline?.difference(DateTime.now());
    if (remaining != null && remaining <= Duration.zero) {
      throw NotSentTransportException('The operation ran out of time before sending.');
    }
    try {
      final exchange = _exchange(request);
      return await (remaining == null ? exchange : exchange.timeout(remaining));
    } on TransportException {
      rethrow;
    } catch (_) {
      // An I/O error can contain a URL, including signed parameters.
      throw FailedTransportException('The API request did not complete.');
    }
  }

  Future<HttpResponse> _exchange(HttpRequest request) async {
    final outgoing = await _client.openUrl(request.method, Uri.parse(request.url));
    outgoing.followRedirects = false;
    for (final header in request.headers) {
      outgoing.headers.add(header.name, header.value, preserveHeaderCase: true);
    }
    final body = request.body;
    if (body != null) {
      outgoing.contentLength = body.length;
      outgoing.add(body);
    }
    final response = await outgoing.close();
    final bytes = BytesBuilder(copy: false);
    await response.forEach(bytes.add);
    final headers = <HttpHeader>[];
    response.headers.forEach((name, values) {
      for (final value in values) {
        headers.add(HttpHeader(name: name, value: value));
      }
    });
    return HttpResponse(status: response.statusCode, headers: headers, body: bytes.takeBytes());
  }

  /// Closes the [HttpClient] this transport created; one passed in stays open.
  void close() {
    if (_owned) _client.close(force: true);
  }
}
