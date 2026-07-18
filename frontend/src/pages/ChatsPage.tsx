import { useNavigate } from "react-router";
import { Plus, MessagesSquare, MessageSquarePlus } from "lucide-react";
import type { ChatLastMessage, ChatMember, ChatSummary } from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";
import { useAuth } from "@/hooks/useAuth";
import { useAsync } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ChatsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, error, loading } = useAsync(
    () => mtCall(chatApi().listChats({ pageSize: 100 })),
    [],
  );

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
        {loading && <Loading />}
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
  // keeps its ring/click-to-现场). Otherwise a WeChat-style grid of the first members.
  const oneOnOne = c.members.length === 2 && others.length === 1;

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
          {oneOnOne ? (
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

// WeChat-style grid of the first up-to-9 member avatars, packed inside a rounded tile.
/**
 * WeChat's group-avatar layout: up to 9 tiles in a rounded square, and — the part that makes it
 * read as WeChat — a row that is not full is centred rather than left-aligned, so 3 members are
 * one-over-two and 5 are two-over-three. Tiles are 1/2 the square up to 4 members, 1/3 beyond.
 */
function gridRows(n: number): number[] {
  if (n <= 1) return [1];
  if (n === 2) return [2];
  if (n === 3) return [1, 2];
  if (n === 4) return [2, 2];
  if (n === 5) return [2, 3];
  if (n === 6) return [3, 3];
  if (n === 7) return [1, 3, 3];
  if (n === 8) return [2, 3, 3];
  return [3, 3, 3];
}

function MemberGrid({ members }: { members: ChatMember[] }) {
  const shown = members.slice(0, 9);
  const perRow = shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : 3;
  // Square tiles: width is a share of the row, height follows via aspect-ratio (a percentage
  // height would resolve against the row's own auto height, not its width).
  const tile = `calc((100% - ${perRow - 1}px) / ${perRow})`;
  let i = 0;
  return (
    <div className="flex size-12 flex-col items-center justify-center gap-px overflow-hidden rounded-lg bg-neutral-200 p-px dark:bg-neutral-700">
      {gridRows(shown.length).map((count, r) => (
        <div key={r} className="flex w-full justify-center gap-px">
          {Array.from({ length: count }, () => {
            const m = shown[i++];
            return (
              <div key={m.userId} style={{ width: tile, aspectRatio: "1" }}>
                <UserAvatar
                  userId={m.userId}
                  nickname={m.nickname}
                  avatarId={m.avatarId}
                  showMeta={false}
                  fill
                  className="rounded-[2px]"
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
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
