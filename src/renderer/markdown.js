// Minimal Markdown renderer + HTML sanitizer for project descriptions (untrusted input).

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

export function markdown(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara();
      flushList();
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flushPara();
      flushList();
      const lvl = Math.min(m[1].length + 1, 4);
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
    } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (list !== type) {
        flushList();
        out.push(`<${type}>`);
        list = type;
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara();
      flushList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push('<hr>');
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else if (/^\s*</.test(line)) {
      flushPara();
      flushList();
      out.push(line);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join('\n');
}

const ALLOWED = new Set(
  'a b strong i em u del s p br hr h1 h2 h3 h4 h5 h6 ul ol li blockquote code pre img table thead tbody tr td th span div center details summary sup sub small iframe'.split(' '),
);
const ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'align']);

export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const walk = (node) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED.has(tag)) {
        if (['script', 'style', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta'].includes(tag)) child.remove();
        else child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const val = attr.value.trim();
        if (!ATTRS.has(name)) child.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src') && !/^(https?:|data:image\/)/i.test(val)) child.removeAttribute(attr.name);
      }
      if (tag === 'a') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      if (tag === 'img') child.setAttribute('loading', 'lazy');
      if (tag === 'iframe') {
        const src = child.getAttribute('src') || '';
        const yt = /youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/.exec(src);
        if (!yt) {
          child.remove();
          continue;
        }
        child.setAttribute('src', `https://www.youtube-nocookie.com/embed/${yt[1]}`);
        child.setAttribute('width', '560');
        child.setAttribute('height', '315');
      }
      walk(child);
    }
  };
  walk(doc.body.firstChild);
  return doc.body.firstChild.innerHTML;
}
