// The updates socket as a React context: one socket for the whole app, and a hook that lets a
// component say "tell me when this topic moves".
//
// Reference counting and provider shape follow AgentPresenceProvider, which already solved the same
// problem for presence. Nothing here interprets a topic; a subscriber is handed a callback and
// decides for itself what to refetch, so this file never learns what a thread or a message is.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { UpdatesStore, type TopicListener } from "@/lib/updates/store";
import { openUpdatesSocket } from "@/lib/updates/socket";

const UpdatesContext = createContext<UpdatesStore | null>(null);

export function UpdatesProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new UpdatesStore(), []);

  useEffect(() => {
    const socket = openUpdatesSocket(store);
    return () => socket.close();
  }, [store]);

  return (
    <UpdatesContext.Provider value={store}>{children}</UpdatesContext.Provider>
  );
}

/**
 * Be told when `topic` moves. `onChange` may be a fresh closure on every render — it is kept in a
 * ref, so a component does not have to memoize it to avoid resubscribing on every keystroke.
 *
 * A null topic subscribes to nothing, so a component whose id is not known yet does not need a
 * branch around the hook.
 *
 * Missing this callback is not supposed to be fatal anywhere: it is an accelerator on top of the
 * fetching that was already there. If it ever becomes the only way something updates, the polling
 * that still backs it can be removed — and not before.
 */
export function useUpdatesTopic(
  topic: string | null,
  onChange: TopicListener,
): void {
  const store = useContext(UpdatesContext);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!store || !topic) return;
    return store.subscribe(topic, (reason) => latest.current(reason));
  }, [store, topic]);
}

/** The store itself, for the rare caller that wants a cursor. Null outside the provider. */
export function useUpdatesStore(): UpdatesStore | null {
  return useContext(UpdatesContext);
}
