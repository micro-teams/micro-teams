/// A WebSocket carried inside the MultiPath substrate.
///
/// The app's two long-lived connections — the updates feed and a live terminal — are the traffic
/// redundancy is most worth having on: a request that fails can be sent again, while a socket that
/// drops takes the screen with it. Until now they were the one thing still dialled beside the
/// transport rather than inside it, so a line dying disconnected them even though every request the
/// app made survived it.
///
/// Nothing here implements WebSocket. The handshake is an ordinary HTTP request, and after the 101
/// the same connection carries frames — so this writes the request onto a mux stream, reads the
/// response back, and hands what is left to `dart:io`'s own WebSocket. Framing, masking, ping/pong
/// and close are the platform's, exactly as they are for a socket it dialled itself.
library;

export 'substrate_socket_stub.dart'
    if (dart.library.io) 'substrate_socket_io.dart';
