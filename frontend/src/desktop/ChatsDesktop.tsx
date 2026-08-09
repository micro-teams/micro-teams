// Chats — desktop master-detail. Left: thread list (fixed 320px). Center: the
// conversation with a slim header. Right (toggled): group info drawer. The
// selected thread lives in the URL (/chats/:id) so deep links and the browser
// back button work; the rail switches sections, this owns selection.
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useSectionLocation } from "@/desktop/sectionKeepAlive";
import { Plus, MessagesSquare, Info, X, Trash2 } from "lucide-react";
import type {
  ChatLastMessage,
  ChatMember,
  ChatSummary,
  ThreadMember,
} from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { errMsg } from "@/hooks/useAsync";
import { UserAvatar } from "@/components/UserAvatar";
import { MemberGrid } from "@/components/MemberGrid";
import { usePublicAgentMember } from "@/hooks/usePublicAgentMember";
import { Conversation } from "@/desktop/Conversation";
import {
  useChats,
  useCreateThread,
  useThread,
} from "@/features/chats/useChats";
import { NewChatFields } from "@/features/chats/components/NewChatFields";
import { useThreadInfo } from "@/features/chats/useThreadInfo";
import {
  AddMemberModal,
  ThreadMembers,
  ThreadTitleForm,
} from "@/features/chats/components/ThreadInfoPieces";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function ChatsDesktop() {
  const location = useSectionLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const selectedId = useMemo(() => {
    const m = location.pathname.match(/^\/chats\/(\d+)/);
    return m ? Number(m[1]) : null;
  }, [location.pathname]);

  const [newOpen, setNewOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const chats = useChats();

  // The selected thread's detail (title + members), owned here so the header and
  // the info drawer share one fetch with the conversation.
  const detail = useThread(selectedId);

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
          title={detail.data?.thread.title ?? ""}
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
  // A "public agent" chat — exactly one agent, the rest human — shows the agent's avatar
  // as the group avatar.
  const publicAgent = usePublicAgentMember(c.members);
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
          {publicAgent ? (
            <UserAvatar
              userId={publicAgent.userId}
              nickname={publicAgent.nickname}
              avatarId={publicAgent.avatarId}
              showMeta={false}
              className="size-11 rounded-lg"
            />
          ) : oneOnOne ? (
            <UserAvatar
              userId={others[0].userId}
              nickname={others[0].nickname}
              avatarId={others[0].avatarId}
              showMeta={false}
              className="size-11 rounded-lg"
            />
          ) : (
            <MemberGrid members={c.members} />
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
  const createThread = useCreateThread();
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const thread = await createThread(title, members);
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
        <NewChatFields
          title={title}
          setTitle={setTitle}
          members={members}
          setMembers={setMembers}
          idPrefix="nc"
        />
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
// A side panel rather than a pushed page, denser grid, dissolve at full width — and nothing else
// that differs from the phone's chat info. Rename came along for free when this stopped having its
// own copy of everything.
function ChatInfoPanel({
  threadId,
  title,
  members: memberList,
  loading,
  reload,
  onClose,
  onDissolved,
}: {
  threadId: number;
  title: string;
  members: ThreadMember[];
  loading: boolean;
  reload: () => void;
  onClose: () => void;
  onDissolved: () => void;
}) {
  const info = useThreadInfo(threadId, memberList, reload);
  const [addOpen, setAddOpen] = useState(false);

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
        {loading && info.members.length === 0 && <Loading />}
        {(info.members.length > 0 || !loading) && (
          <>
            <ThreadMembers
              members={info.members}
              myUserId={info.myUserId}
              canManage={info.canManage}
              busy={info.busy}
              density="panel"
              onRemove={(id) => void info.remove(id)}
              onAdd={() => setAddOpen(true)}
            />

            {info.error && (
              <div className="mt-4">
                <Alert variant="destructive">
                  <AlertDescription>{info.error}</AlertDescription>
                </Alert>
              </div>
            )}

            {info.isOwner && (
              <ThreadTitleForm
                title={title}
                onRename={info.rename}
                className="mt-6 flex flex-col border-t pt-4"
              />
            )}

            {info.isOwner && (
              <div className="mt-6 border-t pt-4">
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={info.busy}
                  onClick={async () => {
                    if (!confirm("Dissolve this chat? This cannot be undone."))
                      return;
                    if (await info.dissolve()) onDissolved();
                  }}
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
        onAdd={info.add}
      />
    </aside>
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
