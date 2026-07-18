import { useState } from "react";
import { cn } from "@/lib/utils";

// Rounded-square avatars, WeChat style. When an avatarId is given we show the real
// image from cheese-auth (proxied at /api/avatars/:id); if it fails to load we fall
// back to a deterministic colour + an initial derived from the seed.
const COLORS = [
  "#4e6ef2",
  "#12b76a",
  "#f79009",
  "#ef4444",
  "#7c3aed",
  "#06aed4",
  "#e64980",
  "#2dd4bf",
];

function colorFor(seed: number | string): string {
  const n = typeof seed === "number" ? seed : hash(seed);
  return COLORS[Math.abs(n) % COLORS.length];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** The cheese-auth avatar image URL (via the /api proxy). */
export function avatarUrl(avatarId?: number | null): string | null {
  return avatarId != null ? `/api/avatars/${avatarId}` : null;
}

export function Avatar({
  seed,
  label,
  avatarId,
  className,
}: {
  seed: number | string;
  /** Text whose first char becomes the initial; falls back to the seed. */
  label?: string;
  /** cheese-auth avatar id; when present its image is shown (initial is the fallback). */
  avatarId?: number | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (label ?? String(seed)).trim().charAt(0).toUpperCase() || "#";
  const url = avatarUrl(avatarId);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        className={cn(
          "size-10 shrink-0 rounded-lg object-cover select-none",
          className,
        )}
        onError={() => setFailed(true)}
        aria-hidden
      />
    );
  }

  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white select-none",
        className,
      )}
      style={{ backgroundColor: colorFor(seed) }}
      aria-hidden
    >
      {initial}
    </div>
  );
}
