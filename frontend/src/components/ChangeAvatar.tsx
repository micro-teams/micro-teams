// The signed-in user's avatar, tappable to change it. Reuses cheese-auth's mature
// avatar backend (which every account already has): pick an image, POST it to
// /avatars, then PUT the new avatarId onto the user's own profile and refresh.
// Shared by the phone (ProfilePage) and desktop (ProfileDesktop) "me" surfaces.
import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";

export function ChangeAvatar({ className }: { className?: string }) {
  const { user, accessToken, refreshMe } = useAuth();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a failure
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("please pick an image file");
      return;
    }
    setBusy(true);
    try {
      const avatarId = await api.uploadAvatar(file, accessToken ?? undefined);
      // PUT /users/:id wants the whole profile — carry the rest through unchanged.
      await api.updateProfile(
        user.id,
        { nickname: user.nickname, intro: user.intro ?? "", avatarId },
        accessToken ?? undefined,
      );
      await refreshMe();
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
        seed={user.id}
        label={user.nickname}
        avatarId={user.avatarId}
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
