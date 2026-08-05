"use strict";
(() => {
  // src/engine/host.ts
  var host = (() => {
    const g = globalThis;
    const found = g.connector || g.microteams;
    if (!found) throw new Error("micro-connector: no host global found (connector / microteams)");
    return found;
  })();

  // src/engine/keys.ts
  var ESC = "\x1B";
  var UP = ESC + "[A";
  var DOWN = ESC + "[B";
  var ENTER = "\r";
  var PGDN = ESC + "[6~";
  var SHIFT_TAB = ESC + "[Z";
  var PASTE_START = ESC + "[200~";
  var PASTE_END = ESC + "[201~";

  // src/engine/options.ts
  var clean = (line) => line.replace(/[│╭╮╰╯]/g, "");
  function parseOption(line) {
    const m = clean(line).match(/^\s*[❯>]?\s*(\d+)\.\s+(.*\S)\s*$/);
    return m ? { n: parseInt(m[1], 10), label: m[2].trim() } : null;
  }
  function readOptions(screen) {
    const out = [];
    for (const line of screen.split("\n")) {
      const opt = parseOption(line);
      if (opt) out.push({ opt, selected: /❯/.test(line) });
    }
    return out;
  }
  function chooseByLabel(write, screen, want) {
    const options = readOptions(screen);
    const target = options.findIndex((o) => want.test(o.opt.label));
    if (target < 0) return "absent";
    const current = options.findIndex((o) => o.selected);
    if (current === target) {
      write(ENTER);
      return "confirmed";
    }
    if (current < 0) return "not-ready";
    const step = target > current ? DOWN : UP;
    for (let i = 0; i < Math.abs(target - current); i++) write(step);
    return "moved";
  }

  // src/engine/driver.ts
  function tail(screen, n) {
    const lines = screen.split("\n");
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === "") end--;
    return lines.slice(Math.max(0, end - n), end).join("\n");
  }
  var tailOf = tail;
  function defineDriver(spec) {
    var _a, _b, _c;
    const tailLines = (_a = spec.tailLines) != null ? _a : 16;
    const term = host.term;
    const statusVar = host.own("status", "starting");
    const elapsed = host.own("elapsed", "");
    const tokens = host.own("tokens", "");
    const question = host.own("question", "");
    const choices = host.own("choices", []);
    const extra = {};
    for (const key of Object.keys((_b = spec.vars) != null ? _b : {})) extra[key] = host.own(key, spec.vars[key]);
    const label = host.watch("label");
    label.onChange((v) => host.log("screen labelled: " + v));
    const viewerLevel = host.watch("viewerLevel");
    const viewerActive = () => {
      const l = viewerLevel.get();
      return l === "scroll" || l === "full";
    };
    const viewerTyping = () => viewerLevel.get() === "full";
    let submitIn = 0;
    let queue = [];
    let cmdSince = false;
    function gated(fn) {
      return function(...args) {
        const run = () => {
          cmdSince = true;
          return fn.apply(null, args);
        };
        if (viewerTyping()) {
          queue.push(run);
          return "buffered";
        }
        return run();
      };
    }
    viewerLevel.onChange(() => {
      if (!viewerTyping() && queue.length) {
        const q = queue;
        queue = [];
        q.forEach((f) => f());
      }
    });
    let stableBusy = false;
    let wasActive = false;
    let frame = 0;
    term.onChange(() => {
      var _a2, _b2, _c2;
      frame++;
      const screen = term.read();
      const tail2 = tailOf(screen, tailLines);
      const ctx = {
        screen,
        tail: tail2,
        frame,
        status: statusVar.get(),
        write: (d) => term.write(d),
        viewerActive,
        viewerTyping
      };
      if (submitIn > 0 && !viewerTyping()) {
        if (--submitIn === 0) term.write(ENTER);
      }
      for (const gate of (_a2 = spec.gates) != null ? _a2 : []) {
        const gctx = {
          screen,
          tail: tail2,
          frame,
          write: (d) => term.write(d),
          choose: (want) => {
            chooseByLabel((d) => term.write(d), screen, want);
          }
        };
        const up = typeof gate.when === "function" ? gate.when(gctx) : gate.when.test(screen);
        if (!up || viewerTyping()) continue;
        if (frame % ((_b2 = gate.every) != null ? _b2 : 2) === 0) gate.act(gctx);
        return;
      }
      const active = viewerActive();
      if (((_c2 = spec.keepAtBottom) != null ? _c2 : true) && wasActive && !active) {
        for (let i = 0; i < 12; i++) term.write(PGDN);
      }
      wasActive = active;
      const o = spec.observe(screen);
      let st = o.kind;
      if (o.kind === "open") {
        let busy;
        if (!active) {
          busy = !!o.working;
          stableBusy = busy;
          cmdSince = false;
        } else {
          busy = stableBusy || cmdSince;
        }
        st = busy ? "busy" : o.hasUI ? "idle" : "starting";
      }
      ctx.status = st;
      if (st === "idle" && !active && spec.onIdle) spec.onIdle(ctx);
      statusVar.set(st);
      question.set(o.kind === "waiting" ? o.question || "" : "");
      choices.set(o.kind === "waiting" ? o.choices || [] : []);
      if (st === "busy") {
        const p = spec.progress ? spec.progress(ctx) : null;
        if (p && p.elapsed !== void 0) elapsed.set(p.elapsed);
        if (p && p.tokens !== void 0) tokens.set(p.tokens);
      } else {
        elapsed.set("");
        tokens.set("");
      }
      if (spec.report) spec.report(ctx, extra, o);
    });
    host.expose("snapshot", () => term.read());
    host.expose(
      "say",
      gated((text) => {
        const body = spec.beforeSay ? spec.beforeSay(String(text)) : String(text);
        term.write(PASTE_START + body + PASTE_END);
        submitIn = 2;
        return true;
      })
    );
    for (const name of Object.keys((_c = spec.commands) != null ? _c : {})) {
      host.expose(name, gated(spec.commands[name]));
    }
    host.call("screenReady", { driver: spec.name, version: spec.version }).then((ack) => {
      host.log("server acked screenReady: " + JSON.stringify(ack));
    });
  }

  // src/drivers/codex.ts
  var OPERATOR_PROMPT = "__MT_OPERATOR_PROMPT__";
  var sentOperatorPrompt = false;
  defineDriver({
    name: "codex",
    version: 2,
    gates: [
      {
        // "Do you trust the contents of this directory?" on a fresh cwd. The default is "Yes,
        // continue" with "Press enter to continue", so a bare Enter answers it.
        name: "directory trust",
        when: /Do you trust the contents/i,
        every: 1,
        act: (c) => c.write(ENTER)
      }
    ],
    observe: (screen) => {
      const tail2 = tail(screen, 16).split("\n");
      const tailStr = tail2.join("\n");
      if (/Pane is dead \(status/.test(tailStr)) return { kind: "dead" };
      const working = /esc to interrupt/i.test(tailStr);
      const hasUI = /(^|\n)\s*›/.test(tailStr) || /·\s+\S/.test(tailStr) || tail2.filter((l) => l.trim()).length > 3;
      return { kind: "open", working, hasUI };
    },
    // "Working (6s · esc to interrupt)". Codex's footer carries no token count.
    progress: (ctx) => {
      const m = ctx.tail.match(/Working\s*\(([^)]*)\)/i);
      if (!m) return null;
      const tm = m[1].match(/(?:\d+h\s*)?(?:\d+m\s*)?\d+s|\d+m\b/);
      return tm ? { elapsed: tm[0].replace(/\s+/g, "") } : null;
    },
    beforeSay: (text) => {
      if (sentOperatorPrompt || OPERATOR_PROMPT.slice(0, 5) === "__MT_") return text;
      sentOperatorPrompt = true;
      return OPERATOR_PROMPT + "\n\n" + text;
    },
    // Codex in full-auto never puts a choice dialog up, and nothing scrolls it away from the bottom
    // that the engine needs to undo.
    keepAtBottom: false
  });
})();
