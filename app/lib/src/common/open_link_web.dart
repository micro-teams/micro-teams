/// The web half of [openLink]: a new tab, which is what a download link is.
library;

import 'package:web/web.dart' as web;

bool openLink(String url) {
  web.window.open(url, '_blank');
  return true;
}
