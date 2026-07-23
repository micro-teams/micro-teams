"use strict";
(() => {
  // src/screen/claude.ts
  var statusVar = microteams.own("status", "starting");
  var elapsed = microteams.own("elapsed", "");
  var tokens = microteams.own("tokens", "");
  var question = microteams.own("question", "");
  var choices = microteams.own("choices", []);
  var compact = microteams.own("compact", "");
  var compactPct = microteams.own("compactPct", 0);
  var subagents = microteams.own("subagents", 0);
  var label = microteams.watch("label");
  label.onChange((v) => microteams.log("screen labelled: " + v));
  var viewerLevel = microteams.watch("viewerLevel");
  var isActive = () => {
    const l = viewerLevel.get();
    return l === "scroll" || l === "full";
  };
  var isFull = () => viewerLevel.get() === "full";
  var ESC = "\x1B";
  var UP = ESC + "[A";
  var DOWN = ESC + "[B";
  var ENTER = "\r";
  var PGDN = ESC + "[6~";
  var SHIFT_TAB = ESC + "[Z";
  var PASTE_START = ESC + "[200~";
  var PASTE_END = ESC + "[201~";
  function pickOption(n) {
    for (let i = 0; i < 9; i++) microteams.term.write(UP);
    for (let i = 1; i < n; i++) microteams.term.write(DOWN);
    microteams.term.write(ENTER);
  }
  var clean = (l) => l.replace(/[│╭╮╰╯]/g, "");
  function parseOption(l) {
    const m = clean(l).match(/^\s*[❯>]?\s*(\d+)\.\s+(.*\S)\s*$/);
    return m ? { n: parseInt(m[1], 10), label: m[2].trim() } : null;
  }
  function observe(screen) {
    const lines = screen.split("\n");
    const tail = lines.slice(-16);
    const tailStr = tail.join("\n");
    if (/Pane is dead \(status/.test(tailStr)) return { kind: "dead" };
    const trust = /Do you trust/i.test(tailStr);
    const hasFooter = /Esc to cancel|to amend|ctrl\+e to explain|Enter to (confirm|continue)|Esc to exit/i.test(tailStr);
    const selIdx = tail.findIndex((l) => /❯\s+\d+\.\s/.test(clean(l)));
    if (selIdx >= 0 && (hasFooter || trust)) {
      let start = selIdx;
      while (start - 1 >= 0 && parseOption(tail[start - 1])) start--;
      const opts = [];
      for (let i = start; i < tail.length; i++) {
        const p = parseOption(tail[i]);
        if (!p || p.n !== opts.length + 1) break;
        opts.push(p);
      }
      if (opts.length >= 2 && opts[0].n === 1) {
        let q = "";
        for (let i = 0; i < start; i++) {
          const t = clean(tail[i]).trim();
          if (t.endsWith("?")) q = t;
        }
        return { kind: "waiting", question: q, choices: opts };
      }
    }
    const orange = /esc to interrupt/.test(tailStr);
    const spins = (c) => /^\s*[⠁-⣿]/.test(c);
    const anySpinner = tail.some((l) => spins(clean(l)));
    const bandRows = tail.filter((l) => {
      const c = clean(l);
      return spins(c) && !/esc to interrupt/.test(c);
    }).length;
    const busyFooter = /…\s*\([^)]*\b(?:\d+[hms]|tokens?)\b[^)]*\)/i.test(tailStr);
    const working = orange || anySpinner || busyFooter;
    const hasUI = /\? for shortcuts|for agents/.test(tailStr) || tail.filter((l) => l.trim()).length > 3;
    return { kind: "open", orange, bandRows, working, hasUI };
  }
  var stableBusy = false;
  var cmdSince = false;
  var wasActive = false;
  var trustFrames = 0;
  var modeCyclesTried = 0;
  var bypassUnavailable = false;
  var frame = 0;
  var submitIn = 0;
  microteams.term.onChange(() => {
    frame++;
    const screen = microteams.term.read();
    const tailStr = screen.split("\n").slice(-16).join("\n");
    if (submitIn > 0 && !isFull()) {
      if (--submitIn === 0) microteams.term.write(ENTER);
    }
    if (/Do you trust/i.test(tailStr) && !isFull()) {
      if (trustFrames % 4 === 0) microteams.term.write(ENTER);
      trustFrames++;
      return;
    }
    trustFrames = 0;
    const active = isActive();
    if (wasActive && !active) for (let i = 0; i < 12; i++) microteams.term.write(PGDN);
    wasActive = active;
    const o = observe(screen);
    let st = o.kind;
    if (o.kind === "open") {
      let busy;
      if (!active) {
        busy = o.working;
        stableBusy = busy;
        cmdSince = false;
      } else {
        busy = stableBusy || cmdSince;
      }
      st = busy ? "busy" : o.hasUI ? "idle" : "starting";
    }
    if (st === "idle" && !isActive()) {
      const inBypass = /bypass permissions on/i.test(tailStr);
      const inAuto = /auto mode on/i.test(tailStr);
      const modeVisible = inBypass || inAuto || /(accept edits|manual mode|plan mode) on/i.test(tailStr);
      if (inBypass) {
        modeCyclesTried = 0;
        bypassUnavailable = false;
      } else if (bypassUnavailable && inAuto) {
        modeCyclesTried = 0;
      } else if (modeVisible && frame % 2 === 0) {
        microteams.term.write(SHIFT_TAB);
        modeCyclesTried++;
        if (modeCyclesTried >= 7) bypassUnavailable = true;
      }
    }
    statusVar.set(st);
    question.set(o.kind === "waiting" ? o.question || "" : "");
    choices.set(o.kind === "waiting" ? o.choices || [] : []);
    subagents.set(o.kind === "open" ? o.bandRows : 0);
    if (st === "busy") {
      const paren = tailStr.match(/…\s*\(([^)]*)\)/);
      if (paren) {
        const tm = paren[1].match(/(?:\d+h\s*)?(?:\d+m\s*)?\d+s|\d+m\b/);
        if (tm) elapsed.set(tm[0].replace(/\s+/g, ""));
        const tk = paren[1].match(/([\d.]+k?)\s*tokens/i);
        if (tk) tokens.set(tk[1]);
      }
    } else {
      elapsed.set("");
      tokens.set("");
    }
    const cm = tailStr.match(/Compacting conversation[^%]*?(\d+)\s*%/);
    if (cm || /Compacting conversation/.test(tailStr)) {
      compact.set("running");
      compactPct.set(cm ? parseInt(cm[1], 10) : 0);
    } else if (/Compacted \(|Not enough messages to compact/i.test(tailStr)) {
      compact.set("done");
      compactPct.set(100);
    } else {
      compact.set("");
      compactPct.set(0);
    }
  });
  var queue = [];
  function gated(fn) {
    return function() {
      const args = Array.prototype.slice.call(arguments);
      const run = () => {
        cmdSince = true;
        return fn.apply(null, args);
      };
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
      microteams.term.write(PASTE_START + text + PASTE_END);
      submitIn = 2;
      return true;
    })
  );
  microteams.expose(
    "choose",
    gated((n) => {
      pickOption(parseInt(n, 10) || 1);
      return true;
    })
  );
  microteams.expose(
    "compact",
    gated(() => {
      microteams.term.write("/compact");
      microteams.term.write(ENTER);
      return true;
    })
  );
  microteams.call("screenReady", { driver: "claude", version: 11 }).then((ack) => {
    microteams.log("server acked screenReady: " + JSON.stringify(ack));
  });
})();
