/* Small, safe Markdown renderer (headings, lists, tables, quotes, code, inline styles).
 * All text is HTML-escaped before any markup is added, and only http(s)/mailto links are
 * emitted, so model output cannot inject script or attributes. Streaming-friendly: an
 * unclosed code fence renders as code to the end. Loaded as a classic script in the
 * renderer and as a CommonJS module in tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Markdown = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  function safeUrl(raw) {
    const url = raw.trim();
    return /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
  }

  function inline(text) {
    const codes = [];
    let s = text.replace(/`([^`\n]+)`/g, (_m, code) => {
      codes.push(`<code>${escapeHtml(code)}</code>`);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = escapeHtml(s);
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
      const url = safeUrl(href.replace(/&amp;/g, '&'));
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : m;
    });
    s = s.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[Number(i)]);
  }

  function codeBlock(lang, body) {
    const label = /^[\w+#.-]{1,20}$/.test(lang) ? lang : '';
    return (
      `<pre class="code"><div class="code-head"><span>${escapeHtml(label || 'code')}</span>` +
      `<button type="button" class="copy-btn" data-copy>Copy</button></div>` +
      `<code>${escapeHtml(body)}</code></pre>`
    );
  }

  const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  function render(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      const fence = /^\s*(`{3,})\s*([^`\s]*)\s*$/.exec(line);
      if (fence) {
        const mark = fence[1];
        const body = [];
        i += 1;
        while (i < lines.length && !new RegExp(`^\\s*\`{${mark.length},}\\s*$`).test(lines[i])) {
          body.push(lines[i]);
          i += 1;
        }
        i += 1; // closing fence (absent while streaming)
        out.push(codeBlock(fence[2], body.join('\n')));
        continue;
      }

      if (!line.trim()) {
        i += 1;
        continue;
      }

      const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        const level = Math.min(heading[1].length + 1, 6); // keep h1 for the page title
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        out.push('<hr>');
        i += 1;
        continue;
      }

      if (/^\s*>/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        out.push(`<blockquote>${render(quote.join('\n'))}</blockquote>`);
        continue;
      }

      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(cells(lines[i]));
          i += 1;
        }
        out.push(
          `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
            `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        );
        continue;
      }

      const bullet = /^\s*[-*+]\s+/;
      const numbered = /^\s*\d+[.)]\s+/;
      if (bullet.test(line) || numbered.test(line)) {
        const ordered = numbered.test(line);
        const marker = ordered ? numbered : bullet;
        const items = [];
        while (i < lines.length && marker.test(lines[i])) {
          items.push(inline(lines[i].replace(marker, '')));
          i += 1;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map((t) => `<li>${t}</li>`).join('')}</${tag}>`);
        continue;
      }

      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^\s*(`{3,}|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i])
      ) {
        para.push(lines[i]);
        i += 1;
      }
      if (para.length === 0) {
        para.push(lines[i]);
        i += 1;
      }
      out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }
    return out.join('\n');
  }

  return { render, escapeHtml };
});
