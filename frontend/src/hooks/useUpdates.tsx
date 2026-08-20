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
import { UpdatesStore, type SyncReason } from "@/lib/updates/store";
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
 * Keep something in sync with `topic`: run `onChange` whenever the server says the answer moved,
 * or when it turns out we are behind.
 *
 * `digest` is optional but is what turns this from a notification into a synchronisation. Return a
 * short description of what you currently hold (null while you hold nothing), and the periodic
 * check will compare it against what the server says the answer should be. Without it, an event
 * that was never published stays invisible — nothing else in the system can see that.
 *
 * Both callbacks may be fresh closures every render; they are kept in a ref, so a component does
 * not have to memoize anything to avoid resubscribing on every keystroke. A null topic subscribes
 * to nothing, so a component whose id is not known yet needs no branch around the hook.
 */
export function useUpdatesTopic(
  topic: string | null,
  onChange: (reason: SyncReason) => void,
  digest?: () => string | null,
): void {
  const store = useContext(UpdatesContext);
  const latest = useRef({ onChange, digest });
  latest.current = { onChange, digest };

  useEffect(() => {
    if (!store || !topic) return;
    return store.subscribe(topic, {
      onChange: (reason) => latest.current.onChange(reason),
      digest: () => latest.current.digest?.() ?? null,
    });
  }, [store, topic]);
}

/** The store itself, for the rare caller that wants a cursor. Null outside the provider. */
export function useUpdatesStore(): UpdatesStore | null {
  return useContext(UpdatesContext);
}
