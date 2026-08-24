/// Opening an address outside the app.
///
/// One call, both worlds. On the web it is a new tab; on a phone it is whatever the system does
/// with a link, which for an APK is the browser's own download. It used to be a no-op on native
/// with a clipboard fallback, and the fallback was invisible: the download button "did nothing".
library;

import 'package:url_launcher/url_launcher.dart';

/// True when something was actually opened. A caller that cares can fall back — see the download
/// list, which copies the address instead rather than leaving a button that says nothing happened.
Future<bool> openLink(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null) return false;
  try {
    return await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    return false;
  }
}
