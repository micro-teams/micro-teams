// The one app-global 现场 overlay. Mounted once; when an avatar opens a scene it shows the
// agent's live Claude Code terminal (the verbatim web-claude pane) full-screen over the app.
// Live vars for the gatebar come from the shared presence poll. Close with Esc.

import { useEffect } from "react";
import { TerminalViewer } from "@/components/TerminalViewer";
import { useScene } from "@/hooks/useScene";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { useToast } from "@/hooks/useToast";

export function SceneOverlay() {
  const scene = useScene();
  const presence = useAgentPresence();
  const toast = useToast();
  const target = scene.current;
  const agentUserId = target?.agentUserId;

  useEffect(() => {
    if (agentUserId == null) return;
    presence.track(agentUserId);
    return () => presence.untrack(agentUserId);
  }, [agentUserId, presence]);

  // Esc closes the scene (no on-screen close button).
  useEffect(() => {
    if (agentUserId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") scene.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agentUserId, scene]);

  if (!target) return null;
  const vars = presence.data[target.agentUserId]?.vars ?? undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#14121a" }}
    >
      <TerminalViewer
        sid={target.sid}
        vars={vars}
        onError={() => {
          toast.error("现场连接失败，可能该会话已结束");
          scene.close();
        }}
      />
    </div>
  );
}
