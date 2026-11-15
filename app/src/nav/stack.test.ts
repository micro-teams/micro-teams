/*
 * The display stack's rules, each as the situation a person would be in.
 *
 * Run with `npm test`. Every case starts from initialNav() and uses only the exported operations,
 * so a test failing here means back would land somewhere a person did not come from.
 */
import { dropTeam, frame, initialNav, pop, popTo, push, select, stackOf, switchSection, switchTeam, top } from "./stack";

const routes = (nav: ReturnType<typeof initialNav>) => stackOf(nav).map((f) => f.route);

test("back closes a dialog, not the page under it", () => {
  let nav = push(initialNav(), frame("thread", "detail", { id: 5 }));
  nav = push(nav, frame("dialog", "overlay"));
  nav = pop(nav)!;
  expect(routes(nav)).toEqual(["chats", "thread"]);
});

test("back at a section's root has nothing to pop", () => {
  expect(pop(initialNav())).toBeNull();
});

test("something opened from another section comes back to where it was opened", () => {
  let nav = switchSection(initialNav(), "agents");
  nav = switchTeam(nav, 1);
  nav = push(nav, frame("agent", "detail", { id: 7 }));
  nav = push(nav, frame("thread", "detail", { id: 9 }));
  nav = pop(nav)!;
  expect(top(nav).route).toBe("agent");
  expect(nav.section).toBe("agents");
});

test("each section keeps its own place", () => {
  let nav = push(initialNav(), frame("thread", "detail", { id: 5 }));
  nav = switchSection(nav, "docs");
  nav = switchSection(nav, "chats");
  expect(routes(nav)).toEqual(["chats", "thread"]);
});

test("tapping the section you are in returns to its root", () => {
  let nav = push(initialNav(), frame("thread", "detail", { id: 5 }));
  nav = switchSection(nav, "chats");
  expect(routes(nav)).toEqual(["chats"]);
});

test("each team keeps its own stack in a team-scoped section", () => {
  let nav = switchTeam(switchSection(initialNav(), "docs"), 1);
  nav = push(nav, frame("file", "detail", { team: 1, path: "a.md" }));
  nav = switchTeam(nav, 2);
  expect(routes(nav)).toEqual(["docs"]);
  nav = switchTeam(nav, 1);
  expect(top(nav).params).toEqual({ team: 1, path: "a.md" });
});

test("a team that is gone takes its stacks with it", () => {
  let nav = switchTeam(switchSection(initialNav(), "docs"), 1);
  nav = push(nav, frame("file", "detail", { team: 1, path: "a.md" }));
  nav = dropTeam(nav, 1);
  expect(nav.team).toBeNull();
  expect(routes(switchTeam(nav, 1))).toEqual(["docs"]);
});

test("picking beside the list replaces the detail and adds nothing back would have to close", () => {
  let nav = select(initialNav(), frame("thread", "detail", { id: 5 }));
  nav = select(nav, frame("thread", "detail", { id: 6 }));
  expect(stackOf(nav).map((f) => f.params.id ?? null)).toEqual([null, 6]);
});

test("popTo closes a frame and everything above it", () => {
  let nav = push(initialNav(), frame("thread", "detail", { id: 5 }));
  const info = frame("info", "detail", { id: 5 });
  nav = push(nav, info);
  nav = push(nav, frame("dialog", "overlay"));
  nav = popTo(nav, info.key);
  expect(routes(nav)).toEqual(["chats", "thread"]);
});
