/// What the same request returned last time — offered alongside the real answer, never in place of
/// it.
///
/// It lived in the MultiPath package until 0.2.0, which reduced that package to what a transport
/// actually is: bytes over several paths. This was never that. Keying answers by request shape,
/// deciding how long one may be offered, and painting something on a cold start are decisions about
/// what this product's screens should look like while they wait — so the code moved here, where
/// those decisions belong, unchanged in behaviour.
///
/// The boundary is the whole design: the request always goes out, and the value the caller awaits is
/// always this request's result. A failure is a failure; it never quietly becomes stale data wearing
/// a success. The cache is something the caller may choose to paint with WHILE waiting, not an
/// answer the transport invents.
///
/// Which is also why nothing here decides *when* to forget. What a write makes stale is business
/// knowledge — this layer knows only that two requests looked identical. It offers invalidation by
/// request shape and leaves the timing to the application.
library;

import 'dart:convert';

/// Somewhere entries survive a restart. Every method is best-effort: a store that fails is a cache
/// miss, never an error the application has to handle.
abstract class CacheStore {
  const CacheStore();

  /// Everything previously written, as scoped key to encoded value.
  Future<Map<String, String>> load();

  /// Writes one entry, or removes it when [encoded] is null.
  Future<void> write(String key, String? encoded);

  /// Forgets everything.
  Future<void> clear();
}

class _Entry {
  const _Entry(this.value, this.at);

  final Object? value;
  final DateTime at;
}

/// Answers to identical requests, keyed by the request itself.
///
/// Keyed by the request rather than by a name the UI chooses, which is the reason this can live in
/// the transport layer at all: it needs no knowledge of screens, entities or what a write affects.
/// It also removes a classic bug — two screens inventing two different names for the same data and
/// never sharing it.
class RequestCache {
  RequestCache({
    String scope = '',
    this.maxAge = const Duration(hours: 12),
    this.maxEntries = 200,
    DateTime Function()? now,
    CacheStore? store,
  }) : _scope = scope,
       _now = now ?? DateTime.now,
       _store = store;

  /// How long an entry may be offered. Old enough and it is misleading rather than helpful.
  final Duration maxAge;

  /// Cap on entries. Least recently stored is dropped first.
  final int maxEntries;

  final DateTime Function() _now;
  final CacheStore? _store;

  /// Insertion-ordered, which is what makes eviction "oldest first" without a second structure.
  final Map<String, _Entry> _entries = {};
  String _scope;

  /// Method and path: everything that decides what a GET means, and nothing that does not.
  ///
  /// The origin is deliberately excluded. The same resource fetched over two lines is the same
  /// resource — keying by full URL would give every line its own cache and lose most hits the
  /// moment a second line existed.
  static String keyFor(String method, String url) {
    final scheme = url.indexOf('://');
    var path = url;
    if (scheme != -1) {
      final slash = url.indexOf('/', scheme + 3);
      path = slash == -1 ? '/' : url.substring(slash);
    }
    return '${method.toUpperCase()} $path';
  }

  T? get<T>(String key) {
    final scoped = _scoped(key);
    final entry = _entries[scoped];
    if (entry == null) return null;
    if (_now().difference(entry.at) > maxAge) {
      _entries.remove(scoped);
      _store?.write(scoped, null);
      return null;
    }
    return entry.value as T?;
  }

  /// Stores [value], which must be JSON-encodable if a [CacheStore] is in use.
  ///
  /// In memory the value is kept as it is, not round-tripped through JSON: a cache that hands back
  /// something subtly different from what was stored is a cache that causes bugs of its own.
  void set(String key, Object? value) {
    final scoped = _scoped(key);
    // Removed and re-inserted rather than updated, so iteration order stays oldest-first and the
    // eviction below drops the genuinely least recent.
    _entries.remove(scoped);
    _entries[scoped] = _Entry(value, _now());
    _persist(scoped, value);

    while (_entries.length > maxEntries) {
      final oldest = _entries.keys.first;
      _entries.remove(oldest);
      _store?.write(oldest, null);
    }
  }

  /// Forgets everything whose key starts with this prefix, and reports how many.
  ///
  /// By request shape, because that is all this layer can honestly reason about. "Which reads did
  /// my write invalidate" is a question about the application's own semantics, and a transport
  /// layer guessing at it would be inventing business rules.
  int invalidate(String prefix) {
    final full = _scoped(prefix);
    final doomed = _entries.keys.where((k) => k.startsWith(full)).toList();
    for (final key in doomed) {
      _entries.remove(key);
      _store?.write(key, null);
    }
    return doomed.length;
  }

  void clear() {
    _entries.clear();
    _store?.clear();
  }

  int get size => _entries.length;

  String get scope => _scope;

  /// Points the cache at a different tenant.
  ///
  /// Entries are DROPPED, not merely hidden: a signed-out user's answers sitting in memory waiting
  /// to become reachable again is exactly the accident this exists to prevent.
  ///
  /// The marker is opaque on purpose — this layer must not learn what a "user" is. It knows only
  /// that when the marker changes, everything remembered under the old one is unreachable.
  void setScope(String scope) {
    if (scope == _scope) return;
    _scope = scope;
    clear();
  }

  /// Reads whatever survived the last run into memory. Best-effort; a failure is a cold cache.
  ///
  /// Entries already too old are dropped here rather than on first read, so a restart does not
  /// carry a month of dead keys around for the sake of discovering they are dead.
  Future<void> restore() async {
    final store = _store;
    if (store == null) return;
    Map<String, String> stored;
    try {
      stored = await store.load();
    } catch (_) {
      return;
    }
    final cutoff = _now().subtract(maxAge);
    for (final entry in stored.entries) {
      try {
        final decoded = jsonDecode(entry.value);
        if (decoded is! Map) continue;
        final at = DateTime.fromMillisecondsSinceEpoch(decoded['at'] as int);
        if (at.isBefore(cutoff)) {
          await store.write(entry.key, null);
          continue;
        }
        _entries[entry.key] = _Entry(decoded['value'], at);
      } catch (_) {
        // A single unreadable entry is a miss, not a reason to abandon the rest.
      }
    }
  }

  void _persist(String scopedKey, Object? value) {
    final store = _store;
    if (store == null) return;
    try {
      store.write(
        scopedKey,
        jsonEncode({'at': _now().millisecondsSinceEpoch, 'value': value}),
      );
    } catch (_) {
      // Not encodable, or the store refused. The in-memory half still works, and a cache that
      // threw here would turn "this value cannot be persisted" into a failed request.
    }
  }

  String _scoped(String key) => '$_scope $key';
}
