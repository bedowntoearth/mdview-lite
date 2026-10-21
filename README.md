# MDView Lite

本地运行的 Markdown 阅读与编辑器，基于 Tauri 2 + WebView2。左侧编辑、右侧实时预览，支持数学公式、Mermaid 图表、目录导航与 PDF 导出。

## 功能

- **渲染**：GFM 表格、任务列表、引用、图片、链接、脚注式排版
- **代码高亮**：highlight.js，浅色/深色两套配色
- **数学公式**：`$...$` 行内、`$$...$$` 块级，KaTeX 渲染
- **图表**：` ```mermaid ` 代码块，支持 flowchart、sequence、gantt 等
- **实时编辑**：CodeMirror 6，输入后 120ms 防抖预览，编辑区与预览区滚动联动
- **目录**：自动提取 H1-H4，点击跳转，滚动高亮当前章节
- **导出 PDF**：打印样式处理了页边距、分页避让与表头重复
- **文件操作**：打开 / 保存 / 另存为，支持拖入 `.md` 文件与命令行传入路径
- **主题**：浅色、深色、跟随系统，选择会本地记忆
- **文件关联**：Windows 下可注册 `.md` / `.markdown` / `.mdx`

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Tauri 2（Rust）+ WebView2 |
| 编辑器 | CodeMirror 6 + `@codemirror/lang-markdown` |
| Markdown | markdown-it + DOMPurify |
| 公式 / 图表 | KaTeX、Mermaid |
| 代码高亮 | highlight.js |
| 构建 | Vite |

前端依赖全部打包进安装包，运行时不加载任何 CDN 资源。

## 开发

前置条件：

- Node.js 20 及以上
- Rust stable（rustup）
- Windows 上需要 MSVC 生成工具与 Windows SDK

```bash
npm install          # 安装前端依赖
npm run dev          # 仅启动前端（浏览器调试，原生对话框不可用）
npx tauri dev        # 启动桌面窗口（热更新）
npx tauri build      # 构建 exe 与 NSIS 安装包
```

产物位置：

- 可执行文件：`src-tauri/target/release/mdview-lite.exe`
- 安装包：`src-tauri/target/release/bundle/nsis/`

## 目录结构

```
index.html            页面骨架与工具栏
src/main.js           编辑器、渲染调度、文件操作、目录、主题
src/markdown.js       markdown-it 配置、公式插件、Mermaid 占位、标题锚点
src/style.css         布局、正文样式、代码配色、打印样式
src-tauri/src/main.rs Rust 命令：读写文件、启动参数、文件关联
src-tauri/tauri.conf.json 窗口、打包、文件关联声明
```

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+O` | 打开文件 |
| `Ctrl+S` | 保存 |
| `Ctrl+P` | 打印 / 导出 PDF |
| `Ctrl+E` | 切换编辑与阅读模式 |

## 文件关联

安装包会注册 ProgID 并写入 `.md` 关联。Windows 10/11 的默认应用保护可能仍把 `.md` 指向其他程序，此时点击工具栏「设为默认」，按提示在系统设置中选择 MDView Lite 即可。

便携版也可直接点击「关联 .md」在用户级注册，无需管理员权限。

## 许可

[MIT](LICENSE)
