// Chats — desktop master-detail. Left: thread list (fixed 320px). Center: the
// conversation with a slim header. Right (toggled): group info drawer. The
// selected thread lives in the URL (/chats/:id) so deep links and the browser
// back button work; the rail switches sections, this owns selection.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { Plus, MessagesSquare, Info, Users, X, Trash2 } from "lucide-react";
import type {
  ChatLastMessage,
  ChatMember,
  ChatSummary,
  ThreadMember,
  TeamMemberRoleEnum as Role,
} from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";
import { useAuth } from "@/hooks/useAuth";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { UserAvatar } from "@/components/UserAvatar";
import { Conversation } from "@/desktop/Conversation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const ROLE_ORDER: Record<Role, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

export function ChatsDesktop() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const selectedId = useMemo(() => {
    const m = location.pathname.match(/^\/chats\/(\d+)/);
    return m ? Number(m[1]) : null;
  }, [location.pathname]);

  const [newOpen, setNewOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const chats = useAsync(
    () => mtCall(chatApi().listChats({ pageSize: 100 })),
    [],
  );
  // A steady 5s poll keeps the list previews and unread state fresh.
  useEffect(() => {
    const t = setInterval(() => chats.reload(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The selected thread's detail (title + members), owned here so the header and
  // the info drawer share one fetch with the conversation.
  const detail = useAsync(
    () =>
      selectedId
        ? mtCall(chatApi().getThread({ id: selectedId }))
        : Promise.resolve(null),
    [selectedId],
  );

  const title =
    detail.data?.thread.title || (selectedId ? `thread #${selectedId}` : "");

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* ---- thread list ---- */}
      <aside className="flex w-80 shrink-0 flex-col border-r">
        <header className="flex h-14 items-center justify-between px-4">
          <h1 className="text-sm font-semibold tracking-wide">chats</h1>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="text-foreground hover:bg-accent flex size-8 items-center justify-center rounded-md"
            aria-label="new chat"
            title="new chat"
          >
            <Plus className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {chats.loading && !chats.data && <Loading />}
          {chats.error && (
            <div className="p-3">
              <Alert variant="destructive">
                <AlertDescription>{chats.error}</AlertDescription>
              </Alert>
            </div>
          )}
          {chats.data && chats.data.chats.length === 0 && (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-20 text-sm">
              <MessagesSquare className="size-8 opacity-50" />
              no conversations yet
            </div>
          )}
          {chats.data && (
            <ul className="flex flex-col">
              {chats.data.chats.map((c) => (
                <ChatRow
                  key={c.id}
                  chat={c}
                  meId={user?.id}
                  active={c.id === selectedId}
                  onOpen={() => {
                    setInfoOpen(false);
                    navigate(`/chats/${c.id}`);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* ---- conversation ---- */}
      {selectedId ? (
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-5">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={() => setInfoOpen((v) => !v)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md hover:bg-accent",
                infoOpen ? "text-primary" : "text-muted-foreground",
              )}
              aria-label="chat info"
              title="chat info"
            >
              <Info className="size-5" />
            </button>
          </header>
          <Conversation
            threadId={selectedId}
            members={detail.data?.members ?? []}
          />
        </section>
      ) : (
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <MessagesSquare className="size-12 opacity-30" />
          <p className="text-sm">select a conversation</p>
        </section>
      )}

      {/* ---- info drawer ---- */}
      {selectedId && infoOpen && (
        <ChatInfoPanel
          threadId={selectedId}
          members={detail.data?.members ?? []}
          loading={detail.loading}
          reload={detail.reload}
          onClose={() => setInfoOpen(false)}
          onDissolved={() => {
            setInfoOpen(false);
            chats.reload();
            navigate("/chats");
          }}
        />
      )}

      <NewChatModal
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => {
          chats.reload();
          navigate(`/chats/${id}`);
        }}
      />
    </div>
  );
}

function ChatRow({
  chat: c,
  meId,
  active,
  onOpen,
}: {
  chat: ChatSummary;
  meId?: number;
  active: boolean;
  onOpen: () => void;
}) {
  const others = c.members.filter((m) => m.userId !== meId);
  const oneOnOne = c.members.length === 2 && others.length === 1;
  const title =
    c.title ||
    (oneOnOne
      ? others[0].nickname
      : c.members.map((m) => m.nickname).join("、") || `thread #${c.id}`);
  const preview = c.lastMessage
    ? previewText(c.lastMessage, c.members, oneOnOne)
    : "no messages yet";
  const time = fmtListTime(c.lastMessage?.createdAt ?? c.updatedAt);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2.5 text-left",
          active ? "bg-accent" : "hover:bg-accent/60",
        )}
      >
        <div className="size-11 shrink-0">
          {oneOnOne ? (
            <UserAvatar
              userId={others[0].userId}
              nickname={others[0].nickname}
              avatarId={others[0].avatarId}
              showMeta={false}
              className="size-11 rounded-lg"
            />
          ) : (
            <div className="bg-secondary text-secondary-foreground flex size-11 items-center justify-center rounded-lg">
              <Users className="size-5" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {title}
            </span>
            <span className="text-muted-foreground shrink-0 text-[11px]">
              {time}
            </span>
          </div>
          <span className="text-muted-foreground truncate text-xs">
            {preview}
          </span>
        </div>
      </button>
    </li>
  );
}

// ---- new chat (a modal on desktop, the same call the phone page makes) --------
function NewChatModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const memberIds = members
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    setError(null);
    setBusy(true);
    try {
      const thread = await mtCall(
        chatApi().createThread({
          createThreadRequest: {
            title: title.trim(),
            memberIds: memberIds.length ? memberIds : undefined,
          },
        }),
      );
      setTitle("");
      setMembers("");
      onOpenChange(false);
      onCreated(thread.id);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="new chat">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="nc-title">title</Label>
          <Input
            id="nc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="general"
            autoFocus
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="nc-members" className="gap-1">
            <Users className="size-3.5" /> member ids (optional)
          </Label>
          <Input
            id="nc-members"
            value={members}
            onChange={(e) => setMembers(e.target.value)}
            placeholder="12, 34, 56"
            inputMode="numeric"
          />
          <p className="text-muted-foreground text-xs">
            comma or space separated user ids
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={busy || !title.trim()}>
          {busy ? <Spinner /> : "create"}
        </Button>
      </form>
    </Modal>
  );
}

// ---- info drawer (member grid + owner controls) ------------------------------
function ChatInfoPanel({
  threadId,
  members: memberList,
  loading,
  reload,
  onClose,
  onDissolved,
}: {
  threadId: number;
  members: ThreadMember[];
  loading: boolean;
  reload: () => void;
  onClose: () => void;
  onDissolved: () => void;
}) {
  const { user } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const myRole = memberList.find((m) => m.userId === user?.id)?.role;
  const canManage = myRole === "OWNER" || myRole === "ADMIN";
  const isOwner = myRole === "OWNER";
  const members = [...memberList].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role],
  );

  async function remove(userId: number) {
    setError(null);
    setBusy(true);
    try {
      await mtCall(chatApi().removeThreadMember({ id: threadId, userId }));
      reload();
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
      onDissolved();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l">
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <h3 className="text-sm font-semibold">chat info</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-md"
          aria-label="close"
        >
          <X className="size-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading && members.length === 0 && <Loading />}
        {(members.length > 0 || !loading) && (
          <>
            <div className="grid grid-cols-4 gap-x-2 gap-y-4">
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
                      className="size-12"
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
                    {m.userId === user?.id
                      ? "you"
                      : (m.nickname ?? `#${m.userId}`)}
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
                  <span className="flex size-12 items-center justify-center rounded-lg border border-dashed text-neutral-500">
                    <Plus className="size-5" />
                  </span>
                </button>
              )}
            </div>

            {error && (
              <div className="mt-4">
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            )}

            {isOwner && (
              <div className="mt-6 border-t pt-4">
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={busy}
                  onClick={onDissolve}
                >
                  <Trash2 className="size-4" /> dissolve chat
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <AddMemberModal
        open={addOpen}
        onOpenChange={setAddOpen}
        threadId={threadId}
        onChanged={reload}
      />
    </aside>
  );
}

function AddMemberModal({
  open,
  onOpenChange,
  threadId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
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

function previewText(
  last: ChatLastMessage,
  members: ChatMember[],
  oneOnOne: boolean,
): string {
  if (oneOnOne) return last.content;
  const sender = members.find((m) => m.userId === last.senderId);
  return sender ? `${sender.nickname}：${last.content}` : last.content;
}

function fmtListTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
}
