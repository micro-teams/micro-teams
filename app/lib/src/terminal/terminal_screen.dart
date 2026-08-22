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

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:xterm/xterm.dart';

import '../providers.dart';
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
  String? _failure;

  @override
  void initState() {
    super.initState();

    _terminal.onOutput = (data) => _link?.sendKeys(data);
    _terminal.onResize = (cols, rows, _, _) =>
        _link?.sendSize(cols: cols, rows: rows);

    final endpoints = ref.read(endpointsProvider);
    _link = ScreenLink(
      // Read the token per dial: a socket that reconnects with an expired token is refused, and a
      // refusal looks exactly like a machine that has gone quiet.
      url: () => endpoints.screenSocket(
        widget.sessionId,
        ref.read(sessionProvider).valueOrNull?.accessToken,
      ),
      // The terminal takes text; the wire carries bytes. Decoding here rather than in the
      // link keeps the link free of any opinion about what the bytes mean.
      onBytes: (bytes) => _terminal.write(
        const Utf8Decoder(allowMalformed: true).convert(bytes),
      ),
      onClosed: _handleClosed,
      connect: widget.connect,
    )..open();
    _everOpened = true;
  }

  @override
  void dispose() {
    _link?.close();
    super.dispose();
  }

  void _handleClosed() {
    if (!mounted) return;
    setState(() {
      _failure = _everOpened
          ? 'The connection to this screen dropped.'
          : 'This screen is gone, or you are not allowed to watch it.';
    });
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

  @override
  Widget build(BuildContext context) {
    final failure = _failure;

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
          if (failure != null)
            Container(
              width: double.infinity,
              color: Theme.of(context).colorScheme.errorContainer,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text(
                failure,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onErrorContainer,
                ),
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
