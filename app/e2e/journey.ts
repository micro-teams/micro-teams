/*
 * The journey: one script of what a person does in the app, written once and driven on the web
 * and on Android by whichever Driver it is given.
 *
 * journey(driver, params) — signs up (reading the code from the mail sink), starts a chat, says
 *   something in it, sees it stored, sees a message posted from outside the app arrive without
 *   touching anything (the updates socket), renames the chat from its info page and comes back to
 *   find the conversation under the new name, finds a team made elsewhere in the agents section,
 *   and writes a document in that team's docs and finds its commit in the history.
 *   With a machine (params.machine), it then approves that machine for the team — through the
 *   approval page the CLI's link opens on the web; from outside on Android, where that link opens
 *   in a browser — waits for it to come online, opens an agent on it, says something to the agent
 *   and waits until the model on the machine has been given it (params.machine.heard), finds the
 *   same conversation a second time, watches the agent's live screen from the chat's
 *   roster (it draws, typing is a mode you choose, close puts it away), takes the agent out of the
 *   chat, renames it, sets its keepalive, and closes it.
 *   Then it opens a dialog and closes it with back, signs out, signs a second person up who finds
 *   nothing of the first person's — not in their lists, and on the web not at the conversation's
 *   own address either — and signs them out; on the web it then checks the service worker (it
 *   routes over the substrate, and the app opens offline).
 *   Returns how long each step took, in ms.
 * Driver — what a journey needs from a client: drivers/playwright.ts for the web build,
 *   drivers/webdriverio.ts for the Android build through Appium.
 * Params — the server to type in (null keeps the client's own), the stack as the machine running
 *   the journey reaches it, where the mail sink answers, a suffix that makes this run's names
 *   unique, and the machine waiting to be approved: its enrolment code, the driver to open the
 *   agent with (empty for the server's default), and heard(text), which resolves once the model on
 *   the machine has been given that text and rejects if it never is.
 * outside(api, username, password) → { post(title, text), createTeam(name) → id, chatTitled(title)
 *   → id, approve(code, teamIds), agentNamed(teamId, name) → userId, untilIdle(teamId, userId) } —
 *   signs in over HTTP and acts as another client of the same person would; the ids are what the
 *   app's testIDs carry, and untilIdle waits for the agent's program to have finished starting.
 * codeFromMail(mail, email) — the sign-up code cheese-auth mailed to that address.
 *
 * Example: await journey(new PlaywrightDriver("http://localhost/app/"), { server: null, api, mail, run, machine: null });
 *
 * Elements are found by testID, which react-native-web renders as data-testid and React Native on
 * Android as the view's resource-id: one name, both clients.
 */

export interface Driver {
  /** Start the client on its first screen. */
  open(): Promise<void>;
  /** Replace the text in the field with this testID. */
  fill(id: string, text: string): Promise<void>;
  tap(id: string): Promise<void>;
  /** The platform's back: the browser's button, or Android's. */
  back(): Promise<void>;
  /** Wait until the element with this testID is on screen. */
  waitFor(id: string, timeoutMs?: number): Promise<void>;
  /** Wait until some element shows exactly this text. */
  waitForText(text: string, timeoutMs?: number): Promise<void>;
  /** Wait until no element with this testID is on screen. */
  waitGone(id: string, timeoutMs?: number): Promise<void>;
  /** Whether some element on screen shows exactly this text, right now. */
  shows(text: string): Promise<boolean>;
  /** The web only: open the app at this address under where it is served ("chats/5"). */
  go?(path: string): Promise<void>;
  /** The web only: the service worker controls the page, routes over the substrate, and keeps the
   * app openable offline (showing shownId); resolves with what it says about itself. */
  checkWorker?(shownId: string): Promise<unknown>;
  /** What is on screen and what went wrong, for a failed run; also saves failure.png. */
  dump(): Promise<string>;
  close(): Promise<void>;
}

export interface Params {
  server: string | null;
  api: string;
  mail: string;
  run: string;
  machine: Machine | null;
}

export interface Machine {
  code: string;
  driver: string;
  heard(text: string): Promise<void>;
}

export async function codeFromMail(mail: string, email: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${mail}/messages?to=${encodeURIComponent(email)}`);
    for (const m of (await res.json()) as { body: string }[]) {
      const code = /code is:\s*(\d{4,8})/.exec(m.body)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no code was mailed to ${email} within 60s`);
}

