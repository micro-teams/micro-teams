// One markdown → sanitized-HTML renderer, shared by the phone FilePage and the
// desktop DocEditor so both previews render identically. Content is a team's own
// document, but we sanitize anyway (defence in depth against a pasted <script>).
// Pair the output with the `.doc-preview` styles in index.css.
import { marked } from "marked";
import DOMPurify from "dompurify";

export function renderMarkdown(md: string): string {
  const html = marked.parse(md ?? "", { async: false, gfm: true }) as string;
  return DOMPurify.sanitize(html);
}
