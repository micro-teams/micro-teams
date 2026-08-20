// The one socket, and the loop that keeps it up.
//
// It reuses the same line chooser the live terminal uses (connectOverLines), so this connection is
// not pinned to whichever route served the page — and, like that one, it authenticates with a token
// in the query string rather than a cookie, because a WebSocket handshake is not subject to CORS.
//
// A heartbeat is here for one specific failure and not for any other: a half-open socket, where the
// TCP connection is gone but no close event ever fires. That is the only thing a heartbeat can
// detect. It cannot detect the failure this system is actually prone to — an event that was never
// published at all — and nothing here should be read as covering that. The polling left in place
// upstream is what covers that, deliberately.

import { connectOverLines } from "@micro-teams/multipath";
import { lineManager, MT_PATH } from "@/lib/lines";
import { getNtAccessToken } from "@/lib/mtApi";
import { parseFrame } from "@/lib/updates/protocol";
import { UpdatesStore } from "@/lib/updates/store";

/** How long the socket may stay silent before we assume it is a corpse and reconnect. */
const SILENCE_MS = 45_000;
/** How often we prod it. Well inside SILENCE_MS so a healthy socket never trips the check. */
const PING_MS = 20_000;

export interface UpdatesSocket {
  close: () => void;
}

/**
 * Open the updates socket and pump it into `store`. Returns a handle whose `close` stops everything
 * including the reconnect loop.
 */
export function openUpdatesSocket(store: UpdatesStore): UpdatesSocket {
  let closed = false;
  let ws: WebSocket | null = null;
  let lastHeard = Date.now();

  const ping = window.setInterval(() => {
    if (closed) return;
    const socket = ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastHeard > SILENCE_MS) {
      // Nothing has arrived for a long time, not even our own pong. Close it and let the reconnect
      // loop dial again — a socket that is dead but not closed is the one thing this timer exists
      // to notice.
      try {
        socket.close();
      } catch {
        /* already gone */
      }
      return;
    }
    try {
      socket.send(JSON.stringify({ t: "ping" }));
    } catch {
      /* the close handler will deal with it */
    }
  }, PING_MS);

  // Coming back to the tab refetches everything once — see UpdatesStore.refocused for why this
  // stays forever even though the polls are gone.
  const onVisible = () => {
    if (!closed && document.visibilityState === "visible") store.refocused();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);

  const connection = connectOverLines({
    lines: () => lineManager.ranked(),
    path: `${MT_PATH}/updates${tokenQuery()}`,
    createSocket: (url) => {
      const socket = new WebSocket(url);
      ws = socket;
      socket.onopen = () => {
        lastHeard = Date.now();
        store.connected({
          send: (frame) => {
            try {
              socket.send(JSON.stringify(frame));
            } catch {
              /* dropped while closing; the next connect resubscribes everything */
            }
          },
        });
      };
      socket.onmessage = (ev) => {
        lastHeard = Date.now();
        if (typeof ev.data !== "string") return;
        const frame = parseFrame(ev.data);
        if (frame) store.handle(frame);
      };
      return socket;
    },
    onClose: () => {
      store.disconnected();
    },
  });

  return {
    close: () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(ping);
      store.disconnected();
      connection.close();
      try {
        ws?.close();
      } catch {
        /* already gone */
      }
    },
  };
}

function tokenQuery(): string {
  const token = getNtAccessToken();
  return token ? `?token=${encodeURIComponent(token)}` : "";
}
