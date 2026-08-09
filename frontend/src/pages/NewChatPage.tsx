// Chats — phone layout for creating a chat: a pushed page (a modal on a phone would fight the
// keyboard). Layout only; creating lives in features/chats.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useCreateThread } from "@/features/chats/useChats";
import { NewChatFields } from "@/features/chats/components/NewChatFields";
import { errMsg } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function NewChatPage() {
  const navigate = useNavigate();
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
        <NewChatFields
          title={title}
          setTitle={setTitle}
          members={members}
          setMembers={setMembers}
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
    </>
  );
}
