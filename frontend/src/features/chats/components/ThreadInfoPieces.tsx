// The parts a "chat info" surface is made of: the member grid, the add-member dialog, the rename
// form. Which of them appear, and whether they sit in a pushed page or a side panel, is the shell's
// business; what they do is not.
import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import type { ThreadMember } from "@/api";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Roomy on a phone (five across, bigger targets); denser in a desktop side panel. */
type Density = "phone" | "panel";

const GRID: Record<Density, string> = {
  phone: "grid grid-cols-5 gap-x-3 gap-y-4",
  panel: "grid grid-cols-4 gap-x-2 gap-y-4",
};
const TILE: Record<Density, string> = { phone: "size-14", panel: "size-12" };

export function ThreadMembers({
  members,
  myUserId,
  canManage,
  busy,
  density,
  onRemove,
  onAdd,
}: {
  members: ThreadMember[];
  myUserId?: number;
  canManage: boolean;
  busy: boolean;
  density: Density;
  onRemove: (userId: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className={GRID[density]}>
      {members.map((m) => (
        <div key={m.userId} className="flex flex-col items-center gap-1">
          <div className="relative">
            <UserAvatar
              userId={m.userId}
              nickname={m.nickname}
              avatarId={m.avatarId}
              className={TILE[density]}
            />
            {/* The owner cannot be removed, and you do not remove yourself here — leaving is a
                different act from being taken out, and it does not exist yet. */}
            {canManage && m.role !== "OWNER" && m.userId !== myUserId && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(m.userId)}
                className="bg-destructive absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full text-white"
                aria-label={`remove user ${m.userId}`}
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <span className="w-full truncate text-center text-[11px] text-neutral-400">
            {m.userId === myUserId ? "you" : (m.nickname ?? `#${m.userId}`)}
          </span>
        </div>
      ))}
      {canManage && (
        <button
          type="button"
          onClick={onAdd}
          className="flex flex-col items-center gap-1"
          aria-label="add member"
        >
          <span
            className={`flex ${TILE[density]} items-center justify-center rounded-lg border border-dashed text-neutral-500`}
          >
            <Plus className={density === "phone" ? "size-6" : "size-5"} />
          </span>
        </button>
      )}
    </div>
  );
}

export function AddMemberModal({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (userId: number) => Promise<void>;
}) {
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) {
      setError("enter a numeric user id");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onAdd(id);
      setUserId("");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="add member">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          inputMode="numeric"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="user id, e.g. 123"
          autoFocus
        />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={busy || !userId.trim()}>
          {busy ? <Spinner /> : "add"}
        </Button>
      </form>
    </Modal>
  );
}

/** Rename the chat. Owner-only, and it existed only on the phone until this moved here. */
export function ThreadTitleForm({
  title,
  onRename,
  className,
}: {
  title: string;
  onRename: (title: string) => Promise<void>;
  className?: string;
}) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onRename(value);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      <label htmlFor="chat-title" className="text-sm font-medium">
        chat name
      </label>
      <div className="mt-2 flex gap-2">
        <Input
          id="chat-title"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={busy || !value.trim() || value.trim() === title}
        >
          save
        </Button>
      </div>
    </form>
  );
}
