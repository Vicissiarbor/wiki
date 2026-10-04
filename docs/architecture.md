# 架构说明

## 目标与约束

| 约束 | 落地方式 |
| --- | --- |
| 首页只有"字母 + 链接"的索引和一个搜索框 | 单页复古目录：`<h2>A</h2>` + 一列链接，没有卡片、图标、下拉控件 |
| 支持精确搜索与正则 | 查询语法：`=名称`、`/表达式/`、默认包含匹配（见 [search-syntax.md](search-syntax.md)） |
| 只能用 GitHub Pages，不要服务器 | 纯静态：无后端、无写接口、无令牌；`web/` 目录即产物 |
| 内容靠 git 维护 | 唯一数据源 `web/data/entries.json`，改完提交即发布（见 [editing.md](editing.md)） |
| 全部使用相对路径 | 所有引用都是 `./…`；`tests/architecture.test.js` 有专门的守卫测试 |
| 可维护 | 纯函数核心 + 视图分离 + 170 个测试 + 架构守卫 |

## 分层

```
        ┌──────────────────────── 浏览器 ─────────────────────────┐
        │  ui/          视图：索引页、词条页、搜索框、状态行、路由   │
        │  app.js       组装层：读取 → 渲染 → 同步地址 → 快捷键      │
        │  config.js    站点配置（标题、数据路径，强制相对路径）      │
        │  data/        entries-store：读取 JSON + localStorage 缓存 │
        │  core/        纯逻辑：模型、集合、搜索、Markdown、首字母    │
        └──────────────────────────────────────────────────────────┘
                                   │
                            一个同源 JSON 文件
                        ./data/entries.json（提交在仓库里）
```

依赖方向单向：`ui → data → core`。`core/` 不依赖任何人，`data/` 只依赖 `core/`。

## 关键取舍

### 1. 为什么彻底去掉后端

早期版本带了一个零依赖的 Node 后端（REST + 静态托管 + git 提交），用于在网页上直接增删改。它被整体移除了：

- **风险**：对外提供写接口就要处理令牌、CORS、限流、备份、HTTPS 等一整套运维面；在未备案的服务器上还额外引入合规风险。换来的只是"手机上也能改"。
- **收益对比**：词条是长期沉淀的内容，更新频率低，git 提交完全够用，而且天然有历史、可回滚、可 diff。
- **代码量**：去掉后只剩一个数据源、一个存储层、几个视图模块，测试从 213 精简到 170，且不再需要假造服务器。

历史实现仍可在 git 里找到（`git log --all -- web/js/data/`），需要时可以恢复。

### 2. 为什么核心要"纯"

`tests/architecture.test.js` 扫描 `web/js/core` 与 `web/js/data`，一旦出现 `document.`、`window.`、`localStorage`、`node:fs` 或 `innerHTML =` 就失败。收益：

- 搜索、排序、校验、Markdown 渲染都能在 Node 里直接测，不需要浏览器；
- 浏览器专属的东西集中在 `ui/` 与 `util/storage.js`；
- 将来换界面（甚至换框架）时，`core/` 一行不用改。

### 3. 为什么专门为"相对路径"写守卫

站点发布在 `https://<用户名>.github.io/<仓库名>/` 这样的子路径下，以后还可能换仓库名或绑自定义域名。任何 `/assets/...` 这种根绝对路径在子路径下都会 404。

因此：

- 代码里所有 import、HTML 里所有 `href`/`src`、`config.json` 里的数据路径都必须是相对路径；
- `tests/architecture.test.js` 逐文件校验（import 必须以 `.` 开头，HTML 属性必须是 `./`/`../`/`#`，不允许 `fetch('http…')`，`data.url` 必须是相对路径）；
- `config.js` 运行时兜底：如果 `data.url` 被写成绝对地址，会忽略它并在页面顶部给出黄色提示。

### 4. 为什么用 `#/` 哈希路由

GitHub Pages 没有服务端重写能力，无法把 `/e/entropy` 映射到 `index.html`。所以状态放在 `#` 后面，两种地址都能直接分享，刷新也不会 404：

- `#/?q=熵` —— 一次搜索；
- `#/e/entropy` —— 某个词条。

写回地址用 `history.replaceState`（它不会触发 `hashchange`）；只有它不可用时才退化成 `location.hash = …`，并用一次性的 `expectEcho` 标记吃掉自己触发的那次事件。早期版本用"当前值是否等于上次写入值"来判断，会把用户"点回上一个地址"误判成自己的回声——那是一个真实的 bug，现在有测试覆盖。

### 5. 数据为什么是一个 JSON 文件

