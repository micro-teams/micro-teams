/// Messages the user has sent that the server has not confirmed yet.
///
/// A send is not a request; it is a promise. The user pressed send, so the message must either
/// arrive or be visibly given back — never silently lost because a train went into a tunnel. So a
/// send goes here first, is drawn immediately as pending, is retried until the server takes it,
/// and survives the app being killed in between.
///
/// Idempotency is the server's half: every send carries a clientToken, and posting the same token
/// into the same thread twice returns the message already stored rather than making a second one
/// (see PostMessageRequest in MicroTeams-API.yml). That is what makes a blind retry safe, and it
/// is why a lost RESPONSE — the case that actually happens on a flaky link — costs nothing.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:mt_api/mt_api.dart';
import '../common/errors.dart';
import '../common/api.dart';
import '../common/key_value.dart';

/// How long to wait before each retry. Bounded and slow at the end: a message that has been
/// failing for a minute is waiting on a network, and hammering it helps nobody's battery.
const List<Duration> _backoff = [
  Duration(seconds: 1),
  Duration(seconds: 2),
  Duration(seconds: 5),
  Duration(seconds: 15),
  Duration(seconds: 30),
];

class Pending {
  Pending({
    required this.clientToken,
    required this.content,
    required this.queuedAt,
    this.attempts = 0,
    this.lastError,
  });

  factory Pending.fromJson(Map<String, Object?> json) => Pending(
    clientToken: json['clientToken']! as String,
    content: json['content']! as String,
    queuedAt: DateTime.fromMillisecondsSinceEpoch(
      (json['queuedAt'] as num?)?.toInt() ?? 0,
    ),
    attempts: (json['attempts'] as num?)?.toInt() ?? 0,
  );

  final String clientToken;
  final String content;
  final DateTime queuedAt;
  int attempts;

  /// What the last attempt said, shown next to the message once it has failed enough times to be
  /// worth mentioning. Not persisted: a fresh start deserves a fresh attempt, not an old excuse.
  String? lastError;

  /// Whether this has been failing long enough that the user should be told rather than left
  /// watching a spinner that never resolves.
  bool get isStuck => attempts >= 3;

  Map<String, Object?> toJson() => {
    'clientToken': clientToken,
    'content': content,
    'queuedAt': queuedAt.millisecondsSinceEpoch,
    'attempts': attempts,
  };
}

class Outbox {
  Outbox({
    required this.threadId,
    required MtClient client,
    required KeyValueStore store,
    required this.onSent,
    required this.onChanged,
  }) : _client = client,
       _store = store {
    _restore();
  }

  final int threadId;
  final MtClient _client;
  final KeyValueStore _store;

  /// The server took it. The thread folds the real message into its list.
  final void Function(Message message) onSent;

  /// Something about the queue changed and the pending bubbles should be redrawn.
  final void Function() onChanged;

  final List<Pending> _pending = [];
  Timer? _timer;
  bool _sending = false;
  bool _disposed = false;

  List<Pending> get pending => List.unmodifiable(_pending);

  String get _key => 'outbox:$threadId';

  void enqueue(String content) {
    final clean = content.trim();
    if (clean.isEmpty) return;
    _pending.add(
      Pending(clientToken: _token(), content: clean, queuedAt: DateTime.now()),
    );
    _persist();
    onChanged();
    unawaited(_drain());
  }

  /// The user asked to try again now rather than waiting out the backoff.
  void retry(String clientToken) {
    final item = _find(clientToken);
    if (item == null) return;
    item.attempts = 0;
    item.lastError = null;
    _persist();
    onChanged();
    unawaited(_drain());
  }

  /// The user gave up. The text goes back to the composer rather than vanishing — losing what
  /// someone typed is worse than failing to send it.
  String? discard(String clientToken) {
    final item = _find(clientToken);
    if (item == null) return null;
    _pending.remove(item);
    _persist();
    onChanged();
    return item.content;
  }

  /// Anything the server already has stops being pending — matched by clientToken, so a send whose
  /// response was lost is recognised rather than sent a second time.
  void reconcile(List<Message> known) {
    final tokens = known.map((m) => m.clientToken).whereType<String>().toSet();
    if (tokens.isEmpty) return;
    final before = _pending.length;
    _pending.removeWhere((p) => tokens.contains(p.clientToken));
    if (_pending.length != before) {
      _persist();
      onChanged();
    }
  }

  void dispose() {
    _disposed = true;
    _timer?.cancel();
  }

  Future<void> _drain() async {
    if (_sending || _disposed || _pending.isEmpty) return;
    _sending = true;
    try {
      while (_pending.isNotEmpty && !_disposed) {
        final item = _pending.first;
        try {
          final response = await _client.chat.postMessage(
            id: threadId,
            postMessageRequest: PostMessageRequest(
              content: item.content,
              clientToken: item.clientToken,
            ),
          );
          final message = response.data;
          _pending.remove(item);
          _persist();
          if (message != null) onSent(message);
          onChanged();
        } on MtError catch (e) {
          item.attempts += 1;
          item.lastError = e.message;
          onChanged();

          // A refusal is not a network problem: retrying a 403 forever would be a spinner that
          // never ends, on a message that is never going to be accepted.
          if (e.isForbidden || e.isNotFound) {
            _pending.remove(item);
            _persist();
            onChanged();
            continue;
          }

          _persist();
          _scheduleRetry(item.attempts);
          return;
        }
      }
    } finally {
      _sending = false;
    }
  }

  void _scheduleRetry(int attempts) {
    if (_disposed) return;
    final wait = _backoff[min(attempts - 1, _backoff.length - 1)];
    _timer?.cancel();
    _timer = Timer(wait, () => unawaited(_drain()));
  }

  Pending? _find(String clientToken) {
    for (final item in _pending) {
      if (item.clientToken == clientToken) return item;
    }
    return null;
  }

  void _restore() {
    final raw = _store.get(_key);
    if (raw == null) return;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return;
      for (final entry in decoded) {
        if (entry is Map<String, Object?>) {
          _pending.add(Pending.fromJson(entry));
        }
      }
      // Whatever was queued when the app was killed is owed to the user, so start trying again
      // straight away rather than waiting for them to type something else.
      if (_pending.isNotEmpty) unawaited(_drain());
    } catch (_) {
      // A queue we cannot read is a queue we cannot honour; dropping it beats crashing on boot.
    }
  }

  void _persist() {
    _store.set(_key, jsonEncode(_pending.map((p) => p.toJson()).toList()));
  }

  static final Random _random = Random();

  /// Unique per message, and only has to be unique within one thread.
  String _token() {
    final now = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
    final salt = _random.nextInt(1 << 32).toRadixString(36);
    return '$now-$salt';
  }
}
