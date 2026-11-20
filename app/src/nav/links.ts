/*
 * Addresses from outside the app — the links the CLI prints, a conversation's address pasted into
 * a browser — turned into the stack they mean. No React and no platform, so each is a test.
 *
 * navFromLink(path, query) → Nav | null — path is relative to where the app is served
 *   ("connect", "screen/abc", "chats/5"); null for anything not a link, which opens the app as
 *   usual. A link is a stack pushed on a section's root, so back from it lands on that root rather
 *   than outside the app:
 *     connect?code=…   → agents › approve device (the end of `microteams link auto-connect`)
 *     screen/<sid>     → chats › the live screen over it (the CLI's "watch" link)
 *     chats/<id>       → chats › that conversation
 *     __lines          → me › the lines panel, otherwise reached from the client block under
 *                        me › version: for whoever is diagnosing the network
 *
 * Example: navFromLink("chats/5", {}) — the chat list with conversation 5 open on it.
 */
import { frame, initialNav, push, switchSection, type Nav } from "./stack";

export function navFromLink(path: string, query: Record<string, string>): Nav | null {
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "connect") {
    return push(switchSection(initialNav(), "agents"), frame("connect", "detail", { code: query.code ?? "" }));
  }
  if (parts[0] === "screen" && parts[1]) return push(initialNav(), frame("screen", "overlay", { sessionId: parts[1] }));
  if (parts[0] === "chats" && /^\d+$/.test(parts[1] ?? "")) return push(initialNav(), frame("thread", "detail", { id: Number(parts[1]) }));
  if (parts[0] === "__lines") return push(switchSection(initialNav(), "me"), frame("lines", "detail"));
  return null;
}
