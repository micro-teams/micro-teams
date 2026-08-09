// Chats — phone layout for thread info: a pushed page, roomy member grid, actions stacked down the
// column. Layout only; membership and settings live in features/chats/useThreadInfo.
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Trash2 } from "lucide-react";
import { useThread } from "@/features/chats/useChats";
import { useThreadInfo } from "@/features/chats/useThreadInfo";
import {
  AddMemberModal,
  ThreadMembers,
  ThreadTitleForm,
} from "@/features/chats/components/ThreadInfoPieces";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ChatInfoPage() {
  const { threadId: threadIdParam } = useParams();
  const threadId = Number(threadIdParam);
  const navigate = useNavigate();

  const detail = useThread(threadId);
  const info = useThreadInfo(
    threadId,
    detail.data?.members ?? [],
    detail.reload,
  );
  const [addOpen, setAddOpen] = useState(false);

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
            <ThreadMembers
              members={info.members}
              myUserId={info.myUserId}
              canManage={info.canManage}
              busy={info.busy}
              density="phone"
              onRemove={(id) => void info.remove(id)}
              onAdd={() => setAddOpen(true)}
            />

            {info.error && (
              <Alert variant="destructive">
                <AlertDescription>{info.error}</AlertDescription>
              </Alert>
            )}

            {info.isOwner && (
              <ThreadTitleForm
                title={detail.data.thread.title ?? ""}
                onRename={info.rename}
                className="flex flex-col border-t pt-4"
              />
            )}

            {info.isOwner && (
              <Button
                variant="destructive"
                disabled={info.busy}
                onClick={async () => {
                  if (!confirm("Dissolve this chat? This cannot be undone."))
                    return;
                  if (await info.dissolve())
                    navigate("/chats", { replace: true });
                }}
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
        onAdd={info.add}
      />
    </>
  );
}
