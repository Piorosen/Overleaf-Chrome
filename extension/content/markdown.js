// Overleaf AI — minimal, safe Markdown → HTML for report output.
// Everything is HTML-escaped first; only a small whitelist of constructs is rendered.
// "L42" / "L42-L45" / "L42–45" become <a class="lref" data-line="42" data-end="45">.
(function (root) {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function inline(text) {
    // Protect inline code first.
    const codes = [];
    let s = text.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = esc(s);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s("'])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?"']|$)/g, '$1<em>$2</em>');
    // URLs first (protected), so "https://x.org/L42" is not split into a line link; placeholders
    // (\u0000) never become part of a URL.
    const urls = [];
    s = s.replace(/(https?:\/\/[^\s<>()"'\u0000]+[^\s<>()"'.,;:!?\u0000])/g, (m) => { urls.push(m); return `\u0001${urls.length - 1}\u0001`; });
    s = s.replace(/\bL(\d{1,6})(?:\s*[-–~]\s*L?(\d{1,6}))?\b/g, (m, a, b) => `<a class="lref" href="#" data-line="${a}"${b ? ` data-end="${b}"` : ''}>${m}</a>`);
    s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => `<a href="${urls[Number(i)]}" target="_blank" rel="noopener noreferrer">${urls[Number(i)]}</a>`);
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[Number(i)])}</code>`);
    return s;
  }

  function isTableSep(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
  }
  function cells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  }

  function renderMarkdown(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    let para = [];
    const flush = () => {
      if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; }
    };
    while (i < lines.length) {
      const line = lines[i];
      const fence = /^\s*```(\w*)\s*$/.exec(line);
      if (fence) {
        flush();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(`<pre class="code" data-lang="${esc(fence[1] || '')}"><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      const h = /^\s*(#{1,6})\s+(.*)$/.exec(line);
      if (h) { flush(); out.push(`<h4 class="h${h[1].length}">${inline(h[2])}</h4>`); i++; continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
      if (/\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flush();
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        flush();
        const ordered = /\d/.test(li[2]);
        const items = [];
        while (i < lines.length) {
          const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          const depth = m && m[1].length >= 2 ? 1 : 0;
          if (m && depth === 0 && /\d/.test(m[2]) !== ordered) break; // list type changed
          if (m) { items.push({ depth, text: m[3] }); i++; continue; }
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1].text += ` ${lines[i].trim()}`; i++; continue; }
          break;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map((it) => `<li${it.depth ? ' class="sub"' : ''}>${inline(it.text)}</li>`).join('')}</${tag}>`);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        flush();
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`);
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      para.push(line);
      i++;
    }
    flush();
    return out.join('\n');
  }

  // Extract the first fenced block of a language (e.g. bibtex) for "copy" buttons.
  function codeBlocks(md, lang) {
    const re = /```(\w*)\s*\n([\s\S]*?)\n```/g;
    const out = [];
    let m;
    while ((m = re.exec(String(md || '')))) if (!lang || m[1].toLowerCase() === lang) out.push(m[2]);
    return out;
  }

  const api = { renderMarkdown, codeBlocks, escapeHtml: esc };
  root.OLAI_MD = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
