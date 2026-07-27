// Turn the ```mermaid fenced code blocks in a rendered doc preview into SVG.
//
// The markdown pipeline (renderMarkdown) is marked → DOMPurify → innerHTML, which
// leaves a ```mermaid block as <pre><code class="language-mermaid">…</code></pre>.
// This runs AFTER that HTML is in the DOM: it finds those blocks and swaps each for
// the diagram mermaid draws from its text.
//
// Mermaid is big (hundreds of KB), so it is imported dynamically and ONLY when a
// preview actually contains a diagram — a doc with no diagrams never pays for it,
// and the library lands in its own lazy chunk instead of the main bundle.
//
// mermaid.render is async and a fast-typing editor preview re-renders constantly, so
// each pass carries a token; a stale pass (superseded before it finished) throws its
// result away instead of writing into a container that has since moved on.

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid(dark: boolean) {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      // startOnLoad off — we drive rendering ourselves. securityLevel 'strict' makes
      // mermaid sanitize the diagram text (defence in depth; the doc is already the
      // team's own, and renderMarkdown sanitized the surrounding HTML).
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "default",
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let renderSeq = 0;

/**
 * Render every ```mermaid block inside `container` in place. Safe to call on every
 * content change; a no-op (and no mermaid import) when the container has no diagrams.
 */
export async function renderMermaidIn(
  container: HTMLElement | null,
): Promise<void> {
  if (!container) return;
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>("code.language-mermaid"),
  );
  if (blocks.length === 0) return;

  const token = ++renderSeq;
  const dark = document.documentElement.classList.contains("dark");
  let mermaid: Awaited<ReturnType<typeof loadMermaid>>;
  try {
    mermaid = await loadMermaid(dark);
  } catch {
    return; // could not load the library — leave the code block as-is
  }
  if (token !== renderSeq) return; // superseded while importing

  for (let i = 0; i < blocks.length; i++) {
    const code = blocks[i];
    // The <pre> wrapping the <code> is what we replace with the diagram.
    const pre = code.closest("pre") ?? code;
    const source = code.textContent ?? "";
    const id = `mermaid-${token}-${i}`;
    try {
      const { svg } = await mermaid.render(id, source);
      if (token !== renderSeq) return; // superseded mid-loop
      const figure = document.createElement("div");
      figure.className = "mermaid-diagram";
      figure.innerHTML = svg;
      pre.replaceWith(figure);
    } catch (err) {
      if (token !== renderSeq) return;
      // A malformed diagram must never blank the page: show the error inline and
      // keep the original source visible below it.
      const note = document.createElement("div");
      note.className = "mermaid-error";
      note.textContent = `mermaid: ${err instanceof Error ? err.message : String(err)}`;
      pre.before(note);
    }
  }
}
