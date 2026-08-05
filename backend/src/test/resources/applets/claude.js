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

  // src/drivers/claude.ts
  var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var modeCyclesTried = 0;
  var bypassUnavailable = false;
  var modeVar = host.watch("mode");
  var inLoginMode = () => modeVar.get() === "login";
  var loginIssued = false;
  var capturedUrl = "";
  var OAUTH_URL_RE = /https:\/\/[^\s│╭╮╰╯"']*oauth[^\s│╭╮╰╯"']*/i;
  function findOAuthUrl(screen) {
    const flat = screen.replace(/[│╭╮╰╯]/g, "");
    const direct = flat.match(OAUTH_URL_RE);
    if (direct) return direct[0];
    const joined = flat.replace(/\n/g, "").match(OAUTH_URL_RE);
    return joined ? joined[0] : "";
  }
  function observe(screen) {
    const tail2 = tail(screen, 16).split("\n");
    const tailStr = tail2.join("\n");
    if (/Pane is dead \(status/.test(tailStr)) return { kind: "dead" };
    const trust = /Do you trust/i.test(tailStr);
    const hasFooter = /Esc to cancel|to amend|ctrl\+e to explain|Enter to (confirm|continue)|Esc to exit/i.test(tailStr);
    const selIdx = tail2.findIndex((l) => /❯\s+\d+\.\s/.test(clean(l)));
    if (selIdx >= 0 && (hasFooter || trust)) {
      let start = selIdx;
      while (start - 1 >= 0 && parseOption(tail2[start - 1])) start--;
      const opts = [];
      for (let i = start; i < tail2.length; i++) {
        const p = parseOption(tail2[i]);
        if (!p || p.n !== opts.length + 1) break;
        opts.push(p);
      }
      if (opts.length >= 2 && opts[0].n === 1) {
        let q = "";
        for (let i = 0; i < start; i++) {
          const t = clean(tail2[i]).trim();
          if (t.endsWith("?")) q = t;
        }
        return { kind: "waiting", question: q, choices: opts };
      }
    }
    const orange = /esc to interrupt/.test(tailStr);
    const spins = (c) => /^\s*[⠁-⣿]/.test(c);
    const anySpinner = tail2.some((l) => spins(clean(l)));
    const bandRows = tail2.filter((l) => {
      const c = clean(l);
      return spins(c) && !/esc to interrupt/.test(c);
    }).length;
    const busyFooter = /…\s*\([^)]*\b(?:\d+[hms]|tokens?)\b[^)]*\)/i.test(tailStr);
    const hasUI = /\? for shortcuts|for agents/.test(tailStr) || tail2.filter((l) => l.trim()).length > 3;
    return { kind: "open", working: orange || anySpinner || busyFooter, hasUI, bandRows };
  }
  defineDriver({
    name: "claude",
    version: 15,
    gates: [
      {
        // The folder-trust gate on a fresh cwd. Wording varies by version, and the default option is
        // the safe one ("Enter to confirm"), so a bare Enter is right. Every frame: it is idempotent.
        name: "folder trust",
        when: /I trust this folder|created or one you trust|Do you trust/i,
        every: 1,
        act: (c) => c.write(ENTER)
      },
      {
        // The bypass-permissions consent, shown the first time Claude Code is started with
        // --dangerously-skip-permissions on a machine that has never accepted it. This is the one
        // gate whose default answer is DESTRUCTIVE — the cursor starts on "No, exit" — so the bare
        // Enter that gets past folder-trust would quit Claude here instead, and an agent on a
        // brand-new machine would die before reading anything. Pick by label, never by position.
        name: "bypass permissions",
        when: /Bypass Permissions mode/i,
        act: (c) => c.choose(/yes,?\s*i\s*accept/i)
      },
      {
        // Resuming, Claude offers to continue from a SUMMARY instead of the full transcript and waits
        // on the answer before it will read anything. Take the full session: the point of --resume is
        // that the agent picks up where it left off, and a summary silently drops what it was working
        // from. Left alone it hangs here forever, which is how a woken agent that "came back" never
        // answers. The second clause is the dialog's own cursor: it is still up.
        name: "resume full session",
        when: (c) => /Resuming the full session|resuming from a summary/i.test(c.screen) && /❯\s*\d+\.\s/.test(clean(c.screen)),
        act: (c) => c.choose(/resume full session/i)
      },
      {
        // First-run wizard, step one: the terminal theme. Any theme is fine, so confirm the default —
        // a bare Enter is safe here because the cursor starts on option 1 and this only picks a colour.
        // Login mode only: a normal agent never sees this (its onboarding is pre-written).
        name: "login: theme picker",
        when: (c) => inLoginMode() && /choose the text style|text style that looks|dark mode/i.test(c.screen),
        act: (c) => c.write(ENTER)
      },
      {
        // First-run wizard, step two: how to log in. We MUST land on the subscription option (the whole
        // point is a plan login, never Console/API pay-per-token), so pick it BY LABEL — never a bare
        // Enter, which would take whatever the build happens to default to. On known builds option 1 is
        // the subscription one, so if the label has moved we fall back to the default rather than hang.
        name: "login: choose subscription login",
        when: (c) => inLoginMode() && /login method|select login|how would you like to (log|sign) in|log in with your/i.test(c.screen),
        act: (c) => {
          const sub = readOptions(c.screen).find(
            (o) => /subscription|claude account|claude\.ai|with your (claude|max|pro)|\bmax\b|\bpro\b/i.test(o.opt.label)
          );
          if (sub) c.choose(new RegExp(escapeRe(sub.opt.label)));
          else c.write(ENTER);
        }
      }
    ],
    observe,
    vars: { compact: "", compactPct: 0, subagents: 0, oauthUrl: "", loginState: "" },
    report: (ctx, vars, o) => {
      var _a;
      vars.subagents.set(o.kind === "open" ? (_a = o.bandRows) != null ? _a : 0 : 0);
      const cm = ctx.tail.match(/Compacting conversation[^%]*?(\d+)\s*%/);
      if (cm || /Compacting conversation/.test(ctx.tail)) {
        vars.compact.set("running");
        vars.compactPct.set(cm ? parseInt(cm[1], 10) : 0);
      } else if (/Compacted \(|Not enough messages to compact/i.test(ctx.tail)) {
        vars.compact.set("done");
        vars.compactPct.set(100);
      } else {
        vars.compact.set("");
        vars.compactPct.set(0);
      }
      if (inLoginMode()) {
        if (!capturedUrl) {
          const u = findOAuthUrl(ctx.screen);
          if (u) capturedUrl = u;
        }
        vars.oauthUrl.set(capturedUrl);
        if (/login successful|logged in|successfully logged/i.test(ctx.tail)) vars.loginState.set("success");
        else if (capturedUrl) vars.loginState.set("awaitingCode");
        else vars.loginState.set("");
      }
    },
    // "…(6m 45s · ↓ 19.2k tokens)" — how long this turn has been going and what it has cost.
    progress: (ctx) => {
      const paren = ctx.tail.match(/…\s*\(([^)]*)\)/);
      if (!paren) return null;
      const out = {};
      const tm = paren[1].match(/(?:\d+h\s*)?(?:\d+m\s*)?\d+s|\d+m\b/);
      if (tm) out.elapsed = tm[0].replace(/\s+/g, "");
      const tk = paren[1].match(/([\d.]+k?)\s*tokens/i);
      if (tk) out.tokens = tk[1];
      return out;
    },
    // Keep Claude in bypass-permissions mode — the peer of what --dangerously-skip-permissions starts
    // in, and the most permissive. It drifts out of it over time, and an older driver actively cycled
    // it AWAY into auto mode. Bypass is in the Shift+Tab cycle, so hunt for it; only if a full cycle
    // passes without it appearing (it can be disabled) settle for auto. Only act while a mode line is
    // actually on screen, so a transient frame cannot cycle away from a good mode.
    onIdle: (ctx) => {
      if (inLoginMode()) {
        const urlNow = capturedUrl || findOAuthUrl(ctx.screen);
        if (!loginIssued && !urlNow) {
          ctx.write("/login");
          ctx.write(ENTER);
          loginIssued = true;
        }
        return;
      }
      const inBypass = /bypass permissions on/i.test(ctx.tail);
      const inAuto = /auto mode on/i.test(ctx.tail);
      const modeVisible = inBypass || inAuto || /(accept edits|manual mode|plan mode) on/i.test(ctx.tail);
      if (inBypass) {
        modeCyclesTried = 0;
        bypassUnavailable = false;
      } else if (bypassUnavailable && inAuto) {
        modeCyclesTried = 0;
      } else if (modeVisible && ctx.frame % 2 === 0) {
        ctx.write(SHIFT_TAB);
        if (++modeCyclesTried >= 7) bypassUnavailable = true;
      }
    },
    commands: {
      // Answer the dialog currently on screen by option NUMBER, for a control plane relaying a
      // person's click. Resolved to that option's label and then moved to relatively — the number
      // says which option, never how many keys to press. (The old driver counted keystrokes from an
      // imagined top of the list, which is the bug that made it press "No, exit".)
      choose: (n) => {
        const want = parseInt(String(n), 10) || 1;
        const opt = readOptions(host.term.read()).find((o) => o.opt.n === want);
        if (!opt) return false;
        chooseByLabel((d) => host.term.write(d), host.term.read(), new RegExp(escapeRe(opt.opt.label)));
        return true;
      },
      // Two writes, not one: the command text and its submit, the same way a person sends it.
      compact: () => {
        host.term.write("/compact");
        host.term.write(ENTER);
        return true;
      },
      // Start the interactive login explicitly, for a control plane that would rather drive it than
      // wait for the idle kick (e.g. after re-pointing settings at the official endpoint). Same shape
      // as compact. Submit the captured OAuth code with the ordinary `say` — a bracketed paste with a
      // deferred Enter is exactly what a pasted code needs, and it is already the engine's blessed path.
      login: () => {
        host.term.write("/login");
        host.term.write(ENTER);
        loginIssued = true;
        return true;
      }
    }
  });
})();
