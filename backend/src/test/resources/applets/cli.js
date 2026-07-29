"use strict";
(() => {
  // src/runtime/index.ts
  function request(req) {
    const res = microteams.http(req);
    if (res.status >= 400) {
      const detail = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
      throw new Error(`${req.method} ${req.path} -> ${res.status}: ${detail}`);
    }
    return res.body;
  }

  // src/cli/index.ts
  microteams.command({
    name: "say",
    short: "Send a message into a group chat as yourself",
    flags: [
      { name: "thread-id", type: "int", required: true, help: "the group (thread) id to post into" },
      { name: "text", type: "string", required: true, help: "the message to send to the group" }
    ],
    run: (ctx) => {
      const threadId = Number(ctx.flags["thread-id"]);
      const body = { content: String(ctx.flags["text"]) };
      const msg = request({ method: "POST", path: `/chat/${threadId}/messages`, body });
      microteams.print(JSON.stringify(msg));
    }
  });
  microteams.command({
    name: "messages",
    short: "Read recent messages from a group chat you're in (page back with --before)",
    flags: [
      { name: "thread-id", type: "int", required: true, help: "the group (thread) id to read" },
      { name: "limit", type: "int", help: "how many messages to fetch (default 30, max 100)" },
      {
        name: "before",
        type: "int",
        help: "page further back: the 'older' cursor printed by a previous call"
      },
      {
        name: "json",
        type: "bool",
        help: "output the raw JSON (messages + page cursor) instead of text lines"
      }
    ],
    run: (ctx) => {
      var _a, _b, _c, _d;
      const threadId = Number(ctx.flags["thread-id"]);
      let limit = ctx.flags["limit"] != null ? Number(ctx.flags["limit"]) : 30;
      if (!(limit > 0)) limit = 30;
      if (limit > 100) limit = 100;
      let path = `/chat/${threadId}/messages?page_size=${limit}`;
      if (ctx.flags["before"] != null) path += `&page_start=${Number(ctx.flags["before"])}`;
      const resp = request({ method: "GET", path });
      if (ctx.flags["json"]) {
        microteams.print(JSON.stringify(resp));
        return;
      }
      const messages = (_a = resp.messages) != null ? _a : [];
      if (messages.length === 0) {
        microteams.print("(no messages)");
        return;
      }
      const detail = request({ method: "GET", path: `/chat/${threadId}` });
      const nameById = {};
      for (const m of (_b = detail.members) != null ? _b : []) nameById[m.userId] = (_c = m.nickname) != null ? _c : `#${m.userId}`;
      for (const m of messages) {
        const who = (_d = nameById[m.senderId]) != null ? _d : `#${m.senderId}`;
        microteams.print(`${m.createdAt} ${who}\uFF1A${m.content}`);
      }
      const page = resp.page;
      if (page.has_more && page.next_start != null) {
        microteams.print(
          `\u2014\u2014 older messages exist; page back with: microteams api messages --thread-id ${threadId} --before ${page.next_start}`
        );
      }
    }
  });
  function gitWorkspace() {
    return request({ method: "GET", path: "/agent/git-workspace" });
  }
  function authedGit(token, args) {
    return microteams.exec("git", ["-c", `http.extraHeader=Authorization: Bearer ${token}`, ...args]);
  }
  function insideRepo() {
    return microteams.exec("git", ["rev-parse", "--is-inside-work-tree"]).code === 0;
  }
  microteams.command({
    name: "docs",
    short: "Work with your team's shared document tree",
    commands: [
      {
        name: "sync",
        short: "Fetch the latest document tree and publish your recorded changes (pull + push)",
        run: () => {
          const ws = gitWorkspace();
          if (!insideRepo()) {
            const cloned = authedGit(ws.token, ["clone", ws.gitUrl, "."]);
            if (cloned.code !== 0) throw new Error("docs sync (clone) failed: " + cloned.stderr);
            microteams.print("cloned the document tree");
            return;
          }
          const pulled = authedGit(ws.token, ["pull", "--rebase"]);
          if (pulled.code !== 0)
            throw new Error(
              "docs sync: could not merge the latest changes. Resolve the conflict in the files, run `microteams api docs add`, then `microteams api docs sync` again.\n" + pulled.stderr
            );
          const pushed = authedGit(ws.token, ["push"]);
          if (pushed.code !== 0) throw new Error("docs sync (push) failed: " + pushed.stderr);
          microteams.print("synced");
        }
      },
      {
        name: "add",
        short: "Record your current file changes as one change (a commit)",
        flags: [{ name: "message", type: "string", help: "a short description of the change" }],
        run: (ctx) => {
          const staged = microteams.exec("git", ["add", "-A"]);
          if (staged.code !== 0) throw new Error("docs add failed: " + staged.stderr);
          if (microteams.exec("git", ["diff", "--cached", "--quiet"]).code === 0) {
            microteams.print("nothing to record");
            return;
          }
          const message = ctx.flags["message"] ? String(ctx.flags["message"]) : "update documents";
          const committed = microteams.exec("git", [
            "-c",
            "user.name=agent",
            "-c",
            "user.email=agent@microteams.local",
            "commit",
            "-m",
            message
          ]);
          if (committed.code !== 0) throw new Error("docs add (commit) failed: " + committed.stderr);
          microteams.print("recorded: " + message);
        }
      },
      {
        name: "status",
        short: "Show what you have changed but not yet recorded",
        run: () => {
          const r = microteams.exec("git", ["status", "--short", "--branch"]);
          microteams.print(r.stdout.trim() || "clean");
        }
      }
    ]
  });
})();
