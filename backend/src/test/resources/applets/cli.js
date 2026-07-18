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
    name: "post-note",
    short: "Post a message into your current group chat",
    flags: [
      { name: "text", type: "string", required: true, help: "the message to send to the group" },
      {
        name: "thread-id",
        type: "int",
        help: "target group id (defaults to your most recent group)"
      }
    ],
    run: (ctx) => {
      const body = { text: String(ctx.flags["text"]) };
      if (ctx.flags["thread-id"] !== void 0) body.thread_id = Number(ctx.flags["thread-id"]);
      const msg = request({ method: "POST", path: "/agent/note", body });
      microteams.print(JSON.stringify(msg));
    }
  });
})();
