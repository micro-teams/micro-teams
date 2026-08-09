// The two fields a new chat needs. The phone puts them on a pushed page, the desktop in a modal;
// what they are, and how "12, 34 56" becomes member ids, is the same in both.
import { Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewChatFields({
  title,
  setTitle,
  members,
  setMembers,
  idPrefix = "thread",
}: {
  title: string;
  setTitle: (v: string) => void;
  members: string;
  setMembers: (v: string) => void;
  /** Keeps the label/input ids unique when a page and a modal coexist in one tree. */
  idPrefix?: string;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-title`}>title</Label>
        <Input
          id={`${idPrefix}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="general"
          autoFocus
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-members`} className="gap-1">
          <Users className="size-3.5" /> member ids (optional)
        </Label>
        <Input
          id={`${idPrefix}-members`}
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          placeholder="12, 34, 56"
          inputMode="numeric"
        />
        <p className="text-muted-foreground text-xs">
          comma or space separated user ids
        </p>
      </div>
    </>
  );
}