export async function outside(api: string, username: string, password: string) {
  const login = await fetch(`${api}/api/users/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const send = async (path: string, body: unknown) => {
    const res = await fetch(`${api}/mt${path}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`POST ${path} from outside: HTTP ${res.status}`);
    return res.json() as Promise<{ id: number }>;
  };
  const get = async <T>(path: string) => {
    const res = await fetch(`${api}/mt${path}`, { headers: auth });
    if (!res.ok) throw new Error(`GET ${path} from outside: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  };
  const chatTitled = async (title: string) => {
    const { chats } = await get<{ chats: { id: number; title: string }[] }>("/chat?page_size=50");
    const chat = chats.find((c) => c.title === title);
    if (!chat) throw new Error(`no conversation titled "${title}"`);
    return chat.id;
  };
  return {
    post: async (title: string, text: string) => void (await send(`/chat/${await chatTitled(title)}/messages`, { content: text })),
    createTeam: async (name: string) => (await send("/team", { name })).id,
    chatTitled,
    approve: async (code: string, teamIds: number[]) => void (await send("/machine/enroll/approve", { code, teamIds })),
    agentNamed: async (teamId: number, name: string) => {
      const { agents } = await get<{ agents: { userId: number; nickname: string }[] }>(`/agent?teamId=${teamId}`);
      const agent = agents.find((a) => a.nickname === name);
      if (!agent) throw new Error(`no agent named "${name}" in team ${teamId}`);
      return agent.userId;
    },
    untilIdle: async (teamId: number, userId: number) => {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const { agents } = await get<{ agents: { userId: number; vars?: { status?: string } }[] }>(`/agent?teamId=${teamId}`);
        if (agents.find((a) => a.userId === userId)?.vars?.status === "idle") return;
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`agent ${userId}'s program did not finish starting within three minutes`);
    },
  };
}

async function signUp(d: Driver, p: Params, who: string) {
  const email = `e2e-${who}@example.com`;
  await d.tap("go-register");
  await d.fill("email", email);
  await d.tap("send-code");
  await d.fill("code", await codeFromMail(p.mail, email));
  const username = `e2e${who}`;
  const password = "Passw0rd!x";
  await d.fill("username", username);
  await d.fill("password", password);
  await d.fill("confirm", password);
  await d.tap("register");
  await d.waitFor("new-chat", 30_000);
  return { username, password };
}

async function signOut(d: Driver) {
  await d.tap("destination-me");
  await d.tap("sign-out");
  await d.tap("confirm-sign-out");
  await d.waitFor("go-register", 30_000);
}

export async function journey(d: Driver, p: Params): Promise<Record<string, number>> {
  const timings: Record<string, number> = {};
  let last = Date.now();
  const lap = (name: string) => {
    const now = Date.now();
    timings[name] = now - last;
    last = now;
    console.log(`  ${name}: ${timings[name]} ms`);
  };

  // Not ASCII on purpose: a transport that decodes text as Latin-1 shows this as mojibake.
  const said = `héllo ✓ ${p.run}`;
  const title = `group ${p.run}`;

  await d.open();
  if (p.server !== null) {
    await d.tap("settings");
    await d.fill("server", p.server);
    await d.tap("settings");
  }
  const { username, password } = await signUp(d, p, p.run);
  lap("sign up");

  await d.tap("new-chat");
  await d.fill("new-chat-title", title);
  await d.tap("new-chat-create");
  await d.waitFor("composer", 30_000);
  lap("new chat");

  await d.fill("composer", said);
  await d.tap("send");
  await d.waitForText(said, 30_000);
  await d.waitGone("pending-message", 30_000);
  lap("send");

  // Nothing polls: this appears only because the updates socket said the conversation moved.
  const fromOutside = `outsidé ✓ ${p.run}`;
  const elsewhere = await outside(p.api, username, password);
  await elsewhere.post(title, fromOutside);
  await d.waitForText(fromOutside, 15_000);
  lap("arrives live");

  const renamed = `renamed ${p.run}`;
  await d.tap("chat-info");
  await d.tap("rename-chat");
  await d.fill("rename", renamed);
  await d.tap("rename-ok");
  await d.waitForText(renamed, 15_000);
  await d.back();
  await d.waitFor("composer");
  await d.waitForText(renamed, 15_000);
  const chatId = await elsewhere.chatTitled(renamed);
  lap("rename from info");

  // A team made elsewhere is the one the agents section looks at: the only one there is.
  const team = `team ${p.run}`;
  const teamId = await elsewhere.createTeam(team);
  await d.back();
  await d.tap("destination-agents");
  await d.waitForText(team, 15_000);
  await d.waitForText("no agents running", 15_000);
  lap("agents of a team");

  const heading = `plän ✓ ${p.run}`;
  await d.tap("destination-docs");
  await d.tap("doc-root-menu");
  await d.tap("doc-action-file");
  await d.fill("doc-name", "plan.md");
  await d.tap("doc-name-ok");
  await d.waitFor("doc-view", 15_000);
  await d.tap("doc-edit");
  await d.fill("doc-editor", `# ${heading}`);
  await d.tap("doc-save");
  await d.waitForText(heading, 15_000);
  await d.tap("doc-history");
  await d.waitForText("history · plan.md");
  await d.back();
  await d.waitFor("doc-view");
  await d.back();
  await d.waitFor("doc-plan.md");
  lap("write a document");

  if (p.machine) await withAMachine(d, p.machine, { run: p.run, teamId, elsewhere, lap });

  // Back closes the dialog, not the page under it.
  await d.tap("destination-me");
  await d.tap("sign-out");
  await d.waitFor("dialog");
  await d.back();
  await d.waitGone("dialog");
  await d.waitFor("sign-out");
  await d.tap("sign-out");
  await d.tap("confirm-sign-out");
  await d.waitFor("go-register", 30_000);
  lap("dialog and sign out");

  // Somebody else, sent where the first person has just been: the rules about other people never
  // show up while there is only one person in the run.
  await signUp(d, p, `${p.run}b`);
  if (await d.shows(renamed)) throw new Error("a stranger's chat list shows somebody else's conversation");
  if (d.go) {
    await d.go(`chats/${chatId}`);
    await new Promise((r) => setTimeout(r, 3000));
    if ((await d.shows(said)) || (await d.shows(fromOutside))) throw new Error(`a stranger read somebody else's conversation at chats/${chatId}`);
    await d.go("");
  }
  await signOut(d);
  lap("a stranger is given nothing");

  if (d.checkWorker) {
    console.log(`  worker: ${JSON.stringify(await d.checkWorker("go-register"))}`);
    lap("worker, and offline");
  }

  await d.close();
  return timings;
}

