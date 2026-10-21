import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import katex from 'katex';
import DOMPurify from 'dompurify';

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        /* fall through */
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
  },
});

// ---------- 数学公式 ----------
function mathInline(state, silent) {
  const start = state.pos;
  if (state.src[start] !== '$') return false;
  if (state.src[start + 1] === '$') return false;
  const max = state.posMax;
  let pos = start + 1;
  while (pos < max) {
    const ch = state.src[pos];
    if (ch === '\n') return false;
    if (ch === '$' && state.src[pos - 1] !== '\\') break;
    pos += 1;
  }
  if (pos >= max) return false;
  const content = state.src.slice(start + 1, pos);
  if (!content.trim() || content.startsWith(' ') || content.endsWith(' ')) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = content;
    token.markup = '$';
  }
  state.pos = pos + 1;
  return true;
}

function mathBlock(state, startLine, endLine, silent) {
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  const maxPos = state.eMarks[startLine];
  const lineText = state.src.slice(startPos, maxPos).trim();
  if (!lineText.startsWith('$$')) return false;

  let content = '';
  let nextLine = startLine;
  const first = lineText.slice(2);
  if (first.endsWith('$$') && first.length > 2) {
    content = first.slice(0, -2);
  } else {
    content = first;
    nextLine += 1;
    let closed = false;
    while (nextLine < endLine) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineEnd = state.eMarks[nextLine];
      const text = state.src.slice(lineStart, lineEnd);
      const idx = text.indexOf('$$');
      if (idx >= 0) {
        content += '\n' + text.slice(0, idx);
        closed = true;
        break;
      }
      content += '\n' + text;
      nextLine += 1;
    }
    if (!closed) return false;
  }

  if (!silent) {
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = content.trim();
    token.markup = '$$';
    token.map = [startLine, nextLine + 1];
  }
  state.line = nextLine + 1;
  return true;
}

md.inline.ruler.after('escape', 'math_inline', mathInline);
md.block.ruler.after('blockquote', 'math_block', mathBlock, {
  alt: ['paragraph', 'reference', 'blockquote', 'list'],
});

md.renderer.rules.math_inline = (tokens, idx) => {
  try {
    return katex.renderToString(tokens[idx].content, {
      throwOnError: false,
      displayMode: false,
      output: 'htmlAndMathml',
    });
  } catch (e) {
    return `<code class="math-error">${escapeHtml(e.message)}</code>`;
  }
};

md.renderer.rules.math_block = (tokens, idx) => {
  try {
    return `<div class="math-block">${katex.renderToString(tokens[idx].content, {
      throwOnError: false,
      displayMode: true,
      output: 'htmlAndMathml',
    })}</div>`;
  } catch (e) {
    return `<pre class="math-error">${escapeHtml(e.message)}</pre>`;
  }
};

// ---------- Mermaid ----------
let renderDiagrams = [];
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = (token.info || '').trim().split(/\s+/)[0];
  if (info === 'mermaid') {
    renderDiagrams.push(token.content);
    return `<div class="mermaid" id="mermaid-${renderDiagrams.length - 1}"></div>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

// ---------- 任务列表 ----------
md.core.ruler.push('task_lists', (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (tokens[i].type !== 'list_item_open') continue;
    if (tokens[i + 1].type !== 'paragraph_open') continue;
    const inline = tokens[i + 2];
    if (!inline || inline.type !== 'inline') continue;
    const m = /^\[([ xX])\]\s+/.exec(inline.content);
    if (!m) continue;
    inline.content = inline.content.slice(m[0].length);
    if (inline.children && inline.children[0] && inline.children[0].type === 'text') {
      inline.children[0].content = inline.children[0].content.replace(/^\[([ xX])\]\s+/, '');
    }
    const checkbox = new state.Token('html_inline', '', 0);
    checkbox.content = `<input type="checkbox" class="task-checkbox" disabled${m[1].toLowerCase() === 'x' ? ' checked' : ''}> `;
    inline.children.unshift(checkbox);
    tokens[i].attrJoin('class', 'task-item');
  }
});

// ---------- 标题锚点 ----------
md.core.ruler.push('heading_ids', (state) => {
  const tokens = state.tokens;
  let index = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'heading_open') continue;
    index += 1;
    tokens[i].attrSet('id', `h-${index}`);
    if (tokens[i + 1] && tokens[i + 1].type === 'inline') {
      tokens[i + 1].attrSet('data-heading', 'true');
    }
  }
});

export function renderMarkdown(source) {
  renderDiagrams = [];
  const raw = md.render(source);
  const html = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_ATTR: ['target', 'align', 'checked', 'disabled'],
  });
  return { html, diagrams: renderDiagrams.slice() };
}
