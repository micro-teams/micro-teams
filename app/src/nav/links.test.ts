/*
 * The links the app is opened with, and the stacks they become.
 *
 * Run with `npm test`.
 */
import { navFromLink } from "./links";
import { stackOf } from "./stack";

const routes = (path: string, query: Record<string, string> = {}) => {
  const nav = navFromLink(path, query);
  return nav && { section: nav.section, stack: stackOf(nav).map((f) => [f.route, f.params]) };
};

test("the CLI's connect link opens approval on the agents root", () => {
  expect(routes("connect", { code: "AB12" })).toEqual({
    section: "agents",
    stack: [
      ["agents", { team: null }],
      ["connect", { code: "AB12" }],
    ],
  });
});

test("a screen link opens the live screen over the chat list", () => {
  expect(routes("screen/s%201")?.stack).toEqual([
    ["chats", {}],
    ["screen", { sessionId: "s 1" }],
  ]);
});

test("a conversation's address opens it", () => {
  expect(routes("chats/5")?.stack[1]).toEqual(["thread", { id: 5 }]);
});

test("anything else opens the app as usual", () => {
  expect(routes("")).toBeNull();
  expect(routes("chats/abc")).toBeNull();
  expect(routes("nowhere")).toBeNull();
});
