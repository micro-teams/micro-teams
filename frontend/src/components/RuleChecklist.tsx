import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function RuleChecklist({
  items,
}: {
  items: { label: string; ok: boolean }[];
}) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {items.map((item) => (
        <li
          key={item.label}
          className={cn(
            "flex items-center gap-2",
            item.ok ? "text-primary" : "text-muted-foreground",
          )}
        >
          {item.ok ? (
            <Check className="size-3.5" />
          ) : (
            <X className="size-3.5" />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}
