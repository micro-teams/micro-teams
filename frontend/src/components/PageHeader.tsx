import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sticky page header. On phones it hugs the top safe area; an optional back
 * button sits on the left, actions on the right.
 *
 * Back always pops the real history stack (navigate(-1)) so it returns to
 * wherever you actually came from — no matter which path led here. The only
 * exception is a fresh load straight onto this page (no in-app history, e.g. a
 * reload or a deep link): there's nothing to pop, so we go to [backFallback].
 */
export function PageHeader({
  title,
  back,
  backFallback,
  actions,
  className,
}: {
  title: ReactNode;
  /** Show a back button. */
  back?: boolean;
  /** Where to go when there is no history to pop (reload / deep link). */
  backFallback?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  function goBack() {
    // key === "default" means this is the first history entry in this session.
    if (location.key === "default")
      navigate(backFallback ?? "/", { replace: true });
    else navigate(-1);
  }
  return (
    <header
      className={cn(
        "bg-background/80 sticky top-0 z-30 border-b backdrop-blur",
        "pt-[env(safe-area-inset-top)]",
        className,
      )}
    >
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-3">
        {back && (
          <button
            type="button"
            onClick={goBack}
            className="text-muted-foreground hover:text-foreground -ml-1 flex size-9 shrink-0 items-center justify-center rounded-md"
            aria-label="back"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
          {title}
        </h1>
        {actions && (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        )}
      </div>
    </header>
  );
}
