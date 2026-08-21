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

import '../../app_providers.dart';
import '../../ui/theme.dart';
import 'screen_link.dart';

/// Pixels of drag per scroll step. A finger drag is continuous and tmux copy-mode is not, so the
/// gesture is quantised somewhere; here is the only sensible place.
const double _dragStep = 40;

class TerminalScreen extends ConsumerStatefulWidget {
  const TerminalScreen({
    required this.sessionId,
    this.title,
    this.connect,
    super.key,
  });

  final String sessionId;
  final String? title;

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
        ref.read(sessionProvider).value?.accessToken,
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
      appBar: AppBar(
        title: Text(widget.title ?? 'Live screen'),
        actions: [
          IconButton(
            tooltip: 'Compact',
            onPressed: () => _link?.compact(),
            icon: const Icon(Icons.compress),
          ),
        ],
      ),
      body: Column(
        children: [
          _ModeBar(mode: _mode, onChanged: _setMode),
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
class _ModeBar extends StatelessWidget {
  const _ModeBar({required this.mode, required this.onChanged});

  final ViewMode mode;
  final void Function(ViewMode) onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        children: [
          SegmentedButton<ViewMode>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(
                value: ViewMode.readonly,
                icon: Icon(Icons.visibility_outlined),
                label: Text('Watching'),
              ),
              ButtonSegment(
                value: ViewMode.scroll,
                icon: Icon(Icons.history),
                label: Text('History'),
              ),
              ButtonSegment(
                value: ViewMode.full,
                icon: Icon(Icons.keyboard),
                label: Text('Typing'),
              ),
            ],
            selected: {mode},
            onSelectionChanged: (selection) => onChanged(selection.first),
          ),
          const Spacer(),
          if (mode == ViewMode.full)
            Text(
              'the agent is not driving',
              style: Theme.of(context).textTheme.labelSmall,
            ),
        ],
      ),
    );
  }
}
