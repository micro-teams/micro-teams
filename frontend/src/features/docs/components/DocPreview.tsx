// Rendered markdown, with any ```mermaid blocks turned into diagrams.
//
// The mermaid pass has to run AFTER the HTML is in the DOM, and again whenever it changes, because
// dangerouslySetInnerHTML re-inserts the raw code blocks each time. Both shells were doing that
// dance themselves, with slightly different dependency lists.
import { useEffect, useRef } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { renderMermaidIn } from "@/lib/mermaid";
import { cn } from "@/lib/utils";

export function DocPreview({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const html = renderMarkdown(content);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void renderMermaidIn(ref.current);
  }, [html]);

  return (
    <div
      ref={ref}
      className={cn("doc-preview", className)}
      // The team's own document, and renderMarkdown sanitizes it.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
