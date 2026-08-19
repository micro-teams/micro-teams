// Topic strings, built in one place — the mirror of backend Topic.kt.
//
// "thread:12" is assembled here and nowhere else, for the same reason the backend does it: a topic
// is simultaneously what you subscribe to, what you are authorized for, and what a cursor counts
// along, and those three meanings only stay in agreement while the string has one author.

export const threadTopic = (threadId: number): string => `thread:${threadId}`;

/** The thread id inside a topic, or null if it is not a thread topic. */
export function threadIdOf(topic: string): number | null {
  if (!topic.startsWith("thread:")) return null;
  const id = Number(topic.slice("thread:".length));
  return Number.isInteger(id) ? id : null;
}
