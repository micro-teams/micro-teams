/// Where MultiPath's request cache survives a restart, on this app's terms.
///
/// The cache itself is MultiPath's — the keys, the scoping, the eviction and the expiry are its
/// rules, shared with every other client in the org. What is ours is only the shelf: an interface
/// it defines and this implements, so the package keeps its zero dependencies and we keep
/// shared_preferences.
///
/// It matters most on a phone, which is where the app is killed and reopened constantly: a cold
/// start can paint what it had before the network answers instead of showing a spinner where
/// content used to be. Every method is best-effort — a store that fails is a cache miss, never an
/// error the application has to handle — so no disk, a full quota and a corrupt entry all degrade
/// to "fetch it again".
library;

import 'package:multipath/multipath.dart';
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

const String _healthKey = 'mt:lines:health:v1';

/// The same shelf, for what MultiPath measured about each line.
///
/// Small and worth keeping: without it every cold start ranks lines by the registry's configured
/// weight, which is a guess that never improves, and the first few requests of every visit go out
/// before anything has been measured.
class PrefsHealthStore extends HealthStore {
  const PrefsHealthStore();

  @override
  Future<String?> load() async {
    try {
      return (await SharedPreferences.getInstance()).getString(_healthKey);
    } catch (_) {
      // No memory of the last visit is exactly the first-visit case, which works.
      return null;
    }
  }

  @override
  Future<void> save(String encoded) async {
    try {
      await (await SharedPreferences.getInstance()).setString(
        _healthKey,
        encoded,
      );
    } catch (_) {
      // A performance hint is never worth an error the application has to handle.
    }
  }
}
