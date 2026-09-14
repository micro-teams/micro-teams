/// Where the request cache survives a restart.
///
/// The cache moved into this repository with MultiPath 0.2.0 (see request_cache.dart) — it was
/// never a transport concern. This is still only the shelf: the interface is defined beside the
/// cache and implemented here, so the cache itself stays free of shared_preferences and can be
/// tested with nothing at all.
///
/// What used to live here too was a shelf for what MultiPath had measured about each line. Nothing
/// measures lines any more, so it is gone rather than kept empty: a store nobody writes to is a
/// question a later reader has to answer for themselves.
///
/// It matters most on a phone, which is where the app is killed and reopened constantly: a cold
/// start can paint what it had before the network answers instead of showing a spinner where
/// content used to be. Every method is best-effort — a store that fails is a cache miss, never an
/// error the application has to handle — so no disk, a full quota and a corrupt entry all degrade
/// to "fetch it again".
library;

import 'request_cache.dart';
import 'package:shared_preferences/shared_preferences.dart';

const String _prefix = 'mt:cache:v2:';

class PrefsCacheStore extends CacheStore {
  const PrefsCacheStore();

  @override
  Future<Map<String, String>> load() async {
    final prefs = await SharedPreferences.getInstance();
    return {
      for (final key in prefs.getKeys())
        if (key.startsWith(_prefix))
          key.substring(_prefix.length): prefs.getString(key) ?? '',
    };
  }

  @override
  Future<void> write(String key, String? encoded) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (encoded == null) {
        await prefs.remove('$_prefix$key');
      } else {
        await prefs.setString('$_prefix$key', encoded);
      }
    } catch (_) {
      // A quota that is full is a smaller problem than a request that failed because of it.
    }
  }

  @override
  Future<void> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      for (final key in prefs.getKeys().where((k) => k.startsWith(_prefix))) {
        await prefs.remove(key);
      }
    } catch (_) {
      // Best effort, as above.
    }
  }
}
