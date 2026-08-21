/// A small stale-while-revalidate cache for the app's reads.
///
/// Everything the UI fetches writes its result here under a stable key. On the next visit the UI
/// paints the cached value immediately and revalidates in the background, so going back to a
/// screen you have already seen shows content at once instead of a spinner. On a phone that is
/// most of the experience: the app is killed constantly and reopened constantly.
///
/// Two layers, as in the React client:
///   * an in-memory map — the source of truth for the running session;
///   * a disk mirror — so a cold start can paint before the network answers.
///
/// Scoped to the signed-in user (see [setScope]): a different user, or a sign-out, purges
/// everything, so one account never paints another's data. Entries older than [_ttl] are ignored
/// on read. All persistence is best-effort: any miss, quota or parse error just falls back to a
/// normal fetch.
library;

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

const String _prefix = 'mt:cache:v1:';
const String _scopeKey = 'mt:cache:scope';
const Duration _ttl = Duration(hours: 12);

class ReadCache {
  ReadCache._(this._prefs, this._scope);

  final SharedPreferences? _prefs;
  final Map<String, Object?> _memory = {};
  String? _scope;

  /// Open the cache. Called once during boot, before anything reads.
  ///
  /// The scope is read from disk here rather than being handed in, because a cold start has to be
  /// able to paint before the auth layer has re-confirmed who is signed in — [setScope]
  /// reconciles a moment later, and drops everything if it turns out to be someone else.
  static Future<ReadCache> open() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return ReadCache._(prefs, prefs.getString(_scopeKey));
    } catch (_) {
      // No disk is a valid state, not a failure: the in-memory half still works.
      return ReadCache._(null, null);
    }
  }

  /// A cache with no disk behind it. For tests, and for any platform where storage is refused.
  factory ReadCache.inMemory() => ReadCache._(null, null);

  T? get<T>(String key) {
    if (_memory.containsKey(key)) return _memory[key] as T?;
    final scope = _scope;
    final prefs = _prefs;
    if (scope == null || prefs == null) return null;
    try {
      final raw = prefs.getString(_diskKey(key));
      if (raw == null) return null;
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) return null;
      final at = decoded['ts'];
      if (at is! num) return null;
      final age = DateTime.now().millisecondsSinceEpoch - at.toInt();
      if (age > _ttl.inMilliseconds) return null;
      final data = decoded['data'] as T?;
      _memory[key] = data;
      return data;
    } catch (_) {
      return null;
    }
  }

  void set<T>(String key, T data) {
    _memory[key] = data;
    final scope = _scope;
    final prefs = _prefs;
    if (scope == null || prefs == null) return;
    try {
      final encoded = jsonEncode({
        'data': data,
        'ts': DateTime.now().millisecondsSinceEpoch,
      });
      unawaited(prefs.setString(_diskKey(key), encoded));
    } catch (_) {
      // not serialisable, or the disk said no — the in-memory copy still works.
    }
  }

  void invalidate(String key) {
    _memory.remove(key);
    final prefs = _prefs;
    if (_scope == null || prefs == null) return;
    unawaited(prefs.remove(_diskKey(key)));
  }

  /// Point the cache at the currently signed-in user. Call on login, on the boot session-restore,
  /// and on logout (with null).
  ///
  /// The same user across a restart keeps the cache. A DIFFERENT user, or a sign-out, clears
  /// everything — memory and disk — so no account ever sees another's cached reads.
  Future<void> setScope(Object? userId) async {
    final next = userId?.toString();
    final prefs = _prefs;

    if (next == null) {
      _memory.clear();
      await _purge();
      _scope = null;
      await prefs?.remove(_scopeKey);
      return;
    }

    final persisted = prefs?.getString(_scopeKey);
    if (persisted != null && persisted != next) {
      _memory.clear();
      await _purge();
    }
    _scope = next;
    await prefs?.setString(_scopeKey, next);
  }

  String _diskKey(String key) => '$_prefix$_scope:$key';

  Future<void> _purge() async {
    final prefs = _prefs;
    if (prefs == null) return;
    for (final key in prefs.getKeys().toList(growable: false)) {
      if (key.startsWith(_prefix)) await prefs.remove(key);
    }
  }
}

/// `unawaited` without importing dart:async everywhere it is needed.
void unawaited(Future<void> future) {
  future.catchError((Object _) {});
}