/** The part of the journey that needs a real machine: approve it, and put an agent on it. */
async function withAMachine(
  d: Driver,
  machine: Machine,
  { run, teamId, elsewhere, lap }: { run: string; teamId: number; elsewhere: Awaited<ReturnType<typeof outside>>; lap: (step: string) => void },
) {
  if (d.go) {
    // `microteams link auto-connect` prints a link for a person to open; opening it is this.
    await d.go(`connect?code=${machine.code}`);
    await d.tap(`connect-team-${teamId}`);
    await d.tap("connect-approve");
    await d.waitForText("machine approved", 15_000);
    await d.tap("connect-done");
  } else {
    await elsewhere.approve(machine.code, [teamId]);
    await d.tap("destination-agents");
  }
  // Enrolled is not connected: the connector polls for its token and dials in, on another host.
  await d.waitForText("e2e-machine", 120_000);
  await d.waitForText("online", 120_000);
  lap("a machine, approved and online");

  const name = `agent${run}`;
  await d.tap("open-agent");
  await d.fill("open-name", name);
  if (machine.driver) {
    await d.tap("driver");
    await d.tap(`driver-${machine.driver}`);
  }
  await d.tap("open-agent-ok");
  await d.waitForText(name, 120_000);
  const agentId = await elsewhere.agentNamed(teamId, name);
  lap("an agent on it");

  const marker = `e2e-marker-${run}`;
  // Opening an agent opens its page. Its program is given a minute to finish starting: a message
  // that arrives while it is still starting is typed into it but not always submitted.
  // Waited for by its name at the top: the chat button may be below the fold, or under the
  // keyboard still up from the dialog, until tapping it scrolls it into view.
  await d.waitFor("agent-rename", 15_000);
  await elsewhere.untilIdle(teamId, agentId);
  await d.tap("agent-chat");
  await d.waitFor("composer", 30_000);
  await d.fill("composer", marker);
  await d.tap("send");
  await d.waitForText(marker, 30_000);
  await d.waitGone("pending-message", 30_000);
  // The whole way, app to program: before anything below takes the keyboard or the agent away.
  await machine.heard(marker);
  // Asking for the conversation again gives back the same one, with what was said in it.
  await d.back();
  await d.tap("agent-chat");
  await d.waitForText(marker, 15_000);
  lap("chat with the agent, twice");

  await d.tap("chat-info");
  await d.tap(`agent-avatar-${agentId}`);
  await d.waitFor("screen", 15_000);
  // What the machine prints has arrived and is drawn: a live screen, not an empty rectangle.
  await d.waitGone("screen-connecting", 60_000);
  await d.tap("screen-typing");
  await d.waitForText("the agent is not driving");
  await d.tap("screen-watching");
  await d.tap("screen-close");
  await d.waitGone("screen");
  lap("its live screen");

  await d.tap(`remove-${agentId}`);
  await d.tap("confirm");
  await d.waitGone(`member-${agentId}`, 15_000);
  lap("out of the conversation");

  // Back, one page at a time, to the agent's page the conversation was opened from.
  await d.back();
  await d.waitFor("composer");
  await d.back();
  await d.waitFor("agent-rename");

  const renamed = `agent${run}x`;
  await d.tap("agent-rename");
  await d.fill("agent-name", renamed);
  await d.tap("agent-name-ok");
  await d.waitForText(renamed, 15_000);
  await d.fill("keepalive-minutes", "7");
  await d.tap("keepalive-apply");
  await d.waitForText("a nudge every 7 min while it is idle", 15_000);
  await d.tap("agent-close");
  await d.tap("confirm");
  await d.waitGone(`agent-${agentId}`, 30_000);
  lap("renamed, kept warm, closed");
}
