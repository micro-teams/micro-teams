/// The live screen of one machine.
///
/// Three modes, and the difference between them is a promise to the machine rather than a UI
/// preference:
///   * **watching** — never types. An agent may keep working.
///   * **history** — paging back through tmux. The driver holds its last verdict rather than
///     sampling a screen that is showing the past.
///   * **typing** — a human has the keyboard.
///
/// The wire lives in [ScreenLink], which is where those promises are actually kept and tested. This
/// file is the terminal, the gestures and the bar — the parts that need a device to judge.
///
/// Scrolling is not local. The hosted program is a full-screen TUI that keeps no scrollback, and
/// the history lives in tmux on the machine, so a wheel or a drag sends a scroll control the
/// connector turns into tmux copy-mode. A terminal widget scrolling its own empty buffer would
/// look like it worked and show nothing.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:xterm/xterm.dart';

import '../providers.dart';
import '../common/stream_lines.dart';
import '../common/ui/theme.dart';
import 'screen_link.dart';

/// Pixels of drag per scroll step. A finger drag is continuous and tmux copy-mode is not, so the
/// gesture is quantised somewhere; here is the only sensible place.
const double _dragStep = 40;

class TerminalScreen extends ConsumerStatefulWidget {
  const TerminalScreen({
    required this.sessionId,
    this.title,
    this.connect,
    this.onClose,
    super.key,
  });

  final String sessionId;
  final String? title;

  /// How to get out, when this is the overlay rather than a route. Null makes the header's leading
  /// control whatever the surrounding navigator would put there.
  final VoidCallback? onClose;

  /// Replaces the socket. Only a test passes this — the seam exists because a terminal that can
  /// only be exercised against a live machine is a terminal whose failure modes are never tested.
  final ScreenSocket Function(Uri url)? connect;

