/// The non-native half of [socketOverSubstrate]. See substrate_socket.dart.
library;

import 'package:web_socket_channel/web_socket_channel.dart';

import 'multipath_adapter.dart';

/// Not on the web, and not for want of trying.
///
/// A browser will not let anything carry a WebSocket for it: a service worker cannot intercept one
/// (the fetch event does not fire), and the page cannot dial a line itself because the Dart client
/// reaches the network through `dart:io`, which dart2js compiles to a stub. Carrying a socket over
/// the substrate there means implementing RFC 6455 framing on top of a mux stream, which is a
/// protocol implementation rather than a wiring change — see the note in substrate_socket.dart.
WebSocketChannel? socketOverSubstrate(Substrate substrate, Uri url) => null;
