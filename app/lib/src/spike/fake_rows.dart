/// DISPOSABLE SPIKE. Delete the whole `lib/src/spike/` directory once the question below is
/// answered.
///
/// The question: on a low-end Android phone, is scrolling meaningfully smoother when ANDROID owns
/// the scroll gesture and Flutter only renders content, compared to an ordinary Flutter
/// `ListView.builder`? Nothing here may be used by real business logic — the data is fake, the
/// widgets are copies, and both exist only so the two variants render the same pixels.
///
/// The rows are a deliberate look-alike of `lib/src/chats/thread_screen.dart`'s bubbles — same
/// shape, same tail, same 72% width cap, same avatar-outside-the-bubble layout — rebuilt here from
/// nothing so that the experiment cannot accidentally measure the real widget tree, the real
/// providers, or the real `SelectionArea`.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

/// How many rows both variants render. Fixed, not random: the two variants must be the same work.
const int spikeRowCount = 200;

/// One fake message.
class SpikeRow {
  const SpikeRow({
    required this.text,
    required this.mine,
    required this.name,
    required this.tint,
  });

  final String text;
  final bool mine;
  final String name;
  final Color tint;
}

const List<String> _names = ['Ada', 'Grace', 'Linus', 'Ken', '小明'];

const List<String> _texts = [
  '在。',
  '收到，这就去看。',
  '这个问题我昨天也碰到了，重启一次就好了，但我觉得不是偶然。',
  '好',
  '我把日志翻了一遍，失败发生在握手完成之前，所以写进去的字节根本没人接——这也是为什么终端打开时不会自动 resize。',
  '明天上线吗？',
  '不了，等 CI 绿了再说。昨天有两个 PR 就是因为没跑格式检查挂的，白等了一小时。',
  'ok 👌',
  'The list feels fine on my phone but he is testing on a 2019 budget device, which is the whole '
      'point — what is smooth here is not what is smooth there.',
  '先量一下再说，别拍脑袋。',
];

/// The same 200 rows every time, on every variant, on every run.
List<SpikeRow> buildSpikeRows() {
  final rng = math.Random(20260913);
  return List<SpikeRow>.generate(spikeRowCount, (i) {
    final mine = i % 3 == 0;
    return SpikeRow(
      text: _texts[rng.nextInt(_texts.length)],
      mine: mine,
      name: _names[i % _names.length],
      tint: Color(0xFF000000 | (0x303030 * (i % 7 + 1))).withValues(alpha: 1),
    );
  });
}

const Color _ownBubble = Color(0xFF95EC69);
const Color _otherBubble = Color(0xFFFFFFFF);
const Color _ink = Color(0xFF111111);

/// A fake bubble. Cheap-but-not-trivial on purpose: text layout, a rounded box, a rotated tail and
/// a circle, which is roughly what a real bubble costs.
class SpikeBubble extends StatelessWidget {
  const SpikeBubble({super.key, required this.row});

  final SpikeRow row;

  @override
  Widget build(BuildContext context) {
    final background = row.mine ? _ownBubble : _otherBubble;
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 3, 10, 3),
      child: Row(
        textDirection: row.mine ? TextDirection.rtl : TextDirection.ltr,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: row.tint, shape: BoxShape.circle),
            alignment: Alignment.center,
            child: Text(
              row.name.characters.first,
              style: const TextStyle(color: Colors.white, fontSize: 15),
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Column(
              crossAxisAlignment: row.mine
                  ? CrossAxisAlignment.end
                  : CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(left: 4, bottom: 2),
                  child: Text(
                    row.name,
                    style: const TextStyle(fontSize: 11, color: Colors.black54),
                  ),
                ),
                LayoutBuilder(
                  builder: (context, constraints) => ConstrainedBox(
                    constraints: BoxConstraints(
                      maxWidth: constraints.maxWidth * 0.72,
                    ),
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Positioned(
                          top: 12,
                          left: row.mine ? null : -3,
                          right: row.mine ? -3 : null,
                          child: Transform.rotate(
                            angle: math.pi / 4,
                            child: Container(
                              width: 8,
                              height: 8,
                              color: background,
                            ),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.fromLTRB(10, 7, 10, 8),
                          decoration: BoxDecoration(
                            color: background,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            row.text,
                            style: const TextStyle(
                              color: _ink,
                              fontSize: 15,
                              height: 1.35,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The page colour both variants sit on, so a screenshot of one looks like a screenshot of the
/// other.
const Color spikePageColour = Color(0xFFEDEDED);
