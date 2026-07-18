import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Users } from "lucide-react";
import { chatApi, mtCall } from "@/lib/mtApi";
import { errMsg } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function NewChatPage() {
  const navigate = useNavigate();
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
      navigate(`/chats/${thread.id}`, { replace: true });
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="new chat" back backFallback="/chats" />
      <form
        onSubmit={onSubmit}
        className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-3"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="thread-title">title</Label>
          <Input
            id="thread-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="general"
            autoFocus
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="thread-members" className="gap-1">
            <Users className="size-3.5" /> member ids (optional)
          </Label>
          <Input
            id="thread-members"
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
    </>
  );
}
