// The one avatar control for the whole app — a faithful port of the reference
// microteams-agent-layer UserAvatar. Give it a `userId` and it becomes agent-aware from
// app-global presence: an agent shows a robot badge, a pulsing ring while it is working,
// its elapsed·tokens meta underneath, and clicking opens its 现场 (the one app-global
// viewer). Humans render as a plain avatar. Same look and behaviour everywhere.

import { useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { useScene } from "@/hooks/useScene";
import { useToast } from "@/hooks/useToast";

// Matches the reference: an agent is "working" while its screen is busy/compacting/starting.
function isAgentWorking(status: string | null | undefined): boolean {
  return status === "busy" || status === "starting" || status === "compacting";
}

export function UserAvatar({
  userId,
  nickname,
  avatarId,
  clickable = true,
  showMeta = true,
  fill = false,
  className,
}: {
  userId: number;
  nickname?: string;
  /**
   * The user's avatar, when the caller already knows it (chat members carry it). Required for
   * humans to show a real picture at all: presence only enumerates *agents*, so a human's row is
   * absent by design and there is nothing to fall back to.
   */
  avatarId?: number | null;
  clickable?: boolean;
  showMeta?: boolean;
  /** Stretch to fill the parent (for grid cells) instead of the avatar's own size. */
  fill?: boolean;
  className?: string;
}) {
  const { track, untrack, data } = useAgentPresence();
  const scene = useScene();
  const toast = useToast();

  // Always track presence for this id (track/untrack are stable, so this runs once per id).
  useEffect(() => {
    track(userId);
    return () => untrack(userId);
  }, [userId, track, untrack]);

  const p = data[userId];
  const vars = (p?.vars ?? {}) as Record<string, unknown>;
  // Only agents are returned by the agent enumeration, so being there IS being an agent.
  const isAgent = p != null;
  const online = p?.online ?? false;
  const sid = p?.sid ?? null;
  const status = (vars.status as string) ?? null;
  const working = isAgent && isAgentWorking(status);
  const name = nickname ?? p?.nickname ?? String(userId);
  const elapsed = (vars.elapsed as string) || "";
  const tokens = (vars.tokens as string) || "";
  const meta = [elapsed, tokens].filter(Boolean).join(" · ");
  const canOpen = clickable && isAgent && online && !!sid;
  // Agents are always clickable so a failed open (offline / no live screen) can explain
  // itself instead of looking like a dead avatar — no action should fail silently.
  const clickableAgent = clickable && isAgent;

  const title = !isAgent
    ? name
    : canOpen
      ? `${name} · 点击查看现场`
      : online
        ? `${name} · 现场暂不可用`
        : `${name} · 离线`;

  function onClick(e: ReactMouseEvent) {
    if (!clickableAgent) return;
    e.stopPropagation();
    if (canOpen) {
      scene.open({ sid: sid as string, agentUserId: userId, nickname: name });
    } else if (!online) {
      toast.error(`「${name}」当前离线，无法查看现场`);
    } else {
      toast.error(`「${name}」的现场暂不可用`);
    }
  }

  return (
    <div
      className={`ua${working ? " ua--working" : ""}${clickableAgent ? " ua--clickable" : ""}${fill ? " ua--fill h-full w-full" : ""}`}
      title={title}
      onClick={clickableAgent ? onClick : undefined}
    >
      <style>{UA_CSS}</style>
      <Avatar
        seed={userId}
        label={name}
        avatarId={avatarId ?? p?.avatarId ?? null}
        className={fill ? `ua__img size-full ${className ?? ""}` : className}
      />
      {showMeta && working && meta && <span className="ua__meta">{meta}</span>}
    </div>
  );
}

// Ported from the reference UserAvatar.vue styles (the pulsing ring + robot badge + meta),
// scoped to .ua. Violet stands in for the reference's theme `primary`.
const UA_CSS = `
.ua { position: relative; display: inline-flex; border-radius: 0.5rem; flex: none; }
.ua--clickable { cursor: pointer; }
.ua__meta {
  position: absolute; bottom: -15px; left: 50%; transform: translateX(-50%); z-index: 2;
  font-size: 9px; line-height: 1; padding: 2px 4px; border-radius: 6px;
  background: #7c3aed; color: #fff; white-space: nowrap;
  box-shadow: 0 0 0 2px var(--background, #fff); /* crisp edge where it crosses the ring */
}
/*
 * The reference's ring is a circle at a flat inset: -3px, which works there because its avatars
 * are circles too. Ours are WeChat-style rounded squares, whose corners reach
 * (S/2 - r)*sqrt(2) + r from the centre — further than a -3px circle at the smallest point of the
 * pulse. Hence a proportional inset instead: -18% clears the corners at scale(1) for every avatar
 * size we use (24-96px), so the ring never gets bitten by them.
 */
.ua--working::after {
  content: ''; position: absolute; inset: -18%; border-radius: 50%;
  border: 2px solid #7c3aed; animation: ua-pulse 1.6s ease-in-out infinite;
}
/*
 * In a grid cell there is no room outside to put the ring: the WeChat-style tile is clipped by its
 * container (that rounded square is the whole point), so a ring reaching past the cell would be
 * sliced off and would paint over the neighbours. So instead of growing outwards, the whole thing
 * scales down — the avatar shrinks and the ring is drawn around it *inside* the cell. Only while
 * working, so an idle grid stays full-bleed exactly like WeChat.
 */
.ua--fill .ua__img { transition: transform 0.2s ease; }
.ua--fill.ua--working .ua__img { transform: scale(0.64); }
.ua--fill.ua--working::after { inset: 6%; border: 1.5px solid #7c3aed; }
@keyframes ua-pulse {
  0%, 100% { opacity: 0.35; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.08); }
}
`;
