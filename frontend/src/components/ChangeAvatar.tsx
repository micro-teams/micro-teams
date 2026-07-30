// An avatar you can change: it shows one, and picking an image replaces it. Used for the signed-in
// user (ProfilePage / ProfileDesktop) and for an agent (the agent info panels).
//
// The upload half is identical for both — cheese-auth's mature avatar backend, which every account
// already has: POST the file to /avatars and get an id back. Only APPLYING that id differs, and it
// differs for a reason worth stating: cheese-auth lets a user change only their OWN profile, so an
// agent's avatar cannot be set with the human's token. mt has an endpoint for exactly that
// (PUT /agent/{userId}/avatar), which performs the change as the agent itself.
//
// So the target is a parameter rather than a second copy of this component. UserAvatar stays purely
// presentational — it is read-only in dozens of places and upload logic has no business in a display
// primitive; this is the editing shell that wraps it.
import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";
import { agentApi, mtCall } from "@/lib/mtApi";
import { cn } from "@/lib/utils";

/** Whose avatar this changes: the signed-in user, or an agent (by user id). */
export type AvatarTarget =
  | { kind: "me" }
  | { kind: "agent"; userId: number; nickname?: string; avatarId?: number };

export function ChangeAvatar({
  className,
  target = { kind: "me" },
  onChanged,
}: {
  className?: string;
  target?: AvatarTarget;
  /** Called after a successful change, e.g. so the surrounding list refetches. */
  onChanged?: () => void;
}) {
  const { user, accessToken, refreshMe } = useAuth();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Show the new picture at once, even if the list around us only refetches later.
  const [justSet, setJustSet] = useState<number | null>(null);

  const isMe = target.kind === "me";
  if (isMe && !user) return null;

  const shownId = isMe ? (user?.id ?? 0) : target.userId;
  const shownName = isMe ? user?.nickname : target.nickname;
  const shownAvatar = justSet ?? (isMe ? user?.avatarId : target.avatarId);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a failure
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("please pick an image file");
      return;
    }
    setBusy(true);
    try {
      const avatarId = await api.uploadAvatar(file, accessToken ?? undefined);
      if (target.kind === "me") {
        if (!user) return;
        // PUT /users/:id wants the whole profile — carry the rest through unchanged.
        await api.updateProfile(
          user.id,
          { nickname: user.nickname, intro: user.intro ?? "", avatarId },
          accessToken ?? undefined,
        );
        await refreshMe();
      } else {
        // An agent's profile is not ours to write: mt does it as the agent.
        await mtCall(
          agentApi().setAgentAvatar({
            userId: target.userId,
            setAgentAvatarRequest: { avatarId },
          }),
        );
      }
      setJustSet(avatarId);
      onChanged?.();
      toast.success("avatar updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      disabled={busy}
      aria-label="change avatar"
      title="change avatar"
      className={cn("group relative shrink-0", className)}
    >
      <Avatar
        seed={shownId}
        label={shownName}
        avatarId={shownAvatar}
        className="size-full rounded-xl"
      />
      {/* A small camera badge (always visible, so it's discoverable on touch too),
          replaced by a spinner while uploading. */}
      <span className="bg-primary text-primary-foreground absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border-2 border-card">
        {busy ? (
          <Spinner className="size-3" />
        ) : (
          <Camera className="size-3.5" />
        )}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />
    </button>
  );
}
