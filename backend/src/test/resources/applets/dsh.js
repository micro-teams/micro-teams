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

  // src/engine/host.ts
  var host = globalThis.connector;

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
  var inputQueue = [];
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
    let inFlight = null;
    function report(p, ok, error) {
      if (p.id !== void 0) host.call("sayResult", { id: p.id, ok, error: error != null ? error : "" });
    }
    function pump(status) {
      if (inFlight) {
        if (!term.hold(true)) return;
        if (--inFlight.enterIn > 0) return;
        const done = inFlight;
        inFlight = null;
        const ok = term.write(ENTER);
        term.hold(false);
        report(done, ok, ok ? void 0 : "the Enter could not be written");
        return;
      }
      if (!inputQueue.length || status !== "idle" && status !== "busy") return;
      if (!term.hold(true)) return;
      const next = inputQueue[0];
      const body = next.mode === "paste" ? PASTE_START + next.text + PASTE_END : next.text;
      if (!term.write(body)) {
        term.hold(false);
        return;
      }
      inputQueue.shift();
      inFlight = __spreadProps(__spreadValues({}, next), { enterIn: 2 });
    }
    let frame = 0;
    term.onChange(() => {
      var _a2, _b2, _c2;
      frame++;
      const screen = term.read();
      const tail2 = tailOf(screen, tailLines);
      const ctx = { screen, tail: tail2, frame, status: statusVar.get(), write: (d) => term.write(d) };
      const last = (_a2 = tail2.split("\n").pop()) != null ? _a2 : "";
      if (/^Pane is dead \(status \d+/.test(last.trim())) {
        statusVar.set("dead");
        return;
      }
      for (const gate of (_b2 = spec.gates) != null ? _b2 : []) {
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
        if (!up) continue;
        if (frame % ((_c2 = gate.every) != null ? _c2 : 2) === 0) gate.act(gctx);
        statusVar.set("starting");
        return;
      }
      const o = spec.observe(screen);
      let st = o.kind;
      if (o.kind === "open") st = o.working ? "busy" : o.hasUI ? "idle" : "starting";
      ctx.status = st;
      pump(st);
      if (st === "idle" && !inFlight && !inputQueue.length && spec.onIdle) spec.onIdle(ctx);
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
    host.expose("say", (text, id) => {
      const body = spec.beforeSay ? spec.beforeSay(String(text)) : String(text);
      inputQueue.push({ text: body, mode: "paste", id: id === void 0 ? void 0 : String(id) });
      return "queued";
    });
    for (const name of Object.keys((_c = spec.commands) != null ? _c : {})) host.expose(name, spec.commands[name]);
    host.call("screenReady", { driver: spec.name, version: spec.version }).then((ack) => {
      host.log("server acked screenReady: " + JSON.stringify(ack));
    });
  }

  // src/drivers/dsh.ts
  var STATUS = /──\s+(● working(?:\s+(\d+m\d{2}s|\d+s))?|○ ready|✕ exited|… starting)/;
  function statusLine(screen) {
    const lines = tail(screen, 8).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = STATUS.exec(lines[i]);
      if (m) return m;
    }
    return null;
  }
  defineDriver({
    name: "dsh",
    version: 1,
    observe: (screen) => {
      const tail2 = tail(screen, 8);
      const m = statusLine(screen);
      if (!m) return { kind: "open", working: false, hasUI: false };
      if (m[1].indexOf("\u2715 exited") === 0) return { kind: "dead" };
      if (m[1].indexOf("\u25CF working") === 0) return { kind: "open", working: true, hasUI: true };
      if (m[1].indexOf("\u25CB ready") === 0) return { kind: "open", working: false, hasUI: true };
      return { kind: "open", working: false, hasUI: false };
    },
    // The elapsed time is on the status line; acp-screen shows no per-turn token count.
    progress: (ctx) => {
      const m = statusLine(ctx.screen);
      return m && m[2] ? { elapsed: m[2] } : null;
    },
    commands: {
      // Cancel the turn in flight: acp-screen maps Ctrl-C to ACP session/cancel.
      interrupt: () => {
        host.term.write("");
        return true;
      }
    }
  });
})();
