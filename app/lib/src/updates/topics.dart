/// Topic strings, built in one place — the mirror of the backend's Topic.kt.
///
/// "thread:12" is assembled here and nowhere else, for the same reason the backend does it: a
/// topic is simultaneously what you subscribe to, what you are authorized for, and what a cursor
/// counts along, and those three meanings only stay in agreement while the string has one author.
library;

String threadTopic(int threadId) => 'thread:$threadId';

/// One person's chat list. Scoped to the user because that is what the list is.
String chatsTopic(int userId) => 'chats:$userId';

/// A team's machines and the agents on them, including which are alive.
String teamTopic(int teamId) => 'team:$teamId';

/// The thread id inside a topic, or null if it is not a thread topic.
int? threadIdOf(String topic) {
  const prefix = 'thread:';
  if (!topic.startsWith(prefix)) return null;
  return int.tryParse(topic.substring(prefix.length));
}
