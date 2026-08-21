/// Small pieces of the app's own state that must survive being killed.
///
/// Deliberately NOT the request cache. MultiPath's cache answers "what did this request return last
/// time", keyed by the request, expiring on its own schedule — which is exactly right for a list of
/// chats and exactly wrong for a queue of messages the user has written and not yet sent. An outbox
/// that quietly expired after twelve hours, or that was evicted to make room for a document, would
/// lose something nobody can get back.
///
/// Reads are synchronous, because the things stored here are needed in the first frame: a queued
/// message has to appear in the conversation before the network is consulted, not after. That is
/// paid for by loading a snapshot once at boot; writes go through to disk in the background.
library;

import 'package:shared_preferences/shared_preferences.dart';

const String _prefix = 'mt:state:';

class KeyValueStore {
  KeyValueStore._(this._prefs, this._snapshot);

  /// For tests, and for any platform that refuses storage. Nothing survives a restart, which is a
  /// worse experience and never a wrong one.
  factory KeyValueStore.inMemory() => KeyValueStore._(null, {});

  /// Reads everything once so later reads can be synchronous.
  static Future<KeyValueStore> open() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return KeyValueStore._(prefs, {
        for (final key in prefs.getKeys())
          if (key.startsWith(_prefix))
            key.substring(_prefix.length): prefs.getString(key) ?? '',
      });
    } catch (_) {
      // No disk is a valid state, not a failure.
      return KeyValueStore._(null, {});
    }
  }

  final SharedPreferences? _prefs;
  final Map<String, String> _snapshot;

  String? get(String key) => _snapshot[key];

  void set(String key, String? value) {
    if (value == null) {
      _snapshot.remove(key);
      _prefs?.remove('$_prefix$key');
      return;
    }
    _snapshot[key] = value;
    _prefs?.setString('$_prefix$key', value);
  }

  /// Forgets everything belonging to whoever was signed in.
  ///
  /// Called on sign-out for the same reason the request cache is scoped: one account must never be
  /// shown another's unsent messages.
  void clear() {
    for (final key in _snapshot.keys.toList()) {
      _prefs?.remove('$_prefix$key');
    }
    _snapshot.clear();
  }
}
