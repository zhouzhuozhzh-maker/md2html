export interface HtmlDocumentOptions {
  title?: string;
}

type ListKind = "ul" | "ol";

const defaultStyle = `
:root {
  color-scheme: light;
  --bg: #f7f8fa;
  --text: #1f2933;
  --muted: #596579;
  --border: #d8dee8;
  --code-bg: #eef2f7;
  --link: #0b66c3;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.65;
}

main {
  max-width: 860px;
  margin: 0 auto;
  padding: 48px 24px 72px;
  background: #fff;
  min-height: 100vh;
  box-sizing: border-box;
}

h1, h2, h3, h4, h5, h6 {
  line-height: 1.25;
  margin: 1.6em 0 0.65em;
}

h1 {
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3em;
}

p, ul, ol, pre, blockquote {
  margin: 0 0 1em;
}

a {
  color: var(--link);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
}

img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

code {
  background: var(--code-bg);
  border-radius: 4px;
  padding: 0.15em 0.35em;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
}

pre {
  overflow-x: auto;
  background: #111827;
  color: #e5e7eb;
  border-radius: 8px;
  padding: 16px;
}

pre code {
  background: transparent;
  color: inherit;
  padding: 0;
}

blockquote {
  border-left: 4px solid var(--border);
  color: var(--muted);
  padding-left: 1em;
}
`.trim();

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listKind: ListKind | null = null;
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];
  let blockquote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listKind) {
      return;
    }
    html.push(`</${listKind}>`);
    listKind = null;
  };

  const flushBlockquote = () => {
    if (blockquote.length === 0) {
      return;
    }
    html.push(`<blockquote>${blockquote.map((line) => `<p>${renderInline(line)}</p>`).join("")}</blockquote>`);
    blockquote = [];
  };

  const flushBlocks = () => {
    flushParagraph();
    flushBlockquote();
    flushList();
  };

  for (const line of lines) {
    const fence = line.match(/^```([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      if (inCodeBlock) {
        const langClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
        html.push(`<pre><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        codeLanguage = "";
        inCodeBlock = false;
      } else {
        flushBlocks();
        inCodeBlock = true;
        codeLanguage = fence[1] ?? "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushBlocks();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blockquote.push(quote[1]);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushBlockquote();
      const nextKind: ListKind = unordered ? "ul" : "ol";
      if (listKind !== nextKind) {
        flushList();
        html.push(`<${nextKind}>`);
        listKind = nextKind;
      }
      html.push(`<li>${renderInline((unordered ?? ordered)![1].trim())}</li>`);
      continue;
    }

    flushBlockquote();
    flushList();
    paragraph.push(line.trim());
  }

  if (inCodeBlock) {
    const langClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
    html.push(`<pre><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushBlocks();

  return html.join("\n");
}

export function renderHtmlDocument(markdown: string, options: HtmlDocumentOptions = {}): string {
  const title = options.title ?? "Markdown Document";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
${defaultStyle}
  </style>
</head>
<body>
  <main>
${markdownToHtml(markdown)}
  </main>
</body>
</html>
`;
}

function renderInline(value: string): string {
  let html = escapeHtml(value);

  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_match, alt, src, title) => {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr}>`;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_match, text, href, title) => {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
  });

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return html;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
