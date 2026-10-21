import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import mermaid from 'mermaid';
import { renderMarkdown } from './markdown.js';
import './style.css';
import 'katex/dist/katex.min.css';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const SAMPLE = `# MDView Lite 使用说明

这是一个自用的 Markdown 阅读与编辑工具：编辑、预览、目录、公式、图表、导出 PDF。

## 基本用法

- 拖入 \`.md\` 文件，或点「打开」
- 左侧编辑，右侧实时预览，滚动联动
- \`Ctrl+S\` 保存，\`Ctrl+P\` 导出 PDF

> 文件只在本地读写，不上传任何内容。

## 代码高亮

\`\`\`javascript
function greet(name) {
  return \`你好，\${name}\`;
}
\`\`\`

## 数学公式

行内公式 $E = mc^2$，块公式：

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

## 图表

\`\`\`mermaid
flowchart LR
  A[编写 Markdown] --> B[实时预览]
  B --> C{导出}
  C -->|PDF| D[打印]
  C -->|保存| E[.md]
\`\`\`

## 表格与任务

| 功能 | 状态 |
| --- | --- |
| 实时预览 | 已支持 |
| 数学公式 | 已支持 |

- [x] 支持 GFM
- [ ] 后续再加更多能力
`;

const els = {
  editor: document.getElementById('editor'),
  preview: document.getElementById('preview'),
  previewPane: document.getElementById('preview-pane'),
  editorPane: document.getElementById('editor-pane'),
  splitter: document.getElementById('splitter'),
  tocPanel: document.getElementById('toc-panel'),
  tocList: document.getElementById('toc-list'),
  docTitle: document.getElementById('doc-title'),
  statusFile: document.getElementById('status-file'),
  statusWords: document.getElementById('status-words'),
  statusHint: document.getElementById('status-hint'),
  fileInput: document.getElementById('file-input'),
  themeSelect: document.getElementById('theme-select'),
  btnEdit: document.getElementById('btn-edit'),
  btnToc: document.getElementById('btn-toc'),
  btnAssoc: document.getElementById('btn-assoc'),
};

const state = {
  path: null,
  name: '未命名',
  dirty: false,
  theme: localStorage.getItem('mdlite-theme') || 'system',
  editMode: localStorage.getItem('mdlite-edit') !== '0',
  tocOpen: localStorage.getItem('mdlite-toc') === '1',
  split: Number(localStorage.getItem('mdlite-width') || '0') || 0,
};

const themeCompartment = new Compartment();
let editorView = null;
let renderTimer = 0;
let mermaidSeq = 0;

/* ---------------- 主题 ---------------- */

function systemDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function effectiveDark() {
  return state.theme === 'dark' || (state.theme === 'system' && systemDark());
}

function applyTheme() {
  const dark = effectiveDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (editorView) {
    editorView.dispatch({ effects: themeCompartment.reconfigure(dark ? oneDark : []) });
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: 'inherit',
  });
  renderPreview(false);
}

/* ---------------- 编辑区 ---------------- */

function createEditor(doc) {
  const updateListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    markDirty(true);
    scheduleRender();
    updateWordCount(update.state.doc.toString());
  });

  editorView = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        themeCompartment.of(effectiveDark() ? oneDark : []),
        updateListener,
        keymap.of([]),
      ],
    }),
    parent: els.editor,
  });

  editorView.scrollDOM.addEventListener('scroll', () => {
    const el = editorView.scrollDOM;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    const ratio = el.scrollTop / max;
    const target = els.previewPane;
    target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
  });
}

function setDoc(path, text) {
  state.path = path;
  state.name = path ? path.split(/[\\/]/).pop() : '未命名';
  const doc = text ?? '';
  if (editorView) {
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: doc },
    });
  }
  markDirty(false);
  updateTitle();
  updateWordCount(doc);
  els.statusFile.textContent = path || '未保存';
  renderPreview(true);
}

function markDirty(value) {
  if (state.dirty === value) return;
  state.dirty = value;
  updateTitle();
}

function updateTitle() {
  const suffix = state.dirty ? ' •' : '';
  els.docTitle.textContent = `${state.name}${suffix}`;
  document.title = `${state.name}${suffix} — MDView Lite`;
}

/* ---------------- 渲染 ---------------- */

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderPreview(false), 120);
}

