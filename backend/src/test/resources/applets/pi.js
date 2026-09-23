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
  function readCursorOptions(screen) {
    const lines = screen.split("\n").map(clean);
    const cursor = lines.findIndex((l) => /^\s*[❯>]\s+\S/.test(l));
    if (cursor < 0) return [];
    const isItem = (line) => line.trim() !== "" && !/Enter to (confirm|continue)|Esc to (cancel|exit)/i.test(line);
    let first = cursor;
    while (first - 1 >= 0 && isItem(lines[first - 1])) first--;
    let last = cursor;
    while (last + 1 < lines.length && isItem(lines[last + 1])) last++;
    return lines.slice(first, last + 1).map((line, i) => ({
      opt: { n: i + 1, label: line.replace(/^\s*[❯>]?\s*/, "").trim() },
      selected: first + i === cursor
    }));
  }
  function chooseNearCursorByLabel(write, screen, want) {
    const options = readCursorOptions(screen);
    if (options.length === 0) return "no-list";
    const target = options.findIndex((o) => want.test(o.opt.label));
    if (target < 0) return "absent";
    const current = options.findIndex((o) => o.selected);
    if (current === target) {
      write(ENTER);
      return "confirmed";
    }
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
            if (chooseByLabel((d) => term.write(d), screen, want) === "absent") {
              chooseNearCursorByLabel((d) => term.write(d), screen, want);
            }
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

  // src/drivers/pi.ts
  defineDriver({
    name: "pi",
    version: 1,
    observe: (screen) => {
      const tail2 = tail(screen, 16).split("\n");
      const tailStr = tail2.join("\n");
      if (/Pane is dead \(status/.test(tailStr)) return { kind: "dead" };
      const working = /[⠁-⣿]/.test(tailStr) && /\bWorking\b/.test(tailStr);
      const hasUI = /\d+(\.\d+)?%\/\d+[kKmM]?\s*\(/.test(tailStr) || tail2.filter((l) => l.trim()).length > 3;
      return { kind: "open", working, hasUI };
    },
    // pi paints no per-turn elapsed or token count — the context line above is cumulative, and
    // pulling it out as "this turn's tokens" would report a number that goes backwards. Honest null,
    // as the codex declaration does for what its footer does not carry.
    progress: () => null
  });
})();
