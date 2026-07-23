"use strict";
(() => {
  // src/screen/codex.ts
  var statusVar = microteams.own("status", "starting");
  var elapsed = microteams.own("elapsed", "");
  var tokens = microteams.own("tokens", "");
  var question = microteams.own("question", "");
  var choices = microteams.own("choices", []);
  var label = microteams.watch("label");
  label.onChange((v) => microteams.log("screen labelled: " + v));
  var viewerLevel = microteams.watch("viewerLevel");
  var isFull = () => viewerLevel.get() === "full";
  var OPERATOR_PROMPT = "__MT_OPERATOR_PROMPT__";
  var sentOperatorPrompt = false;
  var ESC = "\x1B";
  var ENTER = "\r";
  var PASTE_START = ESC + "[200~";
  var PASTE_END = ESC + "[201~";
  function observe(screen) {
    const lines = screen.split("\n");
    const tail = lines.slice(-16);
    const tailStr = tail.join("\n");
    if (/Pane is dead \(status/.test(tailStr)) return { kind: "dead", working: false, hasUI: false };
    const working = /esc to interrupt/i.test(tailStr);
    const hasUI = /(^|\n)\s*›/.test(tailStr) || /·\s+\S/.test(tailStr) || tail.filter((l) => l.trim()).length > 3;
    return { kind: "open", working, hasUI };
  }
  var submitIn = 0;
  microteams.term.onChange(() => {
    const screen = microteams.term.read();
    const tailStr = screen.split("\n").slice(-16).join("\n");
    if (/Do you trust the contents/i.test(screen) && !isFull()) {
      microteams.term.write(ENTER);
      return;
    }
    if (submitIn > 0 && !isFull()) {
      if (--submitIn === 0) microteams.term.write(ENTER);
    }
    const o = observe(screen);
    let st = o.kind;
    if (o.kind === "open") st = o.working ? "busy" : o.hasUI ? "idle" : "starting";
    statusVar.set(st);
    question.set("");
    choices.set([]);
    if (st === "busy") {
      const m = tailStr.match(/Working\s*\(([^)]*)\)/i);
      if (m) {
        const tm = m[1].match(/(?:\d+h\s*)?(?:\d+m\s*)?\d+s|\d+m\b/);
        if (tm) elapsed.set(tm[0].replace(/\s+/g, ""));
      }
    } else {
      elapsed.set("");
      tokens.set("");
    }
  });
  var queue = [];
  function gated(fn) {
    return function() {
      const args = Array.prototype.slice.call(arguments);
      const run = () => fn.apply(null, args);
      if (isFull()) {
        queue.push(run);
        return "buffered";
      }
      return run();
    };
  }
  viewerLevel.onChange(() => {
    if (!isFull() && queue.length) {
      const q = queue;
      queue = [];
      q.forEach((f) => f());
    }
  });
  microteams.expose("snapshot", () => microteams.term.read());
  microteams.expose(
    "say",
    gated((text) => {
      let body = String(text);
      if (!sentOperatorPrompt && OPERATOR_PROMPT.slice(0, 5) !== "__MT_") {
        sentOperatorPrompt = true;
        body = OPERATOR_PROMPT + "\n\n" + body;
      }
      microteams.term.write(PASTE_START + body + PASTE_END);
      submitIn = 2;
      return true;
    })
  );
  microteams.call("screenReady", { driver: "codex", version: 1 }).then((ack) => {
    microteams.log("server acked screenReady: " + JSON.stringify(ack));
  });
})();