async function renderPreview(force) {
  const source = editorView ? editorView.state.doc.toString() : '';
  const { html, diagrams } = renderMarkdown(source);
  els.preview.innerHTML = html;

  // mermaid 占位符填充源码
  els.preview.querySelectorAll('.mermaid').forEach((el) => {
    const idx = Number((el.id || '').replace('mermaid-', ''));
    el.textContent = Number.isFinite(idx) ? diagrams[idx] || '' : '';
    el.removeAttribute('id');
  });

  const seq = ++mermaidSeq;
  const nodes = els.preview.querySelectorAll('.mermaid');
  if (nodes.length) {
    try {
      await mermaid.run({ nodes });
    } catch (err) {
      if (seq === mermaidSeq) {
        console.warn('mermaid render failed', err);
        els.preview.querySelectorAll('.mermaid').forEach((el) => {
          if (!el.querySelector('svg')) {
            el.classList.add('mermaid-error');
            el.textContent = `图表渲染失败：${err?.message || err}`;
          }
        });
      }
    }
  }
  if (seq !== mermaidSeq) return;

  buildToc();
  if (force) els.previewPane.scrollTop = 0;
}

/* ---------------- 目录 ---------------- */

function buildToc() {
  const headings = [...els.preview.querySelectorAll('h1, h2, h3, h4')];
  els.tocList.innerHTML = '';
  if (!headings.length) {
    els.tocList.innerHTML = '<div class="toc-empty">文档暂无标题</div>';
    return;
  }
  headings.forEach((h) => {
    const link = document.createElement('a');
    link.className = `toc-item level-${h.tagName.toLowerCase()}`;
    link.textContent = h.textContent;
    link.href = `#${h.id}`;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    els.tocList.appendChild(link);
  });

  if (window.__tocObserver) window.__tocObserver.disconnect();
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        els.tocList.querySelectorAll('.toc-item').forEach((a) => {
          a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
        });
      });
    },
    { root: els.previewPane, rootMargin: '0px 0px -70% 0px', threshold: 0 }
  );
  headings.forEach((h) => observer.observe(h));
  window.__tocObserver = observer;
}

/* ---------------- 状态与计数 ---------------- */

function updateWordCount(text) {
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length;
  els.statusWords.textContent = `${cjk + words} 词`;
}

/* ---------------- 文件操作 ---------------- */

async function openFile() {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] }],
    });
    if (!selected || typeof selected !== 'string') return;
    try {
      const text = await invoke('read_text', { path: selected });
      setDoc(selected, text);
      els.statusHint.textContent = '';
    } catch (err) {
      els.statusHint.textContent = `打开失败：${err}`;
    }
    return;
  }
  els.fileInput.value = '';
  els.fileInput.click();
}

async function openPath(path) {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const text = await invoke('read_text', { path });
    setDoc(path, text);
    els.statusHint.textContent = '';
  } catch (err) {
    els.statusHint.textContent = `打开失败：${err}`;
  }
}

async function saveFile(forceDialog) {
  const text = editorView ? editorView.state.doc.toString() : '';
  if (!isTauri) {
    downloadText(state.name || 'untitled.md', text);
    markDirty(false);
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  let path = state.path;
  if (!path || forceDialog) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const selected = await save({
      defaultPath: state.path || 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (!selected) return;
    path = selected;
  }
  try {
    await invoke('write_text', { path, contents: text });
    state.path = path;
    state.name = path.split(/[\\/]/).pop();
    markDirty(false);
    updateTitle();
    els.statusFile.textContent = path;
    els.statusHint.textContent = '已保存';
    setTimeout(() => (els.statusHint.textContent = ''), 1500);
  } catch (err) {
    els.statusHint.textContent = `保存失败：${err}`;
  }
}

function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.md') ? name : `${name}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- 文件关联 ---------------- */

async function refreshAssoc() {
  if (!isTauri) {
    els.btnAssoc.disabled = true;
    els.btnAssoc.title = '桌面版可用';
    return;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const registered = await invoke('registration_status');
    const isDefault = await invoke('association_status');
    if (isDefault) {
      els.btnAssoc.textContent = '已关联';
      els.btnAssoc.classList.add('active');
      els.btnAssoc.title = '点击取消 .md 关联';
    } else if (registered) {
      els.btnAssoc.textContent = '设为默认';
      els.btnAssoc.classList.remove('active');
      els.btnAssoc.title = '打开“打开方式”窗口，选择 MDView Lite 并勾选始终使用';
    } else {
      els.btnAssoc.textContent = '关联 .md';
      els.btnAssoc.classList.remove('active');
      els.btnAssoc.title = '把 .md 默认用本应用打开';
    }
  } catch (err) {
    console.warn('association status failed', err);
  }
}

async function toggleAssoc() {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const isDefault = await invoke('association_status');
    const registered = await invoke('registration_status');

    if (isDefault) {
      if (!window.confirm('取消 .md 文件关联？')) return;
      await invoke('uninstall_association');
      els.statusHint.textContent = '已取消 .md 关联';
      await refreshAssoc();
      return;
    }

    if (!registered) {
      await invoke('install_association');
    }

    await invoke('open_default_settings');
    els.statusHint.textContent = '已注册。请在系统设置中找到 .md，选择 MDView Lite 作为默认应用';
    await refreshAssoc();
  } catch (err) {
    els.statusHint.textContent = `关联操作失败：${err}`;
  }
}

async function loadInitialFile() {
  if (!isTauri) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke('initial_file');
    if (!path) return;
    const text = await invoke('read_text', { path });
    setDoc(path, text);
    els.statusHint.textContent = '';
  } catch (err) {
    els.statusHint.textContent = `打开失败：${err}`;
  }
}