- 索引页只需一次请求，几百到几千条都是即时渲染；
- 手工可编辑、diff 友好，`git log` 就是词条的完整历史；
- 不需要构建步骤把数据编译成别的格式；
- 加载是**宽容**的：单条坏数据会被跳过并在页面上报告，不会让整页空白。

### 6. 复古风格怎么实现

- 单色 + 衬线字体（Georgia / 宋体），经典下划线链接，分隔线用 `<hr>` 和 `border-bottom`；
- 保留 `visited` 链接颜色（现代框架常抹掉它，但那是"目录页"的关键手感）；
- 没有圆角、阴影、动效、暗色模式，统一的老式观感；
- 命中文字用 `<mark>` 高亮——唯一保留的"现代"细节，因为检索时确实有用。

## 一次查询的流程

```
用户输入
  └─ search-box 的 input 事件 → app.setQuery
      └─ core/search.parseQuery：识别 =精确 / /正则/ / 字段前缀
          └─ searchEntries：按字段权重打分排序（含时间预算与结果上限）
              └─ index-view：渲染字母标题 + 链接（命中处 <mark>）
                  └─ router.sync → 地址栏变成 #/?q=…

点击链接（或按 Enter 打开首条结果）
  └─ 地址栏变成 #/e/<id> → hashchange → parseHash → renderEntry
      └─ entry-view：标题 / 别名 / 标签 / Markdown 正文 / 上下条导航
```

## 模块地图

| 文件 | 职责 |
| --- | --- |
| `web/js/boot.js` | 页面入口，捕获启动失败并显示原因 |
| `web/js/app.js` | 组装：状态、渲染调度、路由、快捷键（不含业务规则） |
| `web/js/config.js` | 配置默认值 / 合并 / 校验，强制相对路径 |
| `web/js/data/entries-store.js` | 读取 `./data/entries.json`、localStorage 缓存、先画后刷、过期响应丢弃 |
| `web/js/core/entry.js` | 词条模型、字段上限、唯一性校验、id 生成 |
| `web/js/core/collection.js` | 文档格式（读宽容 / 写严格）、集合索引 |
| `web/js/core/search.js` | 查询解析、字段权重、匹配、高亮区间、正则安全阀 |
| `web/js/core/initials.js` + `pinyin-table.js` | 首字母（中文按拼音） |
| `web/js/core/sort.js` | A–Z 分桶与排序（`Intl.Collator`，中文按拼音） |
| `web/js/core/markdown.js` | 安全的最小 Markdown 渲染器 |
| `web/js/ui/index-view.js` | 索引页渲染（字母 + 链接 + `<mark>`） |
| `web/js/ui/entry-view.js` | 词条页渲染（含 `[[词条]]` 解析与上下条） |
| `web/js/ui/search-box.js` | 输入框 + 查找按钮 + 提示行（无模式下拉） |
| `web/js/ui/router.js` | `#/` 与 `#/e/<id>` 的解析、写回、分享链接 |
| `web/js/ui/status.js` | 加载 / 警告 / 错误的一行反馈 |
| `web/js/ui/dom.js` | `el()` 等 DOM 小工具（无框架） |
| `web/js/util/storage.js` | localStorage 包装（缓存用，失败自动退化为内存） |

## 扩展点

| 想做的事 | 改哪里 |
| --- | --- |
| 改标题 / 标语 / 数据路径 | `web/config.json` |
| 加字段（如"来源"） | `core/entry.js` 的 `ENTRY_KEYS` + `normalizeEntry`，再在 `entry-view.js` 显示 |
| 支持更多 Markdown 语法 | `core/markdown.js`，并在 `tests/markdown.test.js` 补用例 |
| 索引排成多列 | `web/assets/style.css` 里的 `.terms` |
| 换首字母规则 | `core/initials.js`（表来自 `tools/gen_pinyin_table.py`） |
| 恢复网页编辑 | `git log --all -- web/js/data/` 找历史实现（会重新引入令牌与外部接口风险） |

## 测试策略

| 层次 | 文件 | 关注点 |
| --- | --- | --- |
| 单元 | `entry` `collection` `initials` `search` `markdown` `config` `util` | 规则与边界：重名、超长、正则、注入、转义、多音字 |
| 集成 | `entries-store` | 读取、缓存、先画后刷、坏数据跳过、404、非法 JSON、过期响应 |
| 整页 | `ui`（jsdom，真实 `index.html`） | 字母分组与链接、三种搜索、高亮、词条页、`[[词条]]`、上下条、深链、注入防护、快捷键 |
| 守卫 | `architecture` `data-files` | 核心纯度、相对路径、只读约束、示例数据与页面外壳的有效性 |

运行：`npm test`（Node 内置测试运行器，无需测试框架）。