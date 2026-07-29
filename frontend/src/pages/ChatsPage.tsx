import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Plus, MessagesSquare, MessageSquarePlus } from "lucide-react";
import type { ChatLastMessage, ChatMember, ChatSummary } from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";
import { useAuth } from "@/hooks/useAuth";
import { useAsync } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { MemberGrid } from "@/components/MemberGrid";
import { usePublicAgentMember } from "@/hooks/usePublicAgentMember";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ChatsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const chats = useAsync(
    () => mtCall(chatApi().listChats({ pageSize: 100 })),
    [],
    "chats",
  );
  const { data, error, loading } = chats;
  // A steady poll keeps the list fresh while sitting on it — new messages, moved
  // previews, reordering — mirroring the desktop chat list (ChatsDesktop) and the
  // in-conversation polling. Without it the phone list only refreshed on navigation.
  useEffect(() => {
    const t = setInterval(() => chats.reload(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeader
        title="chats"
        actions={
          <Menu
            trigger={
              <button
                type="button"
                className="text-foreground hover:bg-accent flex size-8 items-center justify-center rounded-md"
                aria-label="new"
              >
                <Plus className="size-5" />
              </button>
            }
          >
            <MenuItem
              icon={<MessageSquarePlus className="size-4" />}
              onSelect={() => navigate("/chats/new")}
            >
              New chat
            </MenuItem>
          </Menu>
        }
      />

      <div className="flex flex-col">
        {/* Only on the FIRST load — the 5s poll's reload() also flips `loading`, and showing
            the spinner on every tick made the list read "loading…" every few seconds. Match the
            desktop list, which gates its spinner on `!data` for the same reason. */}
        {loading && !data && <Loading />}
        {error && (
          <div className="p-3">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        {data && data.chats.length === 0 && (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-20 text-sm">
            <MessagesSquare className="size-8 opacity-50" />
            no conversations yet
          </div>
        )}

        {data && data.chats.length > 0 && (
          <ul className="flex flex-col">
            {data.chats.map((c: ChatSummary) => (
              <ChatRow
                key={c.id}
                chat={c}
                meId={user?.id}
                onOpen={() => navigate(`/chats/${c.id}`)}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ChatRow({
  chat: c,
  meId,
  onOpen,
}: {
  chat: ChatSummary;
  meId?: number;
  onOpen: () => void;
}) {
  const others = c.members.filter((m) => m.userId !== meId);
  // 1-on-1 (me + exactly one other): show the other's avatar (reused control — an agent
  // keeps its ring/click-to-watch). Otherwise a WeChat-style grid of the first members.
  const oneOnOne = c.members.length === 2 && others.length === 1;
  // A "public agent" chat — exactly one agent, the rest human — shows the agent's avatar
  // as the group avatar (takes precedence over the grid, and over the 1-on-1 case, which
  // an agent DM already resolves to the same agent).
  const publicAgent = usePublicAgentMember(c.members);

  const title =
    c.title ||
    (oneOnOne
      ? others[0].nickname
      : c.members.map((m) => m.nickname).join("、") || `thread #${c.id}`);

  const preview = c.lastMessage
    ? previewText(c.lastMessage, c.members, oneOnOne)
    : "tap to open";
  const time = fmtListTime(c.lastMessage?.createdAt ?? c.updatedAt);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className="size-12 shrink-0">
          {publicAgent ? (
            <UserAvatar
              userId={publicAgent.userId}
              nickname={publicAgent.nickname}
              avatarId={publicAgent.avatarId}
              showMeta={false}
              className="size-12 rounded-lg"
            />
          ) : oneOnOne ? (
            <UserAvatar
              userId={others[0].userId}
              nickname={others[0].nickname}
              avatarId={others[0].avatarId}
              showMeta={false}
              className="size-12 rounded-lg"
            />
          ) : (
            <MemberGrid members={c.members} />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col border-b py-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {time}
            </span>
          </div>
          <span className="text-muted-foreground truncate text-sm">
            {preview}
          </span>
        </div>
      </button>
    </li>
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
