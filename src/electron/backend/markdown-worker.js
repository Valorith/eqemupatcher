const { parentPort } = require("node:worker_threads");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeMarkdownHref(href) {
  const normalized = String(href || "").trim().replace(/&amp;/g, "&");
  if (!normalized) {
    return "#";
  }

  if (/^https?\/\//i.test(normalized)) {
    return normalized.replace(/^https?(?=\/\/)/i, (scheme) => `${scheme}:`);
  }

  if (/^(https?:\/\/)/i.test(normalized)) {
    return normalized;
  }

  if (/^(#|\/|\.\/|\.\.\/)/.test(normalized)) {
    return normalized;
  }

  return "#";
}

function renderInlineMarkdown(value) {
  let rendered = escapeHtml(value);
  rendered = rendered.replace(/`([^`]+)`/g, "<code>$1</code>");
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  rendered = rendered.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => `<a href="${escapeHtml(sanitizeMarkdownHref(href))}">${label}</a>`);
  return rendered;
}

function getListIndentWidth(value) {
  return String(value || "").replace(/\t/g, "  ").length;
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").split("\n").map((line) => line.replace(/\r$/, ""));
  const html = [];
  let inCode = false;
  const listStack = [];

  const closeLists = (targetIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1] > targetIndent) {
      html.push("</li></ul>");
      listStack.pop();
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      closeLists();
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (listItem) {
      const indent = getListIndentWidth(listItem[1]);
      const content = renderInlineMarkdown(listItem[2]);

      if (!listStack.length) {
        html.push("<ul>");
        listStack.push(indent);
        html.push(`<li>${content}`);
        continue;
      }

      const currentIndent = listStack[listStack.length - 1];
      if (indent > currentIndent) {
        html.push("<ul>");
        listStack.push(indent);
        html.push(`<li>${content}`);
        continue;
      }

      if (indent === currentIndent) {
        html.push("</li>");
        html.push(`<li>${content}`);
        continue;
      }

      closeLists(indent);
      if (listStack.length && listStack[listStack.length - 1] === indent) {
        html.push("</li>");
        html.push(`<li>${content}`);
      } else {
        html.push("<ul>");
        listStack.push(indent);
        html.push(`<li>${content}`);
      }
      continue;
    }

    if (/^>\s+/.test(line)) {
      closeLists();
      html.push(`<blockquote>${renderInlineMarkdown(line.replace(/^>\s+/, ""))}</blockquote>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeLists();
      html.push("<hr>");
      continue;
    }

    if (!line.trim()) {
      closeLists();
      continue;
    }

    closeLists();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeLists();
  if (inCode) {
    html.push("</code></pre>");
  }

  return html.join("\n");
}

parentPort.on("message", (markdown) => {
  try {
    parentPort.postMessage({ html: markdownToHtml(markdown) });
  } catch (error) {
    parentPort.postMessage({ error: error.message || "Unable to parse markdown." });
  }
});
