import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { Plus, X, Trash2 } from "lucide-react";
import type { TeamMemberRoleEnum as Role } from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";
import { useAuth } from "@/hooks/useAuth";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

const ROLE_ORDER: Record<Role, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

export function ChatInfoPage() {
  const { threadId: threadIdParam } = useParams();
  const threadId = Number(threadIdParam);
  const navigate = useNavigate();
  const { user } = useAuth();

  const detail = useAsync(
    () => mtCall(chatApi().getThread({ id: threadId })),
    [threadId],
  );
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const myRole = detail.data?.members.find((m) => m.userId === user?.id)?.role;
  const canManage = myRole === "OWNER" || myRole === "ADMIN";
  const isOwner = myRole === "OWNER";
  const members = detail.data
    ? [...detail.data.members].sort(
        (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role],
      )
    : [];

  async function remove(userId: number) {
    setError(null);
    setBusy(true);
    try {
      await mtCall(chatApi().removeThreadMember({ id: threadId, userId }));
      detail.reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDissolve() {
    if (!confirm("Dissolve this chat? This cannot be undone.")) return;
    setBusy(true);
    try {
      await mtCall(chatApi().dissolveThread({ id: threadId }));
      navigate("/chats", { replace: true });
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="chat info" back backFallback={`/chats/${threadId}`} />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
        {detail.loading && <Loading />}
        {detail.error && (
          <Alert variant="destructive">
            <AlertDescription>{detail.error}</AlertDescription>
          </Alert>
        )}

        {detail.data && (
          <>
            {/* Member grid — tap the minus badge to remove; the + tile adds. */}
            <div className="grid grid-cols-5 gap-x-3 gap-y-4">
              {members.map((m) => (
                <div
                  key={m.userId}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="relative">
                    <UserAvatar
                      userId={m.userId}
                      nickname={m.nickname}
                      avatarId={m.avatarId}
                      className="size-14"
                    />
                    {canManage &&
                      m.role !== "OWNER" &&
                      m.userId !== user?.id && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => remove(m.userId)}
                          className="bg-destructive absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full text-white"
                          aria-label={`remove user ${m.userId}`}
                        >
                          <X className="size-3" />
                        </button>
                      )}
                  </div>
                  <span className="w-full truncate text-center text-[11px] text-neutral-400">
                    {m.userId === user?.id ? "you" : `#${m.userId}`}
                  </span>
                </div>
              ))}
              {canManage && (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="flex flex-col items-center gap-1"
                  aria-label="add member"
                >
                  <span className="flex size-14 items-center justify-center rounded-lg border border-dashed text-neutral-500">
                    <Plus className="size-6" />
                  </span>
                </button>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {isOwner && (
              <TitleRow
                threadId={threadId}
                title={detail.data.thread.title ?? ""}
                onRenamed={detail.reload}
              />
            )}

            {isOwner && (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={onDissolve}
              >
                <Trash2 className="size-4" /> dissolve chat
              </Button>
            )}
          </>
        )}
      </div>

      <AddMemberModal
        open={addOpen}
        onOpenChange={setAddOpen}
        threadId={threadId}
        onChanged={detail.reload}
      />
    </>
  );
}

function TitleRow({
  threadId,
  title,
  onRenamed,
}: {
  threadId: number;
  title: string;
  onRenamed: () => void;
}) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await mtCall(
        chatApi().renameThread({
          id: threadId,
          renameThreadRequest: { title: value.trim() },
        }),
      );
      onRenamed();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t pt-4">
      <label htmlFor="chat-title" className="text-sm font-medium">
        chat name
      </label>
      <div className="flex gap-2">
        <Input
          id="chat-title"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={busy || !value.trim() || value.trim() === title}
        >
          save
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

function AddMemberModal({
  open,
  onOpenChange,
  threadId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: number;
  onChanged: () => void;
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
      await mtCall(
        chatApi().addThreadMember({
          id: threadId,
          addMemberRequest: { userId: id },
        }),
      );
      setUserId("");
      onOpenChange(false);
      onChanged();
    } catch (err) {
      setError(errMsg(err));
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