/* ---------------- 交互 ---------------- */

function setEditMode(on) {
  state.editMode = on;
  localStorage.setItem('mdlite-edit', on ? '1' : '0');
  document.body.classList.toggle('preview-only', !on);
  els.btnEdit.classList.toggle('active', on);
  els.btnEdit.textContent = on ? '编辑' : '阅读';
  if (editorView) editorView.requestMeasure();
}

function setTocOpen(on) {
  state.tocOpen = on;
  localStorage.setItem('mdlite-toc', on ? '1' : '0');
  document.body.classList.toggle('toc-open', on);
  els.btnToc.classList.toggle('active', on);
}

function applySplit() {
  if (!state.split) return;
  els.editorPane.style.flexBasis = `${state.split}%`;
}

function bindSplitter() {
  let dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    const rect = els.previewPane.parentElement.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.min(78, Math.max(22, pct));
    state.split = clamped;
    els.editorPane.style.flexBasis = `${clamped}%`;
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging');
    localStorage.setItem('mdlite-width', String(Math.round(state.split)));
  };
  els.splitter.addEventListener('pointerdown', (e) => {
    dragging = true;
    document.body.classList.add('dragging');
    els.splitter.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', stop);
}

function bindDragDrop() {
  if (isTauri) {
    import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
      getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload?.type === 'drop') {
          const path = (event.payload.paths || []).find((p) => /\.(md|markdown|mdx|txt)$/i.test(p));
          if (path) openPath(path);
        }
      });
    });
    return;
  }
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDoc(null, String(reader.result || ''));
    reader.readAsText(file, 'utf-8');
  });
}

function bindUI() {
  document.getElementById('btn-open').addEventListener('click', openFile);
  document.getElementById('btn-save').addEventListener('click', () => saveFile(false));
  document.getElementById('btn-save-as').addEventListener('click', () => saveFile(true));
  document.getElementById('btn-print').addEventListener('click', () => window.print());
  els.btnEdit.addEventListener('click', () => setEditMode(!state.editMode));
  els.btnToc.addEventListener('click', () => setTocOpen(!state.tocOpen));
  els.btnAssoc.addEventListener('click', toggleAssoc);
  document.getElementById('toc-close').addEventListener('click', () => setTocOpen(false));

  els.themeSelect.value = state.theme;
  els.themeSelect.addEventListener('change', () => {
    state.theme = els.themeSelect.value;
    localStorage.setItem('mdlite-theme', state.theme);
    applyTheme();
  });

  window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener('change', () => {
    if (state.theme === 'system') applyTheme();
  });

  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDoc(null, String(reader.result || ''));
    reader.readAsText(file, 'utf-8');
  });

  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openFile();
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveFile(false);
    } else if (e.key.toLowerCase() === 'p') {
      e.preventDefault();
      window.print();
    } else if (e.key.toLowerCase() === 'e') {
      e.preventDefault();
      setEditMode(!state.editMode);
    }
  });

  bindSplitter();
  bindDragDrop();
}

/* ---------------- 启动 ---------------- */

applySplitLazy();
createEditor(SAMPLE);
applyTheme();
bindUI();
setEditMode(state.editMode);
setTocOpen(state.tocOpen);
refreshAssoc();
loadInitialFile();
els.statusFile.textContent = isTauri ? '未打开文件' : '浏览器预览模式';
els.statusHint.textContent = isTauri ? '拖入 .md 文件即可打开' : '拖入或选择 .md 文件即可阅读';
updateWordCount(SAMPLE);

function applySplitLazy() {
  if (state.split) {
    els.editorPane.style.flexBasis = `${state.split}%`;
  }
}

export {};
