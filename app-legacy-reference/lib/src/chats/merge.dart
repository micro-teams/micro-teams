/// How a thread's message list is assembled from two different sources.
///
/// A chat pane reads the server two ways at once: the newest page, refetched whenever the sync
/// layer says the thread moved, and — when the reader scrolls up — cursor pages walking backwards
/// through history. Both write into one list, so the merge rules live here, as plain functions
/// over ids, where they can be tested without a device.
///
/// The rule that matters: the newest page is the server's truth only for the range it covers.
/// Older messages the newest page no longer returns are not gone — they are simply off the page —
/// so they are kept. Replacing the whole list on each refetch silently throws away every older
/// page the reader had just scrolled up to load, which is exactly the bug the React panes had
/// before these functions existed.
library;

import 'package:mt_api/mt_api.dart';

int _byId(Message a, Message b) => a.id.compareTo(b.id);

/// Fold a freshly fetched newest page into what we already have.
///
/// Everything older than the page's first id is kept as-is (loaded history, plus anything that
/// fell off the page as new messages arrived — otherwise a gap would open there); everything
/// inside the page's range comes from the page, so an edit or a delete in the recent window still
/// propagates.
List<Message> mergeNewestPage(List<Message> known, List<Message> page) {
  if (page.isEmpty) return known;
  final sorted = [...page]..sort(_byId);
  final floor = sorted.first.id;
  final older = known.where((m) => m.id < floor);
  return [...older, ...sorted];
}

/// Fold an older cursor page in, ignoring ids we already hold (pages can overlap).
List<Message> mergeOlderPage(List<Message> known, List<Message> page) {
  final have = known.map((m) => m.id).toSet();
  final added = page.where((m) => !have.contains(m.id)).toList();
  if (added.isEmpty) return known;
  return [...added, ...known]..sort(_byId);
}

/// What this pane holds, in the form the server can be asked to confirm.
///
/// Mirrors ThreadQuery.digest on the backend: the newest id and how many messages, over the newest
/// [window] — the same window on both sides, which is the only reason the two are comparable at
/// all. Scrolling up loads older pages, so what we hold can be larger than that window; the digest
/// is taken over the newest slice of it.
///
/// Returns null when the pane holds nothing and is still loading: that is not a disagreement with
/// the server, it is a fetch already in flight, and answering "empty" would start a second one.
String? threadDigest(
  List<Message> held, {
  required bool loading,
  required int window,
}) {
  if (held.isEmpty) return loading ? null : 'empty';
  final page = held.length <= window
      ? held
      : held.sublist(held.length - window);
  return '${page.last.id}:${page.length}';
}
