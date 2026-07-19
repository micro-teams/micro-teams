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
