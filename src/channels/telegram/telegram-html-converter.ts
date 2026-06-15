const PLACEHOLDER_PREFIX = "\x00H";
const PLACEHOLDER_SUFFIX = "\x00";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function translateLatexToUnicode(latex: string): string {
  return latex
    .replace(/\\text\{([\s\S]*?)\}/g, "$1") // strip \text{...}
    .replace(/\\mathcal\{([\s\S]*?)\}/g, "$1") // strip \mathcal{...}
    .replace(/\\mathbb\{([\s\S]*?)\}/g, "$1") // strip \mathbb{...}
    .replace(/\\langle/g, "⟨") // math brackets
    .replace(/\\rangle/g, "⟩")
    .replace(/\\concat/g, " + ") // concat operator
    .replace(/\^\{\\circ\}/g, "°") // degrees ^{\circ}
    .replace(/\\circ/g, "°")
    .replace(/\\approx/g, "≈") // approximation
    .replace(/\\alpha/g, "α")
    .replace(/\\theta/g, "θ")
    .replace(/\\dots/g, "...")
    .replace(/\\cdot/g, "·")
    .replace(/\\in/g, "∈")
    .replace(/\\sum/g, "∑")
    .replace(/_\{?([a-zA-Z0-9\-_]+)\}?/g, "_$1") // simplify subscripts (e.g. h_t)
    .replace(/\^\{?([a-zA-Z0-9\-_]+)\}?/g, "^$1"); // simplify superscripts (e.g. R^V)
}

export function toTelegramHTML(input: string): string {
  if (!input) return input;

  const placeholders: string[] = [];
  const stash = (html: string): string => {
    placeholders.push(html);
    return `${PLACEHOLDER_PREFIX}${placeholders.length - 1}${PLACEHOLDER_SUFFIX}`;
  };

  let text = input;

  text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    const body = escapeHtml(code.replace(/\n$/, ""));
    if (lang) return stash(`<pre><code class="language-${lang}">${body}</code></pre>`);
    return stash(`<pre>${body}</pre>`);
  });

  text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));

  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    return stash(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
  });

  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const cleanMath = translateLatexToUnicode(math);
    return stash(`<pre>${escapeHtml(cleanMath.trim())}</pre>`);
  });

  text = text.replace(/(?<!\$)\$(?!\s)([^\$\n]+?)(?<!\s)\$(?!\$)/g, (_, math) => {
    const cleanMath = translateLatexToUnicode(math);
    return stash(`<code>${escapeHtml(cleanMath.trim())}</code>`);
  });

  text = escapeHtml(text);

  text = text.replace(/^[ \t]*[-_*]{3,}[ \t]*$/gm, "⎯⎯⎯");

  text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_, _hashes, content) => `<b>${content}</b>`);

  text = text.replace(/^(\s*)[-+*]\s+/gm, "$1• ");

  text = text.replace(/(^|[^*])\*\*([^*\n]+?)\*\*/g, "$1<b>$2</b>");
  text = text.replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<b>$2</b>");
  text = text.replace(/(^|[^_])__([^_\n]+?)__/g, "$1<b>$2</b>");
  text = text.replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, "$1<i>$2</i>");
  text = text.replace(/~~([^~\n]+?)~~/g, "<s>$1</s>");

  text = text.replace(/(^(?:&gt;[^\n]*\n?)+)/gm, (block) => {
    const lines = block
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => line.replace(/^&gt;\s?/, ""));
    return `<blockquote>${lines.join("\n")}</blockquote>\n`;
  });

  text = text.replace(new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "g"), (_, i) => placeholders[Number(i)]);

  return text;
}
