import * as React from "react";
import { DropdownMenu } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * A small in-place dropdown menu (anchored to its trigger, not a bottom sheet).
 * Wraps radix DropdownMenu with app styling.
 */
export function Menu({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className={cn(
            "bg-popover text-popover-foreground z-50 min-w-44 overflow-hidden rounded-lg border p-1 shadow-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out data-[state=open]:zoom-in-95",
            className,
          )}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  destructive,
  disabled,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={(e) => {
        e.preventDefault();
        onSelect();
      }}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none select-none",
        "data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        destructive
          ? "text-destructive data-[highlighted]:text-destructive"
          : "text-foreground",
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="bg-border my-1 h-px" />;
}

/** A checkable-looking row (renders its own check on the right when active). */
export function MenuCheckItem({
  children,
  onSelect,
  checked,
  icon,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  checked?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <DropdownMenu.Item
      onSelect={(e) => {
        e.preventDefault();
        onSelect();
      }}
      className="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none select-none"
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked && <span className="text-primary shrink-0">✓</span>}
    </DropdownMenu.Item>
  );
}
