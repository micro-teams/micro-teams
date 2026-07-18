import * as React from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A controlled modal that renders as a bottom sheet on phones (slides up from
 * the bottom edge, thumb-reachable) and a centered card on wider screens.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out" />
        <Dialog.Content
          className={cn(
            "bg-card fixed z-50 flex flex-col border shadow-lg",
            // phone: bottom sheet
            "inset-x-0 bottom-0 max-h-[90svh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            // >=sm: centered card
            "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-0",
            className,
          )}
        >
          <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">
              {title}
            </Dialog.Title>
            <Dialog.Close
              className="text-muted-foreground hover:text-foreground -mr-1 rounded-md p-1"
              aria-label="close"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-4 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
