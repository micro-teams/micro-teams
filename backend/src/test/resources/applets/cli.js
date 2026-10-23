"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/api/ops.ts
  var OPS = {
    addTeamMember: { method: "POST", path: "/team/{id}/members", pathParams: ["id"], queryParams: [], bodyKey: "AddTeamMemberRequest", bodyType: "application/json" },
    addThreadMember: { method: "POST", path: "/chat/{id}/members", pathParams: ["id"], queryParams: [], bodyKey: "AddMemberRequest", bodyType: "application/json" },
    approveEnrollment: { method: "POST", path: "/machine/enroll/approve", pathParams: [], queryParams: [], bodyKey: "ApproveEnrollmentRequest", bodyType: "application/json" },
    bindTeamMachine: { method: "POST", path: "/team/{id}/machine", pathParams: ["id"], queryParams: [], bodyKey: "BindMachineRequest", bodyType: "application/json" },
    changeMemberRole: { method: "PATCH", path: "/team/{id}/members/{userId}", pathParams: ["id", "userId"], queryParams: [], bodyKey: "ChangeRoleRequest", bodyType: "application/json" },
    changeThreadMemberRole: { method: "PATCH", path: "/chat/{id}/members/{userId}", pathParams: ["id", "userId"], queryParams: [], bodyKey: "ChangeRoleRequest", bodyType: "application/json" },
    closeAgent: { method: "DELETE", path: "/agent/{userId}", pathParams: ["userId"], queryParams: [], bodyKey: null, bodyType: null },
    createTeam: { method: "POST", path: "/team", pathParams: [], queryParams: [], bodyKey: "CreateTeamRequest", bodyType: "application/json" },
    createThread: { method: "POST", path: "/chat", pathParams: [], queryParams: [], bodyKey: "CreateThreadRequest", bodyType: "application/json" },
    deleteDocument: { method: "DELETE", path: "/team/{id}/document", pathParams: ["id"], queryParams: ["path"], bodyKey: null, bodyType: null },
    deleteTeam: { method: "DELETE", path: "/team/{id}", pathParams: ["id"], queryParams: [], bodyKey: null, bodyType: null },
    dissolveThread: { method: "DELETE", path: "/chat/{id}", pathParams: ["id"], queryParams: [], bodyKey: null, bodyType: null },
    exchangeAgentToken: { method: "POST", path: "/agent/token", pathParams: [], queryParams: [], bodyKey: null, bodyType: null },
    forgetMachine: { method: "DELETE", path: "/machine/{id}", pathParams: ["id"], queryParams: [], bodyKey: null, bodyType: null },
    getDocument: { method: "GET", path: "/team/{id}/document", pathParams: ["id"], queryParams: ["path", "recursive", "content", "history", "diff"], bodyKey: null, bodyType: null },
    getGitWorkspace: { method: "GET", path: "/agent/git-workspace", pathParams: [], queryParams: [], bodyKey: null, bodyType: null },
    getMachine: { method: "GET", path: "/machine/{id}", pathParams: ["id"], queryParams: [], bodyKey: null, bodyType: null },
    getTeam: { method: "GET", path: "/team/{id}", pathParams: ["id"], queryParams: [], bodyKey: null, bodyType: null },
    getThread: { method: "GET", path: "/chat/{id}", pathParams: ["id"], queryParams: [], bodyKey: null, bodyType: null },
    listAgentDrivers: { method: "GET", path: "/agent/drivers", pathParams: [], queryParams: [], bodyKey: null, bodyType: null },
    listAgents: { method: "GET", path: "/agent", pathParams: [], queryParams: ["userId", "threadId", "teamId", "machineId", "online", "page_start", "page_size"], bodyKey: null, bodyType: null },
    listChats: { method: "GET", path: "/chat", pathParams: [], queryParams: ["page_start", "page_size", "queryIsMemberAgent"], bodyKey: null, bodyType: null },
    listLines: { method: "GET", path: "/lines", pathParams: [], queryParams: [], bodyKey: null, bodyType: null },
    listMachines: { method: "GET", path: "/machine", pathParams: [], queryParams: ["teamId", "online", "page_start", "page_size"], bodyKey: null, bodyType: null },
    listMessages: { method: "GET", path: "/chat/{id}/messages", pathParams: ["id"], queryParams: ["page_start", "page_size"], bodyKey: null, bodyType: null },
    listTeamMembers: { method: "GET", path: "/team/{id}/members", pathParams: ["id"], queryParams: [], bodyKey: null, bodyType: null },
    listTeams: { method: "GET", path: "/team", pathParams: [], queryParams: ["role", "page_start", "page_size"], bodyKey: null, bodyType: null },
    listThreadMembers: { method: "GET", path: "/chat/{id}/members", pathParams: ["id"], queryParams: [], bodyKey: null, bodyType: null },
    moveDocument: { method: "PATCH", path: "/team/{id}/document", pathParams: ["id"], queryParams: ["path"], bodyKey: "MoveDocumentRequest", bodyType: "application/json" },
    openAgent: { method: "POST", path: "/agent", pathParams: [], queryParams: [], bodyKey: "OpenAgentRequest", bodyType: "application/json" },
    ping: { method: "GET", path: "/ping", pathParams: [], queryParams: [], bodyKey: null, bodyType: null },
    pollEnrollment: { method: "POST", path: "/machine/enroll/poll", pathParams: [], queryParams: [], bodyKey: "PollEnrollmentRequest", bodyType: "application/json" },
    postMessage: { method: "POST", path: "/chat/{id}/messages", pathParams: ["id"], queryParams: [], bodyKey: "PostMessageRequest", bodyType: "application/json" },
    probe: { method: "GET", path: "/probe", pathParams: [], queryParams: [], bodyKey: null, bodyType: null },
    rebootAgent: { method: "POST", path: "/agent/{userId}/reboot", pathParams: ["userId"], queryParams: [], bodyKey: null, bodyType: null },
    removeTeamMember: { method: "DELETE", path: "/team/{id}/members/{userId}", pathParams: ["id", "userId"], queryParams: [], bodyKey: null, bodyType: null },
    removeThreadMember: { method: "DELETE", path: "/chat/{id}/members/{userId}", pathParams: ["id", "userId"], queryParams: [], bodyKey: null, bodyType: null },
    renameMachine: { method: "PATCH", path: "/machine/{id}", pathParams: ["id"], queryParams: [], bodyKey: "RenameMachineRequest", bodyType: "application/json" },
    renameTeam: { method: "PATCH", path: "/team/{id}", pathParams: ["id"], queryParams: [], bodyKey: "RenameTeamRequest", bodyType: "application/json" },
    renameThread: { method: "PATCH", path: "/chat/{id}", pathParams: ["id"], queryParams: [], bodyKey: "RenameThreadRequest", bodyType: "application/json" },
    setAgentAvatar: { method: "PUT", path: "/agent/{userId}/avatar", pathParams: ["userId"], queryParams: [], bodyKey: "SetAgentAvatarRequest", bodyType: "application/json" },
    setAgentKeepalive: { method: "PUT", path: "/agent/{userId}/keepalive", pathParams: ["userId"], queryParams: [], bodyKey: "SetAgentKeepaliveRequest", bodyType: "application/json" },
    setAgentLlm: { method: "PUT", path: "/agent/{userId}/llm", pathParams: ["userId"], queryParams: [], bodyKey: "AgentLlmSettings", bodyType: "application/json" },
    setAgentNickname: { method: "PUT", path: "/agent/{userId}/nickname", pathParams: ["userId"], queryParams: [], bodyKey: "SetAgentNicknameRequest", bodyType: "application/json" },
    startEnrollment: { method: "POST", path: "/machine/enroll/start", pathParams: [], queryParams: [], bodyKey: "StartEnrollmentRequest", bodyType: "application/json" },
    unbindTeamMachine: { method: "DELETE", path: "/team/{id}/machine/{machineId}", pathParams: ["id", "machineId"], queryParams: [], bodyKey: null, bodyType: null },
    writeDocument: { method: "PUT", path: "/team/{id}/document", pathParams: ["id"], queryParams: ["path"], bodyKey: "body", bodyType: "text/plain" }
  };

  // src/runtime/index.ts
  function request(req) {
    const res = microteams.http(req);
    if (res.status >= 400) {
      const detail = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
      throw new Error(`${req.method} ${req.path} -> ${res.status}: ${detail}`);
    }
    return res.body;
  }
  function call(op, params) {
    const spec = OPS[op];
    const p = params;
    const path = spec.path.replace(/\{(\w+)\}/g, (_, name) => {
      const v = p[name];
      if (v == null) throw new Error(`${op}: missing path parameter ${name}`);
      return encodeURIComponent(String(v));
    });
    const query = {};
    for (const name of spec.queryParams) {
      const v = p[name];
      if (v != null) query[name] = v;
    }
    if (spec.bodyType != null && spec.bodyType !== "application/json") {
      throw new Error(`${op}: the CLI host can only send JSON bodies, not ${spec.bodyType}`);
    }
    const body = spec.bodyKey != null ? p[spec.bodyKey] : void 0;
    return request({ method: spec.method, path, query, body });
  }

  // src/cli/util.ts
  var JSON_FLAG = { name: "json", type: "bool", help: "output the raw JSON instead of text lines" };
  function str(ctx, name) {
    const v = ctx.flags[name];
    return v == null ? void 0 : String(v);
  }
  function int(ctx, name) {
    const v = ctx.flags[name];
    return v == null ? void 0 : Number(v);
  }
  function need(ctx, name) {
    const v = ctx.flags[name];
    if (v == null) throw new Error(`--${name} is required`);
    return String(v);
  }
  function wantsJson(ctx) {
    return ctx.flags["json"] === true;
  }
  function limit(ctx, fallback, max = 100) {
    var _a;
    let n = (_a = int(ctx, "limit")) != null ? _a : fallback;
    if (!(n > 0)) n = fallback;
    return n > max ? max : n;
  }
  function moreHint(page, next, what) {
    if (page && page.has_more && page.next_start != null)
      microteams.print(`\u2014\u2014 more ${what} exist; continue with: ${next(String(page.next_start))}`);
  }
  function done(what) {
    microteams.print(what);
  }
  var ROLES = ["OWNER", "ADMIN", "MEMBER"];
  function role(value) {
    const r = value.toUpperCase();
    if (ROLES.indexOf(r) < 0) throw new Error(`role must be one of ${ROLES.join(", ")}`);
    return r;
  }
  function teamId(ref) {
    var _a;
    if (/^\d+$/.test(ref)) return Number(ref);
    const teams = (_a = call("listTeams", { page_size: 100 }).teams) != null ? _a : [];
    const hits = teams.filter((t) => {
      var _a2;
      return ((_a2 = t.name) != null ? _a2 : "").toLowerCase() === ref.toLowerCase();
    });
    if (hits.length === 1) return hits[0].id;
    if (hits.length === 0) throw new Error(`no team of yours is called "${ref}" (see: microteams api team list)`);
    throw new Error(`"${ref}" names ${hits.length} teams: ${hits.map((t) => "#" + t.id).join(", ")} \u2014 pass the id`);
  }
  function machineId(ref) {
    var _a;
    const machines = (_a = call("listMachines", { page_size: 100 }).machines) != null ? _a : [];
    if (machines.some((m) => m.id === ref)) return ref;
    const hits = machines.filter((m) => {
      var _a2;
      return ((_a2 = m.name) != null ? _a2 : "").toLowerCase() === ref.toLowerCase();
    });
    if (hits.length === 1) return hits[0].id;
    if (hits.length === 0) throw new Error(`no machine you can see is called "${ref}" (see: microteams api machine list)`);
    throw new Error(`"${ref}" names ${hits.length} machines: ${hits.map((m) => m.id).join(", ")} \u2014 pass the id`);
  }
  function clip(text, max) {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? flat.slice(0, max) + "\u2026" : flat;
  }
  function ends(text, head, tail) {
    const flat = text.replace(/\s+/g, " ").trim();
    const shown = flat.length <= head + tail + 1 ? flat : `${flat.slice(0, head)} \u2026 ${flat.slice(flat.length - tail)}`;
    return `\u201C${shown}\u201D (${text.length} chars)`;
  }

  // src/cli/say.ts
  microteams.command({
    name: "say",
    short: "Send a message into a group chat as yourself",
    flags: [
      { name: "thread-id", type: "int", required: true, help: "the group (thread) id to post into" },
      { name: "text", type: "string", required: true, help: "the message to send to the group" }
    ],
    run: (ctx) => {
      const threadId = Number(ctx.flags["thread-id"]);
      const text = String(ctx.flags["text"]);
      const msg = call("postMessage", { id: threadId, PostMessageRequest: { content: text } });
      microteams.print(JSON.stringify(msg));
      const stored = readBack(threadId, msg.id);
      if (stored == null) {
        microteams.print(`Sent to thread ${threadId} (could not read it back to quote it).`);
      } else {
        microteams.print(`Sent to thread ${threadId}, stored as: ${ends(stored, 60, 60)}`);
        if (stored !== text) {
          microteams.print(
            `WARNING: what the server stored is not what was sent \u2014 ${text.length} characters went out, ${stored.length} came back. The message above is what other people will read. Check for a quoting or escaping problem in how --text was passed.`
          );
        }
      }
      const hint = markdownHint(text);
      if (hint) microteams.print(hint);
    }
  });
  function markdownHint(text) {
    const found = [];
    const seen = (what) => {
      if (found.indexOf(what) < 0) found.push(what);
    };
    if (/```/.test(text) || /`[^`\n]+`/.test(text)) seen("code marked with backticks");
    if (/\*\*[^*\n]+\*\*/.test(text)) seen("**bold**");
    if (/__[^_\n]+__/.test(text)) seen("__bold__");
    if (/\[[^\]\n]+\]\([^)\n]+\)/.test(text)) seen("a [link](url)");
    for (const line of text.split("\n")) {
      if (/^\s{0,3}#{1,6}\s+\S/.test(line)) seen("a # heading");
      if (/^\s{0,3}[-*+]\s+\S/.test(line)) seen("a -/* bullet list");
      if (/^\s{0,3}>\s+\S/.test(line)) seen("a > quote");
      if (/^\s{0,3}\|?\s*:?-{3,}:?\s*\|/.test(line)) seen("a | table |");
    }
    if (found.length === 0) return null;
    return "Note: your message used " + found.join(", ") + '. The chat renders no markdown, so those marks are shown literally to the reader \u2014 write plain text next time: plain sentences, and if you must enumerate, one item per line with no leading marker (or "1)" style, which reads as itself).';
  }
  function readBack(threadId, id) {
    var _a, _b;
    try {
      const page = call("listMessages", { id: threadId, page_start: id, page_size: 1 });
      const found = (_a = page.messages) == null ? void 0 : _a[0];
      if (!found || found.id !== id) return null;
      return String((_b = found.content) != null ? _b : "");
    } catch (e) {
      return null;
    }
  }

  // src/cli/chat.ts
  var THREAD = { name: "thread-id", type: "int", required: true, help: "the group (thread) id" };
  var USER = { name: "user-id", type: "int", required: true, help: "the member's user id" };
  var messages = {
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
      const resp = call("listMessages", {
        id: threadId,
        page_size: limit(ctx, 30),
        page_start: int(ctx, "before")
      });
      if (wantsJson(ctx)) {
        microteams.print(JSON.stringify(resp));
        return;
      }
      const messages2 = (_a = resp.messages) != null ? _a : [];
      if (messages2.length === 0) {
        microteams.print("(no messages)");
        return;
      }
      const detail = call("getThread", { id: threadId });
      const nameById = {};
      for (const m of (_b = detail.members) != null ? _b : []) nameById[m.userId] = (_c = m.nickname) != null ? _c : `#${m.userId}`;
      for (const m of messages2) {
        const who = (_d = nameById[m.senderId]) != null ? _d : `#${m.senderId}`;
        microteams.print(`${m.createdAt} ${who}\uFF1A${m.content}`);
      }
      const page = resp.page;
      if (page.has_more && page.next_start != null) {
        microteams.print(
          `\u2014\u2014 older messages exist; page back with: microteams api chat messages --thread-id ${threadId} --before ${page.next_start}`
        );
      }
    }
  };
  var list = {
    name: "list",
    short: "List the group chats you're in, most recently active first",
    flags: [
      {
        name: "thread-id",
        type: "int",
        help: "deprecated: use `chat show --thread-id N`"
      },
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
      if (ctx.flags["thread-id"] != null) {
        chatDetail(Number(ctx.flags["thread-id"]), wantsJson(ctx));
        return;
      }
      const resp = call("listChats", { page_size: limit(ctx, 20), page_start: int(ctx, "page-start") });
      if (wantsJson(ctx)) {
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
      moreHint(resp.page, (n) => `microteams api chat list --page-start ${n}`, "groups");
    }
  };
  function chatDetail(threadId, asJson) {
    var _a, _b, _c, _d, _e, _f;
    const detail = call("getThread", { id: threadId });
    if (asJson) {
      microteams.print(JSON.stringify(detail));
      return;
    }
    const thread = detail.thread;
    const members3 = (_a = detail.members) != null ? _a : [];
    const title = (thread == null ? void 0 : thread.title) || members3.map((m) => m.nickname).join("\u3001") || `thread #${threadId}`;
    microteams.print(`#${threadId} ${title}`);
    if (thread == null ? void 0 : thread.createdAt) microteams.print(`created ${thread.createdAt}`);
    const latest = (_b = call("listMessages", { id: threadId, page_size: 1 }).messages) == null ? void 0 : _b[0];
    if (latest) {
      const nameById = {};
      for (const m of members3) nameById[m.userId] = (_c = m.nickname) != null ? _c : `#${m.userId}`;
      const who = (_d = nameById[latest.senderId]) != null ? _d : `#${latest.senderId}`;
      microteams.print(`last message ${latest.createdAt} ${who}\uFF1A${clip(String((_e = latest.content) != null ? _e : ""), 60)}`);
    } else {
      microteams.print("no messages yet");
    }
    microteams.print(`${members3.length} member(s):`);
    for (const m of members3) {
      const name = (_f = m.nickname) != null ? _f : `#${m.userId}`;
      const role2 = m.role && m.role !== "MEMBER" ? ` ${m.role}` : "";
      microteams.print(`  ${name} (#${m.userId})${role2}`);
    }
  }
  function chatLine(c, withMembers) {
    var _a, _b, _c, _d;
    const members3 = (_a = c.members) != null ? _a : [];
    const title = c.title || members3.map((m) => m.nickname).join("\u3001") || `thread #${c.id}`;
    let line = `#${c.id} ${title} \xB7 ${members3.length} members`;
    const last = c.lastMessage;
    if (last) {
      const nameById = {};
      for (const m of members3) nameById[m.userId] = (_b = m.nickname) != null ? _b : `#${m.userId}`;
      const who = (_c = nameById[last.senderId]) != null ? _c : `#${last.senderId}`;
      line += ` \xB7 ${last.createdAt} ${who}\uFF1A${clip(String((_d = last.content) != null ? _d : ""), 60)}`;
    } else {
      line += " \xB7 (no messages yet)";
    }
    if (withMembers) line += `
    members: ${members3.map((m) => m.nickname).join(", ")}`;
    return line;
  }
  var show = {
    name: "show",
    short: "One group in detail: its title, last message, and every member with their role",
    flags: [THREAD, JSON_FLAG],
    run: (ctx) => chatDetail(Number(need(ctx, "thread-id")), wantsJson(ctx))
  };
  var create = {
    name: "create",
    short: "Start a new group chat (you become its owner)",
    flags: [
      { name: "title", type: "string", required: true, help: "the group's title" },
      { name: "members", type: "string", help: "comma-separated user ids to add besides yourself" },
      JSON_FLAG
    ],
    run: (ctx) => {
      var _a;
      const ids = (ctx.flags["members"] ? String(ctx.flags["members"]) : "").split(",").map((s) => s.trim()).filter((s) => s.length > 0).map(Number);
      const t = call("createThread", { CreateThreadRequest: { title: need(ctx, "title"), memberIds: ids } });
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(t));
      done(`created group #${t.id} ${(_a = t.title) != null ? _a : ""}`);
    }
  };
  var rename = {
    name: "rename",
    short: "Rename a group",
    flags: [THREAD, { name: "title", type: "string", required: true, help: "the new title" }],
    run: (ctx) => {
      var _a;
      const t = call("renameThread", { id: Number(need(ctx, "thread-id")), RenameThreadRequest: { title: need(ctx, "title") } });
      done(`group #${t.id} is now called ${(_a = t.title) != null ? _a : ""}`);
    }
  };
  var dissolve = {
    name: "dissolve",
    short: "Dissolve a group for everyone (owner only); there is no undo",
    flags: [THREAD],
    run: (ctx) => {
      const id = Number(need(ctx, "thread-id"));
      call("dissolveThread", { id });
      done(`dissolved group #${id}`);
    }
  };
  var members = {
    name: "members",
    short: "List a group's members with their roles",
    flags: [THREAD, JSON_FLAG],
    run: (ctx) => {
      var _a;
      const ms = call("listThreadMembers", { id: Number(need(ctx, "thread-id")) });
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(ms));
      for (const m of ms) microteams.print(`#${m.userId} ${(_a = m.nickname) != null ? _a : ""} ${m.role}`);
    }
  };
  var addMember = {
    name: "add-member",
    short: "Add someone to a group",
    flags: [THREAD, USER, { name: "role", type: "string", help: "OWNER, ADMIN or MEMBER (default MEMBER)" }],
    run: (ctx) => {
      var _a;
      const id = Number(need(ctx, "thread-id"));
      const userId = Number(need(ctx, "user-id"));
      call("addThreadMember", { id, AddMemberRequest: { userId, role: role(String((_a = ctx.flags["role"]) != null ? _a : "MEMBER")) } });
      done(`added #${userId} to group #${id}`);
    }
  };
  var removeMember = {
    name: "remove-member",
    short: "Remove someone from a group (your own id: leave it)",
    flags: [THREAD, USER],
    run: (ctx) => {
      const id = Number(need(ctx, "thread-id"));
      const userId = Number(need(ctx, "user-id"));
      call("removeThreadMember", { id, userId });
      done(`removed #${userId} from group #${id}`);
    }
  };
  var setRole = {
    name: "set-role",
    short: "Change a member's role in a group",
    flags: [THREAD, USER, { name: "role", type: "string", required: true, help: "OWNER, ADMIN or MEMBER" }],
    run: (ctx) => {
      const id = Number(need(ctx, "thread-id"));
      const userId = Number(need(ctx, "user-id"));
      const r = role(need(ctx, "role"));
      call("changeThreadMemberRole", { id, userId, ChangeRoleRequest: { role: r } });
      done(`#${userId} is now ${r} in group #${id}`);
    }
  };
  microteams.command({
    name: "chat",
    short: "Group chats: list, read, create, rename, dissolve, and manage members",
    commands: [list, show, messages, create, rename, dissolve, members, addMember, removeMember, setRole]
  });
  function deprecated(spec, old, now) {
    var _a;
    return __spreadProps(__spreadValues({}, spec), {
      name: old,
      short: `(deprecated: use \`${now}\`) ${(_a = spec.short) != null ? _a : ""}`,
      run: (ctx) => {
        spec.run(ctx);
        microteams.print(`(note: \`microteams api ${old}\` is now \`microteams api ${now}\`; the old name goes away next release)`);
      }
    });
  }
  microteams.command(deprecated(list, "chats", "chat list"));
  microteams.command(deprecated(messages, "messages", "chat messages"));

  // src/cli/docs.ts
  function gitWorkspace() {
    return call("getGitWorkspace", {});
  }
  var GIT_IDENTITY = ["-c", "user.name=agent", "-c", "user.email=agent@microteams.local"];
  function authedGit(token, args) {
    return microteams.exec("git", ["-c", `http.extraHeader=Authorization: Bearer ${token}`, ...args]);
  }
  function insideRepo() {
    return microteams.exec("git", ["rev-parse", "--is-inside-work-tree"]).code === 0;
  }
  var gitCommands = {
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
          const pulled = authedGit(ws.token, [...GIT_IDENTITY, "pull", "--rebase"]);
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
          const committed = microteams.exec("git", [...GIT_IDENTITY, "commit", "-m", message]);
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
  };
  function readTeam(ctx) {
    const t = str(ctx, "team");
    return t != null ? teamId(t) : gitWorkspace().teamId;
  }
  var TEAM = { name: "team", type: "string", help: "a team id or name (default: your own team)" };
  var PATH = { name: "path", type: "string", help: "a path in the tree (default: the root)" };
  var log = {
    name: "log",
    short: "The change history of the tree, or of one file (no checkout needed)",
    flags: [TEAM, PATH, { name: "limit", type: "int", help: "how many changes to show (default 20)" }, JSON_FLAG],
    run: (ctx) => {
      var _a, _b, _c;
      const node = call("getDocument", { id: readTeam(ctx), path: (_a = str(ctx, "path")) != null ? _a : "", history: true });
      const history = (_b = node.history) != null ? _b : [];
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(history));
      if (history.length === 0) return microteams.print("(no history)");
      for (const c of history.slice(0, (_c = int(ctx, "limit")) != null ? _c : 20)) {
        const when = new Date(c.timestamp * 1e3).toISOString();
        microteams.print(`${c.sha.slice(0, 7)} ${when} ${c.author}\uFF1A${c.message}`);
      }
    }
  };
  var show2 = {
    name: "show",
    short: "Print one file, or list a folder, from any of your teams' trees (no checkout needed)",
    flags: [TEAM, PATH, JSON_FLAG],
    run: (ctx) => {
      var _a, _b, _c;
      const node = call("getDocument", { id: readTeam(ctx), path: (_a = str(ctx, "path")) != null ? _a : "", content: true });
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(node));
      if (!node.isFolder) return microteams.print((_b = node.content) != null ? _b : "");
      for (const c of (_c = node.children) != null ? _c : []) microteams.print(c.isFolder ? `${c.path}/` : c.path);
    }
  };
  var diff = {
    name: "diff",
    short: "What changed in a file since a given change (sha from `docs log`)",
    flags: [TEAM, __spreadProps(__spreadValues({}, PATH), { required: true }), { name: "since", type: "string", required: true, help: "a change sha" }],
    run: (ctx) => {
      var _a;
      const node = call("getDocument", { id: readTeam(ctx), path: need(ctx, "path"), diff: need(ctx, "since") });
      microteams.print((_a = node.diff) != null ? _a : "(no difference)");
    }
  };
  gitCommands.commands.push(log, show2, diff);
  microteams.command(gitCommands);

  // src/cli/team.ts
  var TEAM2 = { name: "team", type: "string", required: true, help: "a team id or name" };
  var USER2 = { name: "user-id", type: "int", required: true, help: "the member's user id" };
  var list2 = {
    name: "list",
    short: "List the teams you're in",
    flags: [
      { name: "role", type: "string", help: "only teams where you have this role (OWNER, ADMIN, MEMBER)" },
      { name: "limit", type: "int", help: "how many to list (default 50, max 100)" },
      { name: "page-start", type: "int", help: "continue from the cursor printed by a previous call" },
      JSON_FLAG
    ],
    run: (ctx) => {
      var _a;
      const r = str(ctx, "role");
      const resp = call("listTeams", {
        role: r != null ? role(r) : void 0,
        page_size: limit(ctx, 50),
        page_start: int(ctx, "page-start")
      });
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(resp));
      const teams = (_a = resp.teams) != null ? _a : [];
      if (teams.length === 0) return microteams.print("(you are in no teams)");
      for (const t of teams) microteams.print(`#${t.id} ${t.name}`);
      moreHint(resp.page, (n) => `microteams api team list --page-start ${n}`, "teams");
    }
  };
  var show3 = {
    name: "show",
    short: "One team: its members with their roles, and the machines that serve it",
    flags: [TEAM2, JSON_FLAG],
    run: (ctx) => {
      var _a, _b;
      const id = teamId(need(ctx, "team"));
      const detail = call("getTeam", { id });
      const machines = (_a = call("listMachines", { teamId: id, page_size: 100 }).machines) != null ? _a : [];
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(__spreadProps(__spreadValues({}, detail), { machines })));
      microteams.print(`#${detail.team.id} ${detail.team.name}`);
      microteams.print(`${detail.members.length} member(s):`);
      for (const m of detail.members) microteams.print(`  ${(_b = m.nickname) != null ? _b : ""} (#${m.userId}) ${m.role}`);
      microteams.print(`${machines.length} machine(s):`);
      for (const m of machines) microteams.print(`  ${m.name} (${m.id}) ${m.online ? "online" : "offline"}`);
    }
  };
  var create2 = {
    name: "create",
    short: "Found a new team (you become its owner)",
    flags: [{ name: "name", type: "string", required: true, help: "the team's name" }, JSON_FLAG],
    run: (ctx) => {
      const t = call("createTeam", { CreateTeamRequest: { name: need(ctx, "name") } });
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(t));
      done(`created team #${t.id} ${t.name}`);
    }
  };
  var rename2 = {
    name: "rename",
    short: "Rename a team",
    flags: [TEAM2, { name: "name", type: "string", required: true, help: "the new name" }],
    run: (ctx) => {
      const t = call("renameTeam", { id: teamId(need(ctx, "team")), RenameTeamRequest: { name: need(ctx, "name") } });
      done(`team #${t.id} is now called ${t.name}`);
    }
  };
  var del = {
    name: "delete",
    short: "Delete a team (owner only); there is no undo",
    flags: [TEAM2],
    run: (ctx) => {
      const id = teamId(need(ctx, "team"));
      call("deleteTeam", { id });
      done(`deleted team #${id}`);
    }
  };
  var members2 = {
    name: "members",
    short: "List a team's members with their roles",
    flags: [TEAM2, JSON_FLAG],
    run: (ctx) => {
      var _a;
      const ms = call("listTeamMembers", { id: teamId(need(ctx, "team")) });
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(ms));
      for (const m of ms) microteams.print(`#${m.userId} ${(_a = m.nickname) != null ? _a : ""} ${m.role}`);
    }
  };
  var addMember2 = {
    name: "add-member",
    short: "Add someone to a team",
    flags: [TEAM2, USER2, { name: "role", type: "string", help: "OWNER, ADMIN or MEMBER (default MEMBER)" }],
    run: (ctx) => {
      var _a;
      const id = teamId(need(ctx, "team"));
      const userId = Number(need(ctx, "user-id"));
      call("addTeamMember", { id, AddTeamMemberRequest: { userId, role: role(String((_a = ctx.flags["role"]) != null ? _a : "MEMBER")) } });
      done(`added #${userId} to team #${id}`);
    }
  };
  var removeMember2 = {
    name: "remove-member",
    short: "Remove someone from a team",
    flags: [TEAM2, USER2],
    run: (ctx) => {
      const id = teamId(need(ctx, "team"));
      const userId = Number(need(ctx, "user-id"));
      call("removeTeamMember", { id, userId });
      done(`removed #${userId} from team #${id}`);
    }
  };
  var setRole2 = {
    name: "set-role",
    short: "Change a member's role in a team",
    flags: [TEAM2, USER2, { name: "role", type: "string", required: true, help: "OWNER, ADMIN or MEMBER" }],
    run: (ctx) => {
      const id = teamId(need(ctx, "team"));
      const userId = Number(need(ctx, "user-id"));
      const r = role(need(ctx, "role"));
      call("changeMemberRole", { id, userId, ChangeRoleRequest: { role: r } });
      done(`#${userId} is now ${r} in team #${id}`);
    }
  };
  var MACHINE = { name: "machine", type: "string", required: true, help: "a machine id or name" };
  var bindMachine = {
    name: "bind-machine",
    short: "Let a machine serve this team (you must already be able to use the machine)",
    flags: [TEAM2, MACHINE],
    run: (ctx) => {
      const id = teamId(need(ctx, "team"));
      const m = machineId(need(ctx, "machine"));
      call("bindTeamMachine", { id, BindMachineRequest: { machineId: m } });
      done(`machine ${m} now serves team #${id}`);
    }
  };
  var unbindMachine = {
    name: "unbind-machine",
    short: "Stop a machine serving this team",
    flags: [TEAM2, MACHINE],
    run: (ctx) => {
      const id = teamId(need(ctx, "team"));
      const m = machineId(need(ctx, "machine"));
      call("unbindTeamMachine", { id, machineId: m });
      done(`machine ${m} no longer serves team #${id}`);
    }
  };
  microteams.command({
    name: "team",
    short: "Teams: list, show, create, rename, delete, members and roles, which machines serve them",
    commands: [list2, show3, create2, rename2, del, members2, addMember2, removeMember2, setRole2, bindMachine, unbindMachine]
  });

  // src/cli/agent.ts
  var AGENT = { name: "user-id", type: "int", required: true, help: "the agent's user id" };
  function llmFlags(prefix) {
    return [
      { name: prefix + "provider", type: "string", help: "deepseek, custom, or none (remove the setting)" },
      { name: prefix + "api", type: "string", help: "custom only: openai-completions, openai-responses or anthropic-messages" },
      { name: prefix + "base-url", type: "string", help: "the endpoint (required for custom; optional for deepseek)" },
      { name: prefix + "model", type: "string", help: "the model id to use (required for custom)" },
      { name: prefix + "api-key-file", type: "string", help: "read the API key from this file" },
      { name: prefix + "api-key-env", type: "string", help: "read the API key from this environment variable" },
      { name: prefix + "clear-api-key", type: "bool", help: "remove the stored API key" }
    ];
  }
  function readSecret(how, where) {
    const r = how === "file" ? microteams.exec("cat", [where]) : microteams.exec("printenv", [where]);
    const v = r.stdout.trim();
    if (r.code !== 0 || v === "") throw new Error(how === "file" ? `cannot read an API key from ${where}` : `$${where} is not set`);
    return v;
  }
  function llmSettings(ctx, prefix) {
    const provider = str(ctx, prefix + "provider");
    if (provider == null) return void 0;
    let apiKey;
    const file = str(ctx, prefix + "api-key-file");
    const env = str(ctx, prefix + "api-key-env");
    if (file != null) apiKey = readSecret("file", file);
    else if (env != null) apiKey = readSecret("env", env);
    else if (ctx.flags[prefix + "clear-api-key"] === true) apiKey = "";
    return {
      provider,
      api: str(ctx, prefix + "api"),
      baseUrl: str(ctx, prefix + "base-url"),
      model: str(ctx, prefix + "model"),
      apiKey
    };
  }
  function llmLine(llm) {
    if (!llm) return "model API: the machine's own configuration";
    const parts = [llm.provider];
    if (llm.api) parts.push(llm.api);
    if (llm.baseUrl) parts.push(llm.baseUrl);
    if (llm.model) parts.push("model " + llm.model);
    parts.push(llm.hasApiKey ? "key set" : "no key");
    return "model API: " + parts.join(" \xB7 ");
  }
  var list3 = {
    name: "list",
    short: "List agents, optionally only those of a team, a machine or a group chat",
    flags: [
      { name: "team", type: "string", help: "only agents working for this team (id or name)" },
      { name: "machine", type: "string", help: "only agents running on this machine (id or name)" },
      { name: "thread-id", type: "int", help: "only agents in this group chat" },
      { name: "online", type: "bool", help: "only agents running right now" },
      { name: "limit", type: "int", help: "how many to list (default 50, max 100)" },
      { name: "page-start", type: "int", help: "continue from the cursor printed by a previous call" },
      JSON_FLAG
    ],
    run: (ctx) => {
      var _a;
      const team = str(ctx, "team");
      const machine = str(ctx, "machine");
      const resp = call("listAgents", {
        teamId: team != null ? teamId(team) : void 0,
        machineId: machine != null ? machineId(machine) : void 0,
        threadId: int(ctx, "thread-id"),
        online: ctx.flags["online"] === true ? true : void 0,
        page_size: limit(ctx, 50),
        page_start: int(ctx, "page-start")
      });
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(resp));
      const agents = (_a = resp.agents) != null ? _a : [];
      if (agents.length === 0) return microteams.print("(no agents)");
      for (const a of agents) {
        const where = a.machineId ? ` \xB7 on ${a.machineId}` : "";
        const team2 = a.teamId != null ? ` \xB7 team #${a.teamId}` : "";
        microteams.print(`#${a.userId} ${a.nickname} \xB7 ${a.online ? "online" : "offline"}${team2}${where}${a.driver ? " \xB7 " + a.driver : ""}`);
      }
      moreHint(resp.page, (n) => `microteams api agent list --page-start ${n}`, "agents");
    }
  };
  var show4 = {
    name: "show",
    short: "One agent: where it runs, for which team, with which driver, and its keepalive",
    flags: [AGENT, JSON_FLAG],
    run: (ctx) => {
      var _a;
      const userId = Number(need(ctx, "user-id"));
      const a = ((_a = call("listAgents", { userId: [userId] }).agents) != null ? _a : [])[0];
      if (!a) throw new Error(`no agent #${userId}`);
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(a));
      microteams.print(`#${a.userId} ${a.nickname} \xB7 ${a.online ? "online" : "offline"}`);
      if (a.teamId != null) microteams.print(`team #${a.teamId}`);
      if (a.machineId) microteams.print(`machine ${a.machineId}${a.sid ? " \xB7 screen " + a.sid : ""}`);
      if (a.driver) microteams.print(`driver ${a.driver}`);
      if (a.keepalive) microteams.print(`keepalive ${JSON.stringify(a.keepalive)}`);
      microteams.print(llmLine(a.llm));
    }
  };
  var open = {
    name: "open",
    short: "Open a new agent on a machine, working for a team",
    flags: [
      { name: "machine", type: "string", required: true, help: "the machine it runs on (id or name)" },
      { name: "team", type: "string", required: true, help: "the team it works for (id or name)" },
      { name: "nickname", type: "string", help: "its display name" },
      { name: "driver", type: "string", help: "which program drives it (see `agent drivers`)" },
      { name: "cwd", type: "string", help: "its working directory on the machine (default: a private docs checkout)" },
      ...llmFlags("llm-")
    ],
    run: (ctx) => {
      const opened = call("openAgent", {
        OpenAgentRequest: {
          machineId: machineId(need(ctx, "machine")),
          teamId: teamId(need(ctx, "team")),
          nickname: str(ctx, "nickname"),
          driver: str(ctx, "driver"),
          cwd: str(ctx, "cwd"),
          llm: llmSettings(ctx, "llm-")
        }
      });
      done(`opened agent #${opened.agentUserId} on ${opened.machineId} (screen ${opened.sid})`);
    }
  };
  var close = {
    name: "close",
    short: "Close an agent: its screen ends and it stops running",
    flags: [AGENT],
    run: (ctx) => {
      const userId = Number(need(ctx, "user-id"));
      call("closeAgent", { userId });
      done(`closed agent #${userId}`);
    }
  };
  var reboot = {
    name: "reboot",
    short: "Restart an agent, continuing the same session",
    flags: [AGENT],
    run: (ctx) => {
      const userId = Number(need(ctx, "user-id"));
      const opened = call("rebootAgent", { userId });
      done(`rebooted agent #${userId} (screen ${opened.sid})`);
    }
  };
  var rename3 = {
    name: "rename",
    short: "Change an agent's display name",
    flags: [AGENT, { name: "nickname", type: "string", required: true, help: "the new name" }],
    run: (ctx) => {
      const a = call("setAgentNickname", { userId: Number(need(ctx, "user-id")), SetAgentNicknameRequest: { nickname: need(ctx, "nickname") } });
      done(`agent #${a.userId} is now called ${a.nickname}`);
    }
  };
  var setAvatar = {
    name: "set-avatar",
    short: "Set an agent's avatar to an already-uploaded image id",
    flags: [AGENT, { name: "avatar-id", type: "int", required: true, help: "the uploaded image id" }],
    run: (ctx) => {
      const a = call("setAgentAvatar", { userId: Number(need(ctx, "user-id")), SetAgentAvatarRequest: { avatarId: Number(need(ctx, "avatar-id")) } });
      done(`agent #${a.userId} now uses avatar ${a.avatarId}`);
    }
  };
  var keepalive = {
    name: "keepalive",
    short: "Turn the periodic wake-up of an agent on or off",
    flags: [
      AGENT,
      { name: "enabled", type: "bool", required: true, help: "true to wake it periodically, false to stop" },
      { name: "interval-seconds", type: "int", help: "how often to wake it" }
    ],
    run: (ctx) => {
      var _a;
      const a = call("setAgentKeepalive", {
        userId: Number(need(ctx, "user-id")),
        SetAgentKeepaliveRequest: { enabled: ctx.flags["enabled"] === true, intervalSeconds: int(ctx, "interval-seconds") }
      });
      done(`agent #${a.userId} keepalive: ${JSON.stringify((_a = a.keepalive) != null ? _a : {})}`);
    }
  };
  var setLlm = {
    name: "set-llm",
    short: "Set the model API an agent's program uses (dsh): provider, endpoint, model, key",
    long: "Send the whole setting each time; the stored key is kept unless --api-key-file, --api-key-env\nor --clear-api-key says otherwise. It reaches the program on its next start, so reboot the\nagent to apply it now.\n\nExamples:\n  agent set-llm --user-id 42 --provider deepseek --api-key-file ~/deepseek.key\n  agent set-llm --user-id 42 --provider custom --api openai-completions \\\n      --base-url https://gateway.example/v1 --model my-model --api-key-env GATEWAY_KEY\n  agent set-llm --user-id 42 --provider none",
    flags: [AGENT, ...llmFlags("")],
    run: (ctx) => {
      const settings = llmSettings(ctx, "");
      if (!settings) throw new Error("--provider is required (deepseek, custom, or none)");
      const userId = Number(need(ctx, "user-id"));
      const a = call("setAgentLlm", { userId, AgentLlmSettings: settings });
      done(`agent #${a.userId}: ${llmLine(a.llm)}`);
      done(`(applies on its next start: microteams api agent reboot --user-id ${a.userId})`);
    }
  };
  var drivers = {
    name: "drivers",
    short: "Which programs can drive an agent, and the default",
    flags: [JSON_FLAG],
    run: (ctx) => {
      const d = call("listAgentDrivers", {});
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(d));
      for (const name of d.drivers) microteams.print(name === d.defaultDriver ? `${name} (default)` : name);
    }
  };
  microteams.command({
    name: "agent",
    short: "Agents: list, show, open, close, reboot, rename, avatar, keepalive, model API, drivers",
    commands: [list3, show4, open, close, reboot, rename3, setAvatar, keepalive, setLlm, drivers]
  });

  // src/cli/machine.ts
  var MACHINE2 = { name: "machine", type: "string", required: true, help: "a machine id or name" };
  var list4 = {
    name: "list",
    short: "List the machines you can use (those serving any of your teams)",
    flags: [
      { name: "team", type: "string", help: "only machines serving this team (id or name)" },
      { name: "online", type: "bool", help: "only machines connected right now" },
      { name: "limit", type: "int", help: "how many to list (default 50, max 100)" },
      { name: "page-start", type: "string", help: "continue from the cursor printed by a previous call" },
      JSON_FLAG
    ],
    run: (ctx) => {
      var _a;
      const team = str(ctx, "team");
      const resp = call("listMachines", {
        teamId: team != null ? teamId(team) : void 0,
        online: ctx.flags["online"] === true ? true : void 0,
        page_size: limit(ctx, 50),
        page_start: str(ctx, "page-start")
      });
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(resp));
      const machines = (_a = resp.machines) != null ? _a : [];
      if (machines.length === 0) return microteams.print("(no machines)");
      for (const m of machines)
        microteams.print(`${m.id} ${m.name} \xB7 ${m.online ? "online" : "offline"} \xB7 teams ${m.teamIds.map((t) => "#" + t).join(", ")}`);
      moreHint(resp.page, (n) => `microteams api machine list --page-start ${n}`, "machines");
    }
  };
  var show5 = {
    name: "show",
    short: "One machine: whether it is online, which teams it serves, and the agents on it",
    flags: [MACHINE2, JSON_FLAG],
    run: (ctx) => {
      var _a;
      const id = machineId(need(ctx, "machine"));
      const m = call("getMachine", { id });
      const agents = (_a = call("listAgents", { machineId: id, page_size: 100 }).agents) != null ? _a : [];
      if (wantsJson(ctx)) return microteams.print(JSON.stringify(__spreadProps(__spreadValues({}, m), { agents })));
      microteams.print(`${m.id} ${m.name} \xB7 ${m.online ? "online" : "offline"}`);
      microteams.print(`serves teams: ${m.teamIds.map((t) => "#" + t).join(", ") || "(none)"}`);
      microteams.print(`${agents.length} agent(s):`);
      for (const a of agents) microteams.print(`  ${a.nickname} (#${a.userId}) ${a.online ? "online" : "offline"}`);
    }
  };
  var rename4 = {
    name: "rename",
    short: "Rename a machine",
    flags: [MACHINE2, { name: "name", type: "string", required: true, help: "the new name" }],
    run: (ctx) => {
      const m = call("renameMachine", { id: machineId(need(ctx, "machine")), RenameMachineRequest: { name: need(ctx, "name") } });
      done(`machine ${m.id} is now called ${m.name}`);
    }
  };
  var forget = {
    name: "forget",
    short: "Forget a machine for every team: it is disconnected and must enroll again to come back",
    flags: [MACHINE2],
    run: (ctx) => {
      const id = machineId(need(ctx, "machine"));
      call("forgetMachine", { id });
      done(`forgot machine ${id}`);
    }
  };
  var approve = {
    name: "approve",
    short: "Approve a machine that is enrolling (`microteams link connect` printed its code) into teams",
    flags: [
      { name: "code", type: "string", required: true, help: "the one-time code from the enrolling machine" },
      { name: "teams", type: "string", required: true, help: "comma-separated team ids or names it should serve" }
    ],
    run: (ctx) => {
      const teamIds = need(ctx, "teams").split(",").map((s) => s.trim()).filter((s) => s.length > 0).map(teamId);
      const m = call("approveEnrollment", { ApproveEnrollmentRequest: { code: need(ctx, "code"), teamIds } });
      done(`approved machine ${m.id} ${m.name} for teams ${teamIds.map((t) => "#" + t).join(", ")}`);
    }
  };
  microteams.command({
    name: "machine",
    short: "Machines: list, show, rename, forget, and approve one that is enrolling",
    commands: [list4, show5, rename4, forget, approve]
  });
})();
