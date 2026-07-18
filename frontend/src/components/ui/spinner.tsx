import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

/** Centered loading state for a whole page/panel. */
export function Loading({ label = "loading…" }: { label?: string }) {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
      <Spinner />
      {label}
    </div>
  );
}
