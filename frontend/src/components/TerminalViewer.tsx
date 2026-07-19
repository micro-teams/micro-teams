// 现场 (live agent screen) viewer — a faithful copy of the reference misc/web-claude
// terminal pane (its `#main`: the gatebar + the xterm). The terminal config, the wire
// (raw bytes both ways + JSON control/resize/compact), the three viewer modes, the
// mode/compact/font controls, and the CSS are reproduced (styling unchanged) from web-claude.
// Scrolling differs on purpose: the hosted program is a full-screen TUI whose history lives in
// tmux, not in the program, so the wheel/touch drive tmux copy-mode on the pane (a {type:"scroll"}
// control) rather than sending PgUp/PgDn to the program, which it ignores. The screen `vars` (status /
// question / compact / compactPct) come from the thread presence poll (passed in), the
// way web-claude's dashboard event stream feeds its gatebar.

import "@xterm/xterm/css/xterm.css";

import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { Terminal } from "@xterm/xterm";
import { getNtAccessToken, MT_BASE } from "@/lib/mtApi";

type Vars = Record<string, unknown> | undefined;
type ViewMode = "readonly" | "scroll" | "full";

export function TerminalViewer({
  sid,
  vars,
  onError,
}: {
  sid: string;
  vars: Vars;
  onError?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const viewModeRef = useRef<ViewMode>("readonly");
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [viewMode, setViewMode] = useState<ViewMode>("readonly");
  const [fontSize, setFontSize] = useState<number>(() =>
    parseInt(localStorage.getItem("microteamsFont") || "14", 10),
  );

  // Tell the driver what the human is doing so it knows when the screen is
  // trustworthy to sample and when to buffer its own commands.
  function controlLevel(): string {
    const m = viewModeRef.current;
    return m === "full" ? "full" : m === "scroll" ? "scroll" : "passive";
  }
  function sendControl() {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1)
      ws.send(JSON.stringify({ type: "control", level: controlLevel() }));
  }
  // sendSize fits xterm and tells the server our exact size, so the real terminal (a tmux
  // client on a pty) matches what we render. `force` sends even when not interacting.
  function sendSize(force: boolean) {
    try {
      fitRef.current?.fit();
    } catch {
      /* not ready */
    }
    if (!force && viewModeRef.current === "readonly") return;
    const ws = wsRef.current;
    const term = termRef.current;
    if (ws && ws.readyState === 1 && term)
      ws.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
      );
  }

  function setMode(m: ViewMode) {
    viewModeRef.current = m;
    setViewMode(m);
    // Leaving scroll mode returns the pane to the live screen: tell the connector to
    // exit any tmux copy-mode it entered while we were paged back through history.
    if (m !== "scroll") {
      const ws = wsRef.current;
      if (ws && ws.readyState === 1)
        ws.send(JSON.stringify({ type: "scroll", dir: "bottom" }));
    }
    sendSize(false);
    sendControl();
  }

  // Adjustable terminal font size (persisted). Resizing changes the grid, so re-fit and
  // re-sync the size to the real terminal after each change.
  function setFont(n: number) {
    const size = Math.max(8, Math.min(30, n));
    const term = termRef.current;
    if (term) term.options.fontSize = size;
    localStorage.setItem("microteamsFont", String(size));
    setFontSize(size);
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
    sendSize(false);
  }

  function compact() {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "compact" }));
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelayMs = 500;
    let everOpened = false;
    let notifiedError = false;

    const term = new Terminal({
      fontSize: parseInt(localStorage.getItem("microteamsFont") || "14", 10),
      lineHeight: 1.1,
      fontFamily:
        '"JetBrainsMono Nerd Font", "JetBrains Mono", "MesloLGS NF", monospace',
      theme: { background: "#000000", foreground: "#e7e3f0" }, // pure black
      cursorBlink: true,
      // Let programs (Claude's copy) set the system clipboard via OSC 52 — this
      // copies the real text with no wrap-newlines, exactly like Claude's own copy.
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    try {
      term.loadAddon(new ClipboardAddon());
    } catch {
      /* clipboard addon optional */
    }
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* ignore */
    }

    const enc = new TextEncoder();
    term.onData((d) => {
      if (viewModeRef.current !== "full") return; // only 'full' types into the program
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) ws.send(enc.encode(d));
    });

    // Scrolling. Claude is a full-screen TUI, so xterm has no local scrollback — and the
    // program keeps none either: the history lives in tmux on the machine, reachable only via
    // tmux copy-mode (PgUp/PgDn sent to the program do nothing). So the wheel sends a
    // {type:"scroll",dir} control the connector turns into tmux copy-mode scroll on the pane,
    // and reports 'scroll' so the driver holds its last verdict while we're paged back. When the
    // viewer scrolls back to the bottom the connector leaves copy-mode on its own; leaving
    // scroll/full mode sends an explicit 'bottom' (see setMode) to snap back to live.
    let scrollIdle: ReturnType<typeof setTimeout> | null = null;
    const sendScroll = (dir: "up" | "down") => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: "scroll", dir }));
      ws.send(JSON.stringify({ type: "control", level: "scroll" }));
      if (scrollIdle) clearTimeout(scrollIdle);
      scrollIdle = setTimeout(sendControl, 2000);
    };
    // Intercept the wheel through xterm's OWN hook — a raw DOM listener does not reliably beat
    // xterm's viewport handling (and, in 'full', its mouse-tracking). Returning false stops xterm
    // from scrolling its empty local buffer or forwarding a mouse code; we drive tmux copy-mode
    // scroll via {type:"scroll"} instead (PgUp/PgDn sent to the program does nothing).
    term.attachCustomWheelEventHandler((e) => {
      const m = viewModeRef.current;
      if (m !== "scroll" && m !== "full") return true;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return true;
      sendScroll(e.deltaY < 0 ? "up" : "down");
      return false;
    });

    // Touch scrolling (phones/tablets emit no wheel events). Mirror onWheel: translate a vertical
    // drag into tmux copy-mode scroll on the pane. The program keeps no scrollback, so a finger
    // drag would otherwise do nothing. Dragging DOWN reveals earlier output (scroll up), matching a
    // terminal's natural pull-to-see-history. Only scroll/full may scroll.
    let touchY: number | null = null;
    let touchAccum = 0;
    const TOUCH_STEP = 40; // px of drag per scroll step
    const onTouchStart = (e: TouchEvent) => {
      const m = viewModeRef.current;
      if ((m !== "scroll" && m !== "full") || e.touches.length !== 1) return;
      touchY = e.touches[0].clientY;
      touchAccum = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const m = viewModeRef.current;
      if ((m !== "scroll" && m !== "full") || touchY == null) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1 || e.touches.length !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      const y = e.touches[0].clientY;
      touchAccum += y - touchY; // finger down => positive => earlier output (scroll up)
      touchY = y;
      while (Math.abs(touchAccum) >= TOUCH_STEP) {
        const up = touchAccum > 0;
        sendScroll(up ? "up" : "down");
        touchAccum += up ? -TOUCH_STEP : TOUCH_STEP;
      }
    };
    const onTouchEnd = () => {
      touchY = null;
    };
    container.addEventListener("touchstart", onTouchStart, {
      passive: false,
      capture: true,
    });
    container.addEventListener("touchmove", onTouchMove, {
      passive: false,
      capture: true,
    });
    container.addEventListener("touchend", onTouchEnd, { capture: true });

    const onResize = () => sendSize(false);
    window.addEventListener("resize", onResize);
    const sizeTimer = setInterval(() => sendSize(false), 3000);

    function wsUrl(): string {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = new URL(
        `${MT_BASE}/machine/screen/${encodeURIComponent(sid)}`,
        window.location.origin,
      );
      url.protocol = proto;
      const token = getNtAccessToken();
      if (token) url.searchParams.set("token", token);
      return url.toString();
    }

    function connect() {
      if (destroyed) return;
      const ws = new WebSocket(wsUrl());
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        everOpened = true;
        reconnectDelayMs = 500;
        setTimeout(() => {
          sendSize(true);
          sendControl();
        }, 30);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") term.write(ev.data);
        else term.write(new Uint8Array(ev.data as ArrayBuffer));
      };
      ws.onclose = () => {
        if (destroyed) return;
        // If the very first connection never opened, the screen is gone / not watchable —
        // tell the caller once instead of silently retrying into a black terminal.
        if (!everOpened && !notifiedError) {
          notifiedError = true;
          onErrorRef.current?.();
        }
        reconnectTimer = setTimeout(connect, reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10000);
      };
      ws.onerror = () => ws.close();
    }
    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (scrollIdle) clearTimeout(scrollIdle);
      clearInterval(sizeTimer);
      window.removeEventListener("resize", onResize);
      container.removeEventListener("touchstart", onTouchStart, {
        capture: true,
      } as EventListenerOptions);
      container.removeEventListener("touchmove", onTouchMove, {
        capture: true,
      } as EventListenerOptions);
      container.removeEventListener("touchend", onTouchEnd, {
        capture: true,
      } as EventListenerOptions);
      wsRef.current?.close();
      term.dispose();
      termRef.current = null;
    };
  }, [sid]);

  // -- gatebar (web-claude's renderModeBar), driven by the presence vars --------
  const status = (vars?.status as string) || "?";
  const question = vars?.question as string | undefined;
  const compactState = vars?.compact as string | undefined;
  const pct = Math.max(0, Math.min(100, (vars?.compactPct as number) || 0));
  const modes: [ViewMode, string][] = [
    ["readonly", "只读"],
    ["scroll", "滚动"],
    ["full", "交互"],
  ];

  return (
    <div className="wc-scene">
      <style>{WC_CSS}</style>
      <div id="gatebar">
        <span className="modes">
          {modes.map(([m, label]) => (
            <button
              key={m}
              className={"modebtn" + (viewMode === m ? " on" : "")}
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </span>
        <button
          className="modebtn"
          id="compactbtn"
          title="run Claude's /compact"
          onClick={compact}
        >
          compact
        </button>
        <span className="hint">
          {status === "waiting" && question ? (
            question
          ) : compactState === "running" ? (
            <span className="cbar" title={`compacting ${pct}%`}>
              <span className="ctrack">
                <span className="cfill" style={{ width: `${pct}%` }} />
              </span>
              <b>{pct}%</b>
            </span>
          ) : null}
        </span>
        <span className="fontctl">
          <button
            className="modebtn"
            title="smaller font"
            onClick={() => setFont(fontSize - 1)}
          >
            A−
          </button>
          <button
            className="modebtn"
            title="larger font"
            onClick={() => setFont(fontSize + 1)}
          >
            A+
          </button>
        </span>
      </div>
      <div id="termwrap">
        <div id="term" ref={containerRef} />
      </div>
    </div>
  );
}

// CSS copied verbatim from misc/web-claude/web/index.html (the #main / gatebar / term
// rules), scoped under .wc-scene so nothing else on the page is affected.
const WC_CSS = `
.wc-scene { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #14121a; color: #e7e3f0; }
.wc-scene #gatebar { font-size: .78rem; color: #9d93b8; padding: .3rem .6rem; display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
.wc-scene .modebtn { font: inherit; border: 0; cursor: pointer; font-size: .75rem; padding: .15rem .5rem; margin: 0 .1rem; border-radius: .3rem; background: #2b2740; color: #cbc4e0; }
.wc-scene .modebtn.on { background: #6b46c1; color: #fff; }
.wc-scene #gatebar .hint b { color: #e7e3f0; }
.wc-scene .cbar { display: inline-flex; align-items: center; gap: .35rem; color: #fbbf24; }
.wc-scene .ctrack { display: inline-block; width: 90px; height: .5rem; border-radius: .25rem; background: #2b2740; overflow: hidden; }
.wc-scene .cfill { display: block; height: 100%; background: #fbbf24; transition: width .3s ease; }
.wc-scene #termwrap { flex: 1; padding: .5rem; min-height: 0; position: relative; }
.wc-scene #term { height: 100%; }
.wc-scene #gatebar .fontctl { margin-left: auto; display: inline-flex; gap: .1rem; }
`;
