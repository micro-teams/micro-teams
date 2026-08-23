/// The right-hand half of a two-pane window, and how what is in it changes.
///
/// On a phone, opening a conversation is a page replacing a page: the platform's own push carries
/// it, and asking for more would be asking for an animation on top of an animation. On a desktop
/// the list never goes anywhere — only this half changes — so there is no push to carry it, and
/// without something here the pane simply blinks from "pick a conversation" to a conversation.
///
/// One widget rather than the same switcher written into every two-pane screen, so docs and chats
/// cannot drift into two different ideas of how the same movement looks.
library;

import 'package:flutter/material.dart';

class DetailPane extends StatelessWidget {
  const DetailPane({required this.child, super.key});

  /// What the pane is showing. Give it a key that changes when the SUBJECT changes — the thread id,
  /// the document path — or switching between two documents will not animate at all, because the
  /// switcher has no way to tell that anything happened.
  final Widget child;

  /// Short enough to feel like a response rather than a wait: this runs on every selection, and an
  /// animation you notice twice is an animation you resent by the tenth time.
  static const Duration _duration = Duration(milliseconds: 180);

  @override
  Widget build(BuildContext context) => AnimatedSwitcher(
    duration: _duration,
    switchInCurve: Curves.easeOut,
    switchOutCurve: Curves.easeIn,
    // The pane that is leaving is not laid out on top of the one arriving: two conversations
    // overlapping for a fifth of a second reads as a glitch, not as a transition.
    layoutBuilder: (current, previous) => Stack(
      alignment: Alignment.center,
      children: [
        ...previous.map((child) => Positioned.fill(child: child)),
        if (current != null) current,
      ],
    ),
    // A fade and nothing else. There was a small slide, and it was wrong for the case that happens
    // most: moving between two conversations is not arriving from anywhere, so sliding in from the
    // side described a movement that had not happened — and a movement you did not ask for, twenty
    // times an afternoon, is an irritation rather than an effect.
    transitionBuilder: (child, animation) =>
        FadeTransition(opacity: animation, child: child),
    child: child,
  );
}
