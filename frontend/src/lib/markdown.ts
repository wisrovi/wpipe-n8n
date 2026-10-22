import { marked } from "marked";

/**
 * Configure marked options for GitHub Flavored Markdown (GFM).
 */
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Configure custom renderer for Mermaid diagrams
const renderer = new marked.Renderer();
const origCode = renderer.code.bind(renderer);
renderer.code = function (token: any) {
  const text = typeof token === "object" ? token.text : arguments[0];
  const lang = typeof token === "object" ? token.lang : arguments[1];
  if (lang === "mermaid") {
    return `<div class="mermaid my-4 flex justify-center bg-[#181818] p-4 rounded-xl border border-[#3c3c3c] overflow-x-auto text-sky-200">${text}</div>`;
  }
  return origCode(token);
};
marked.use({ renderer });

/**
 * Renders Markdown into rich, clean HTML styled for VS Code / GitHub previews,
 * including GitHub-style alert callouts ([!IMPORTANT], [!NOTE], [!WARNING], [!TIP]).
 */
export function renderMarkdown(md: string): string {
  if (!md) return "";

  // Pre-process GitHub alerts before standard Markdown parsing
  const processed = md.replace(
    />\s*\[!(IMPORTANT|NOTE|WARNING|TIP|CAUTION)\][ \t]*\n((?:>.*\n?)*)/gi,
    (_match, type, content) => {
      const cleanContent = content
        .split("\n")
        .map((line: string) => line.replace(/^>[ \t]?/, ""))
        .join("\n");
      const innerHtml = marked.parse(cleanContent, { gfm: true, breaks: true }) as string;
      const upper = type.toUpperCase();

      let border = "border-purple-500 bg-purple-950/30 text-purple-200 border-l-4";
      let icon = "⚡";
      let label = "AVISO IMPORTANTE";

      if (upper === "NOTE") {
        border = "border-sky-500 bg-sky-950/30 text-sky-200 border-l-4";
        icon = "ℹ️";
        label = "NOTA INFORMATIVA";
      } else if (upper === "TIP") {
        border = "border-emerald-500 bg-emerald-950/30 text-emerald-200 border-l-4";
        icon = "💡";
        label = "CONSEJO";
      } else if (upper === "WARNING" || upper === "CAUTION") {
        border = "border-amber-500 bg-amber-950/30 text-amber-200 border-l-4";
        icon = "⚠️";
        label = "ADVERTENCIA";
      }

      return `\n<div class="vscode-callout ${border} p-4 my-4 rounded-xl shadow-lg backdrop-blur-sm">
        <div class="font-bold flex items-center gap-2 text-xs mb-2 tracking-wider uppercase">
          <span>${icon}</span>
          <span>${label}</span>
        </div>
        <div class="text-xs leading-relaxed opacity-95 font-sans space-y-1">
          ${innerHtml}
        </div>
      </div>\n`;
    }
  );

  return marked.parse(processed, { gfm: true, breaks: true }) as string;
}
