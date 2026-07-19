// "Add device" — there is no client-side device flow to trigger from the
// browser (enrollment happens on the machine itself, via the CLI), so this is
// purely a tutorial: what to run on the new host, and what to do with the link
// it prints. That link opens /connect (ConnectPage), the same page a human
// lands on either way — this dialog and that page are two ends of one flow.
import { useRef, useState } from "react";
import { Check, Copy, Laptop } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function CodeLine({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  function flash() {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copy() {
    // navigator.clipboard only exists in a secure context (https, or localhost) — over plain
    // http on a LAN IP (e.g. testing before TLS is set up) it's undefined, so `?.` short-circuits
    // synchronously and we never await, keeping the click gesture alive for execCommand below.
    if (navigator.clipboard?.writeText) {
      const ok = await navigator.clipboard
        .writeText(children)
        .then(() => true)
        .catch(() => false);
      if (ok) {
        flash();
        return;
      }
    }
    // execCommand('copy') copies the *document selection*, not whatever element is focused.
    // A hidden textarea only works while it holds focus AND selection — but inside a Radix
    // dialog the focus-trap yanks focus back the instant we call .focus(), dropping the
    // textarea's selection and leaving the dialog title selected (the old bug). Selecting the
    // visible <code> node's contents via a Range needs no focus, so the focus-trap can't touch
    // it — the copied text is exactly this line's command.
    try {
      const node = codeRef.current;
      const sel = window.getSelection();
      if (!node || !sel) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand("copy");
      sel.removeAllRanges();
      if (ok) flash();
    } catch {
      // clipboard unavailable — the text is still selectable by hand.
    }
  }

  return (
    <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs">
      <code
        ref={codeRef}
        className="min-w-0 flex-1 overflow-x-auto whitespace-pre"
      >
        {children}
      </code>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={copy}
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label="copy"
        title="copy"
      >
        {copied ? (
          <Check className={cn("size-4 text-primary")} />
        ) : (
          <Copy className="size-4" />
        )}
      </button>
    </div>
  );
}

export function AddDeviceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const origin = window.location.origin;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="add a device">
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">
          run these two commands on the new machine (the one you want to run
          agents on):
        </p>

        <div className="flex flex-col gap-2">
          <CodeLine>{`curl -fsSL ${origin}/install.sh | sh`}</CodeLine>
          <p className="text-muted-foreground text-xs">
            installs the connector and a private tmux for it to run in.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <CodeLine>microteams link auto-connect</CodeLine>
          <p className="text-muted-foreground text-xs">
            prints an approval link, e.g.{" "}
            <code className="font-mono">
              {origin}/connect?code=...
            </code>
            .
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-dashed p-3">
          <Laptop className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground text-xs">
            copy that link into a browser, log in, and pick which team(s) the
            new machine should serve — it's the same approval page this
            dialog leads to; once approved, the machine shows up here and you
            can open agents on it.
          </p>
        </div>

        <Button onClick={() => onOpenChange(false)}>close</Button>
      </div>
    </Modal>
  );
}
