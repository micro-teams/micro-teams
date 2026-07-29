// The group-chat avatar: a WeChat-style grid of the first up-to-9 member avatars,
// packed into a rounded tile. Shared by the phone (ChatsPage) and desktop
// (ChatsDesktop) chat lists so a group thread looks the same on both. Fills its
// parent (size-full), so the caller's sized wrapper controls how big it is.
import type { ChatMember } from "@/api";
import { UserAvatar } from "@/components/UserAvatar";

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

export function MemberGrid({ members }: { members: ChatMember[] }) {
  const shown = members.slice(0, 9);
  const perRow = shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : 3;
  // Square tiles: width is a share of the row, height follows via aspect-ratio (a percentage
  // height would resolve against the row's own auto height, not its width).
  const tile = `calc((100% - ${perRow - 1}px) / ${perRow})`;
  let i = 0;
  return (
    <div className="flex size-full flex-col items-center justify-center gap-px overflow-hidden rounded-lg bg-neutral-200 p-px dark:bg-neutral-700">
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
