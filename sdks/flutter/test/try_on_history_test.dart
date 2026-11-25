// The kept try-on IDs (`TryOnHistory`): per body, at most 24, oldest first,
// and writes in the same turn never lose one another.
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/src/experience/session_store.dart';

RememberedTryOn _tryOn(String id) =>
    RememberedTryOn(tryOnId: id, productId: 'p', variantId: 'v', backendRevision: 'r1');

void main() {
  test('two try-ons remembered in the same turn are both kept', () async {
    final history = TryOnHistory(MemoryTryOnSessionStore(), 'key');
    await Future.wait([
      history.remember('body', _tryOn('a')),
      history.remember('body', _tryOn('b')),
    ]);
    expect([for (final t in await history.of('body')) t.tryOnId], ['a', 'b']);
  });

  test('a forget racing a remember keeps the new try-on', () async {
    final store = MemoryTryOnSessionStore();
    final history = TryOnHistory(store, 'key');
    await history.remember('body', _tryOn('a'));
    await Future.wait([
      history.forget(['a']),
      history.remember('body', _tryOn('b')),
    ]);
    expect([for (final t in await history.of('body')) t.tryOnId], ['b']);
    final relaunched = TryOnHistory(store, 'key');
    expect([for (final t in await relaunched.of('body')) t.tryOnId], ['b']);
  });

  test('a new body replaces the list; at most 24 are kept', () async {
    final history = TryOnHistory(MemoryTryOnSessionStore(), 'key');
    for (var i = 0; i < 30; i++) {
      await history.remember('body', _tryOn('$i'));
    }
    final kept = await history.of('body');
    expect(kept, hasLength(TryOnHistory.limit));
    expect(kept.first.tryOnId, '6');
    await history.remember('other', _tryOn('x'));
    expect(await history.of('body'), isEmpty);
    expect([for (final t in await history.of('other')) t.tryOnId], ['x']);
  });
}
