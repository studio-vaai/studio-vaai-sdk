import 'dart:async';

import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/testing.dart';

/// [ScriptedApi], with routes that wait until a test releases them: to show
/// the flow while a photo or try-on is still being processed.
final class GatedApi implements HttpTransport {
  GatedApi(this.api);
  final ScriptedApi api;
  final _gates = <String, Completer<void>>{};

  /// Holds requests to [route] (such as `POST /bodies`) until [release].
  void hold(String route) => _gates[route] = Completer<void>();

  void release(String route) => _gates.remove(route)?.complete();

  @override
  Future<HttpResponse> send(HttpRequest request) async {
    final route = request.url == ScriptedApi.uploadUrl
        ? '${request.method} upload'
        : '${request.method} ${Uri.parse(request.url).path}';
    final gate = _gates[route];
    if (gate != null) await gate.future;
    return api.send(request);
  }
}
