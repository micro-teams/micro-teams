/// The web half of [configureUrlStrategy]. See url_strategy.dart.
library;

import 'package:flutter_web_plugins/url_strategy.dart';

/// Paths, not hashes: /chats/206 is a link someone can send.
void configureUrlStrategy() => usePathUrlStrategy();