  @override
  ConsumerState<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends ConsumerState<TerminalScreen> {
  /// A deliberately tiny scrollback. tmux owns the history — a large local buffer would be a
  /// second, disagreeing copy of it, and scrolling it would show the reader a stale fragment while
  /// the scroll controls are busy paging the real thing.
  ///
  /// Not zero: xterm.dart divides by maxLines when it builds its ring, so `maxLines: 0` throws
  /// IntegerDivisionByZeroException the moment the terminal is built. Found by a widget test; on a
  /// device it would have been a blank screen with a stack trace behind it.
  final _terminal = Terminal(maxLines: 64);
  final _controller = TerminalController();

  ScreenLink? _link;
  ViewMode _mode = ViewMode.readonly;
  double _drag = 0;
  bool _everOpened = false;

  /// Which attempt the next dial is, and the timer that will make it. Reset by a handshake.
  int _attempt = 0;
  Timer? _retry;

  /// Fires once a connection has lasted long enough to count as working.
  Timer? _stable;
  bool _reconnecting = false;

  @override
  void initState() {
    super.initState();

    _terminal.onOutput = (data) => _link?.sendKeys(data);
    _terminal.onResize = (cols, rows, _, _) =>
        _link?.sendSize(cols: cols, rows: rows);

    _dial();
  }

  /// One attempt to reach the screen, and the reason there is a loop around it.
  ///
  /// A live screen used to be dialled exactly once. If that one attempt failed — the app had only
  /// just started and the session had no token yet, or the line it picked could not carry a stream —
  /// the screen was simply dead, with a red banner and no way forward but leaving and coming back.
  /// And a connection that dropped an hour later stayed dropped, which for the app's longest-lived
  /// stream is the case that actually happens.
  ///
  /// Each attempt re-dials, and re-dialling is what re-picks the line: a line that could not hold
  /// the stream has just earned a penalty and is skipped, and the ranking is read afresh, so the
  /// second attempt is over the best line MEASURED rather than the one that happened to be first
  /// before any probe had landed. Backing off, because a screen that is genuinely gone must not be
  /// asked for forever.
  void _dial() {
    _retry?.cancel();
    _stable?.cancel();
    _link?.close();

    // Over a line, not over the page's origin. A live screen is the app's heaviest stream — every
    // keystroke and every frame of output — and it was the one connection still hard-wired to
    // whichever host served the document, so a viewer on the far side of the world watched a
    // machine sitting next to a nearer line.
    final streams = ref.read(streamLinesProvider);
    StreamDial? dial;
    _link = ScreenLink(
      // Read the token per dial: a socket that reconnects with an expired token is refused, and a
      // refusal looks exactly like a machine that has gone quiet. The line is chosen per dial for
      // the same reason — one that cannot hold a stream is skipped on the next attempt rather than
      // retried forever.
      url: () {
        final token = ref.read(sessionProvider).valueOrNull?.accessToken;
        dial = streams.dial(
          ref.read(endpointsProvider).screenPath(widget.sessionId, token),
        );
        return dial!.url;
      },
      onOpened: () {
        dial?.opened(DateTime.now());
        if (!mounted) return;
        // Here, not after open(): what makes an attempt a success is the handshake, not the dial.
        // Set at dial time — as it was — every failure read as "the connection dropped", including
        // the ones where there was never a connection.
        setState(() {
          _everOpened = true;
          _reconnecting = false;
        });
        // The backoff is forgiven only once this connection has LASTED. Opening proves the
        // handshake; holding proves the line.
        _stable?.cancel();
        _stable = Timer(_stableAfter, () {
          if (mounted) _attempt = 0;
        });
      },
      // The terminal takes text; the wire carries bytes. Decoding here rather than in the
      // link keeps the link free of any opinion about what the bytes mean.
      onBytes: (bytes) => _terminal.write(
        const Utf8Decoder(allowMalformed: true).convert(bytes),
      ),
      onClosed: () {
        dial?.closed(DateTime.now());
        _handleClosed();
      },
      connect: widget.connect,
    )..open();
  }

  @override
  void dispose() {
    _retry?.cancel();
    _stable?.cancel();
    _link?.close();
    super.dispose();
  }

  /// The reconnect policy, which is `connectOverLines` from the JS package written out in Dart —
  /// same numbers, same rules, because a viewer that behaves differently on two clients is two
  /// products.
  ///
  ///   * the first retry waits [_firstWait], and each consecutive failure doubles it up to [_maxWait];
  ///   * it never stops. Every line in a MultiPath deployment is expected to be less reliable than
  ///     one well-chosen line, and the whole bet is that several beat one — which only pays if
  ///     breaking is routine and recovering is automatic. Giving up after five tries, as this did,
  ///     turns a machine that was away for twenty seconds into a screen somebody has to re-open;
  ///   * the counter is reset by SURVIVING [_stableAfter], not by the handshake. A line that accepts
  ///     a connection and drops it immediately otherwise looks like a success every time, and the
  ///     client reconnects to it in a tight loop forever.
  static const Duration _firstWait = Duration(milliseconds: 500);
  static const Duration _maxWait = Duration(seconds: 30);
  static const Duration _stableAfter = Duration(seconds: 5);

  Duration get _wait {
    var wait = _firstWait;
    for (var i = 1; i < _attempt && wait < _maxWait; i++) {
      wait *= 2;
    }
    return wait > _maxWait ? _maxWait : wait;
  }

  void _handleClosed() {
    if (!mounted) return;
    _stable?.cancel();
    _attempt++;
    setState(() {
      _reconnecting = true;
      // Said once the first attempt has failed, so the reader knows what is being retried rather
      // than watching a black rectangle with a spinner over it.
    });
    _retry = Timer(_wait, () {
      if (mounted) _dial();
    });
  }

  /// For a person who is not willing to wait out the backoff. It never becomes the only way back —
  /// the loop is still running underneath — it just skips the wait.
  void _tryAgain() {
    setState(() {
      _attempt = 0;
      _reconnecting = true;
    });
    _dial();
  }

  void _setMode(ViewMode next) {
    setState(() => _mode = next);
    _link?.setMode(next, cols: _terminal.viewWidth, rows: _terminal.viewHeight);
  }

  void _scrollBy(double dy) {
    // Dragging DOWN reveals earlier output, the way pulling a page down shows what is above it.
    _drag += dy;
    while (_drag.abs() >= _dragStep) {
      final up = _drag > 0;
      _link?.sendScroll(up ? ScrollDirection.up : ScrollDirection.down);
      _drag += up ? -_dragStep : _dragStep;
    }
  }

  /// Several attempts, and not one of them has ever connected. Then "reconnecting" alone is a
  /// hopeful reading of the evidence, and the other possibility is worth saying out loud.
  bool get _doubtful => !_everOpened && _attempt > 2;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      // One row of chrome, not two. A terminal is the content; everything around it is a tax on the
      // number of lines you can see, which on a phone is the whole argument. The agent's name is
      // not here either — you came from its avatar, you know whose screen this is.
      body: Column(
        children: [
          SafeArea(
            bottom: false,
            child: _Chrome(
              mode: _mode,
              onChanged: _setMode,
              onCompact: () => _link?.compact(),
              onClose: widget.onClose,
            ),
          ),
          // One row, never two: what is happening (still trying), and — once it has failed often
          // enough that "still trying" stops being the whole story — why it might be failing.
          if (_reconnecting)
            Container(
              width: double.infinity,
              color: _doubtful
                  ? Theme.of(context).colorScheme.errorContainer
                  : Theme.of(context).colorScheme.surfaceContainerHigh,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  const SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _doubtful
                          ? 'still trying — this screen may be gone, or not '
                                'yours to watch'
                          : 'reconnecting…',
                      style: TextStyle(
                        color: _doubtful
                            ? Theme.of(context).colorScheme.onErrorContainer
                            : Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  // Once the waits have grown, somebody who knows the machine is back should not
                  // have to sit through the next one.
                  if (_attempt > 2)
                    TextButton(
                      onPressed: _tryAgain,
                      child: const Text('try again'),
                    ),
                ],
              ),
            ),
          Expanded(
            child: Listener(
              // A wheel on a desktop and a finger on a phone are the same intent, and both have to
              // reach tmux rather than a local buffer.
              onPointerSignal: (event) {
                if (event is PointerScrollEvent) {
                  _scrollBy(-event.scrollDelta.dy);
                }
              },
              child: GestureDetector(
                onVerticalDragUpdate: (details) => _scrollBy(details.delta.dy),
                onVerticalDragEnd: (_) => _drag = 0,
                child: TerminalView(
                  _terminal,
                  controller: _controller,
                  // Only the typing mode takes the keyboard. On a phone this is also what keeps
                  // the soft keyboard from covering half the screen while someone is only watching.
                  autofocus: _mode == ViewMode.full,
                  readOnly: _mode != ViewMode.full,
                  backgroundOpacity: 1,
                  // Black and white, at the ends of the range rather than near them. A terminal
                  // borrowed the app's dark grey and its off-white before, and the result read as
                  // a panel of the app that happened to contain a shell; this reads as a terminal.
                  theme: _terminalTheme,
                  textStyle: const TerminalStyle(
                    fontSize: 13,
                    fontFamily: monoFamily,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The three modes, named for what they mean to the person rather than to the protocol.
/// Black is black and white is white.
///
/// tmux draws with the palette it is given, and the app's dark grey background plus its off-white
/// ink made a terminal look like a panel of the app that happened to contain a shell. The ANSI
/// sixteen are left as xterm's defaults — those are the colours a program picked on purpose, and
/// re-tinting them would be answering for the program.
const TerminalTheme _terminalTheme = TerminalTheme(
  cursor: Color(0xFFFFFFFF),
  selection: Color(0x40FFFFFF),
  foreground: Color(0xFFFFFFFF),
  background: Color(0xFF000000),
  black: Color(0xFF000000),
  red: Color(0xFFCD3131),
  green: Color(0xFF0DBC79),
  yellow: Color(0xFFE5E510),
  blue: Color(0xFF2472C8),
  magenta: Color(0xFFBC3FBC),
  cyan: Color(0xFF11A8CD),
  white: Color(0xFFE5E5E5),
  brightBlack: Color(0xFF666666),
  brightRed: Color(0xFFF14C4C),
  brightGreen: Color(0xFF23D18B),
  brightYellow: Color(0xFFF5F543),
  brightBlue: Color(0xFF3B8EEA),
  brightMagenta: Color(0xFFD670D6),
  brightCyan: Color(0xFF29B8DB),
  brightWhite: Color(0xFFFFFFFF),
  searchHitBackground: Color(0xFFFFFF2B),
  searchHitBackgroundCurrent: Color(0xFF31FF26),
  searchHitForeground: Color(0xFF000000),
);

/// The one row above the terminal: the way out, the three modes, and compact.
///
/// Everything in it is small on purpose. This row costs two lines of terminal at a comfortable
/// size, and a terminal is a thing you are reading — the chrome should be findable, not prominent.
class _Chrome extends StatelessWidget {
  const _Chrome({
    required this.mode,
    required this.onChanged,
    required this.onCompact,
    required this.onClose,
  });

  final ViewMode mode;
  final void Function(ViewMode) onChanged;
  final VoidCallback onCompact;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      color: scheme.surfaceContainerHighest,
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      child: Row(
        children: [
          if (onClose != null)
            _SmallButton(
              tooltip: 'close',
              icon: Icons.close,
              onPressed: onClose!,
            ),
          const SizedBox(width: 4),
          // Icons alone, with tooltips: the three words did not fit beside everything else, and
          // what the modes mean is a thing you learn once and then recognise by shape.
          for (final option in const [
            (
              mode: ViewMode.readonly,
              icon: Icons.visibility_outlined,
              label: 'watching',
            ),
            (mode: ViewMode.scroll, icon: Icons.history, label: 'history'),
            (mode: ViewMode.full, icon: Icons.keyboard, label: 'typing'),
          ])
            _SmallButton(
              tooltip: option.label,
              icon: option.icon,
              selected: mode == option.mode,
              onPressed: () => onChanged(option.mode),
            ),
          const Spacer(),
          if (mode == ViewMode.full)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Text(
                'the agent is not driving',
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ),
          _SmallButton(
            tooltip: 'compact',
            icon: Icons.compress,
            onPressed: onCompact,
          ),
        ],
      ),
    );
  }
}

/// A 28px control. Material's default is 48 for a finger, which is right for a bar you press often
/// and wrong for a strip that is stealing lines from the thing you are reading.
class _SmallButton extends StatelessWidget {
  const _SmallButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.selected = false,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: selected ? scheme.surface : Colors.transparent,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(6),
          child: SizedBox(
            width: 28,
            height: 28,
            child: Icon(
              icon,
              size: 16,
              color: selected ? scheme.primary : scheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }
}
