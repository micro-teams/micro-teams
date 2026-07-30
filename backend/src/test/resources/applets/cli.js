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
  microteams.command({
    name: "chats",
    short: "List the group chats you're in, most recently active first",
    flags: [
      { name: "limit", type: "int", help: "how many groups to list (default 20, max 100)" },
      {
        name: "page-start",
        type: "int",
        help: "list further down: the cursor printed by a previous call"
      },
      { name: "with-members", type: "bool", help: "also list each group's member names" },
      { name: "json", type: "bool", help: "output the raw JSON instead of text lines" }
    ],
    run: (ctx) => {
      var _a;
      let limit = ctx.flags["limit"] != null ? Number(ctx.flags["limit"]) : 20;
      if (!(limit > 0)) limit = 20;
      if (limit > 100) limit = 100;
      let path = `/chat?page_size=${limit}`;
      if (ctx.flags["page-start"] != null) path += `&page_start=${Number(ctx.flags["page-start"])}`;
      const resp = request({ method: "GET", path });
      if (ctx.flags["json"]) {
        microteams.print(JSON.stringify(resp));
        return;
      }
      const chats = (_a = resp.chats) != null ? _a : [];
      if (chats.length === 0) {
        microteams.print("(you are in no groups)");
        return;
      }
      const withMembers = ctx.flags["with-members"] === true;
      for (const c of chats) microteams.print(chatLine(c, withMembers));
      const page = resp.page;
      if (page.has_more && page.next_start != null) {
        microteams.print(
          `\u2014\u2014 more groups exist; list on with: microteams api chats --page-start ${page.next_start}`
        );
      }
    }
  });
  function chatLine(c, withMembers) {
    var _a, _b, _c, _d;
    const members = (_a = c.members) != null ? _a : [];
    const title = c.title || members.map((m) => m.nickname).join("\u3001") || `thread #${c.id}`;
    let line = `#${c.id} ${title} \xB7 ${members.length} members`;
    const last = c.lastMessage;
    if (last) {
      const nameById = {};
      for (const m of members) nameById[m.userId] = (_b = m.nickname) != null ? _b : `#${m.userId}`;
      const who = (_c = nameById[last.senderId]) != null ? _c : `#${last.senderId}`;
      line += ` \xB7 ${last.createdAt} ${who}\uFF1A${clip(String((_d = last.content) != null ? _d : ""), 60)}`;
    } else {
      line += " \xB7 (no messages yet)";
    }
    if (withMembers) line += `
    members: ${members.map((m) => m.nickname).join(", ")}`;
    return line;
  }
  function clip(text, max) {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? flat.slice(0, max) + "\u2026" : flat;
  }
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
      },
      // A heading-tree map of the document tree: per file, its markdown headings indented by level.
      // The whole tree is many files but its all-headings outline is tiny — so an agent can load this
      // cheap map first, then open only the one file/section it actually needs. Purely local: it scans
      // the git checkout with exec (find + read), no backend call. Headings inside fenced code blocks
      // (``` … ```) are skipped, so a `#` line in a code sample is never mistaken for a heading.
      {
        name: "outline",
        short: "Print a heading-tree map of the document tree (which file has which sections)",
        flags: [
          { name: "path", type: "string", help: "restrict the scan to this subdirectory of the tree" },
          { name: "depth", type: "int", help: "only include headings up to this level (1-6, default 6)" },
          {
            name: "grep",
            type: "string",
            help: "only headings containing this text (case-insensitive); files with no match are skipped"
          }
        ],
        run: (ctx) => {
          const top = microteams.exec("git", ["rev-parse", "--show-toplevel"]);
          if (top.code !== 0)
            throw new Error(
              "docs outline: not inside the document tree \u2014 run `microteams api docs sync` first.\n" + top.stderr
            );
          const root = top.stdout.trim();
          let maxDepth = ctx.flags["depth"] != null ? Number(ctx.flags["depth"]) : 6;
          if (!(maxDepth >= 1)) maxDepth = 6;
          if (maxDepth > 6) maxDepth = 6;
          const needle = ctx.flags["grep"] ? String(ctx.flags["grep"]).toLowerCase() : null;
          const scanDir = ctx.flags["path"] ? `${root}/${String(ctx.flags["path"])}` : root;
          const found = microteams.exec("find", [
            scanDir,
            "-type",
            "f",
            "-name",
            "*.md",
            "-not",
            "-path",
            "*/.git/*"
          ]);
          if (found.code !== 0) throw new Error("docs outline (find) failed: " + found.stderr);
          const files = found.stdout.split("\n").map((f) => f.trim()).filter((f) => f.length > 0).sort();
          if (files.length === 0) {
            microteams.print("(no markdown files)");
            return;
          }
          let scanned = 0;
          let headings = 0;
          for (const file of files) {
            const rel = file.indexOf(root + "/") === 0 ? file.slice(root.length + 1) : file;
            const content = microteams.exec("cat", [file]);
            if (content.code !== 0) throw new Error("docs outline (read) failed: " + content.stderr);
            const lines = [];
            let inFence = false;
            for (const line of content.stdout.split("\n")) {
              if (/^\s*(`{3,}|~{3,})/.test(line)) {
                inFence = !inFence;
                continue;
              }
              if (inFence) continue;
              const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
              if (!m) continue;
              const level = m[1].length;
              if (level > maxDepth) continue;
              if (needle && m[2].toLowerCase().indexOf(needle) < 0) continue;
              lines.push("  ".repeat(level - 1) + m[2]);
            }
            if (needle && lines.length === 0) continue;
            scanned++;
            headings += lines.length;
            microteams.print(rel);
            for (const h of lines) microteams.print(h);
          }
          microteams.print(
            `\u2014\u2014 ${scanned} file(s), ${headings} heading(s)` + (needle ? ` matching "${String(ctx.flags["grep"])}"` : "") + `; ${scanned + headings} line(s) printed`
          );
        }
      }
    ]
  });
})();
