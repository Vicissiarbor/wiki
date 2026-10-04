# SearchLADR · 概念词条库

输入一个概念的名字，查到它的词条；也可以直接翻 A–Z 索引。词条由你自己维护。

界面是复古的目录页：一列字母标题，下面是一列链接，加一个搜索框。

```
A
  abandon
  aport
B
  banana
```

- **纯静态**：原生 HTML + CSS + ES 模块，**没有构建步骤**、没有框架、没有 CDN、没有后端、没有数据库。
- **查询**：包含匹配（默认）、精确匹配（`=名字`）、正则表达式（`/表达式/`），可加字段前缀（`tag:物理`、`content:/定理/`）。
- **索引**：按首字母分组排序，中文按拼音（`熵 → S`），`#` 桶放数字与符号开头。
- **公式**：词条正文里用 `$…$` / `$$…$$` 写 KaTeX（仓库内自带，不依赖 CDN，只在出现公式的页面才加载）。
- **内容维护**：改 `web/data/entries.json` 并提交（见 [docs/editing.md](docs/editing.md)）。站点只读，没有任何写接口、令牌或服务器。
- **多设备**：同一份提交到仓库的 JSON，任何设备打开网页都能查。

---

## 快速开始

```bash
npm install        # 只装 jsdom，测试用；站点本身零依赖
npm test           # 212 个测试
npm run preview    # http://127.0.0.1:8080/
```

> 必须通过 HTTP(S) 打开（`npm run preview` 或 GitHub Pages）。用 `file://` 直接双击 `index.html` 时，浏览器会拒绝加载 ES 模块。

换成自己的词条：编辑 `web/data/entries.json`（格式见 [docs/data-format.md](docs/data-format.md)），刷新页面即可。改完提交前建议跑一次 `npm test`。

---

## 上线（只用 GitHub Pages）

本项目只依赖 GitHub Pages，不需要服务器，因此不涉及备案，也没有任何对外接口。

1. 推到 GitHub：

   ```bash
   git remote add origin git@github.com:<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

2. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
   `.github/workflows/pages.yml` 会把 `web/` 原样发布（无构建、无 Jekyll、无生成器）。

3. 访问 `https://<你的用户名>.github.io/<仓库名>/`，手机上打开同一个地址即可查询。

> 想不用 Actions：把 `web/` 改名为 `docs/`，Pages 里选 **Deploy from a branch → main → /docs**。两条路都只是原样托管静态文件。

所有资源引用都是相对路径（`./assets/style.css`、`./js/boot.js`、`./data/entries.json`），因此放在任意子路径下都能工作；`tests/architecture.test.js` 会强制检查这一点。换域名、换仓库名、以后搬到自己的域名下都不需要改代码。

细节（自定义域名、两种发布方式的差异、故障排查、上线检查清单）见 [docs/deployment.md](docs/deployment.md)。

---

## 目录结构

```
web/                     站点本体（GitHub Pages 发布的就是这个目录）
  index.html             唯一页面：标题 + 搜索框 + 索引/词条容器
  config.json            站点配置（标题、标语、数据路径；不含任何机密）
  404.html               找不到页面时的兜底页
  data/entries.json      全部词条（唯一数据源）
  assets/style.css       手写样式（单色、衬线、分隔线）
  assets/favicon.svg
  assets/katex/          内置 KaTeX 0.17.0（min.js + min.css + woff2 字体 + 许可）
  js/
    boot.js              页面入口
    app.js               组装层：读取、渲染、路由、快捷键
    config.js            配置加载与校验（强制相对路径）
    data/entries-store.js 读取 data/entries.json + localStorage 缓存
    core/                纯逻辑，无 DOM / 无网络
      entry.js           词条模型与校验
      collection.js      词条集合与文档格式
      search.js          查询解析与匹配（含正则安全阀）
      initials.js        首字母（中文取拼音）
      pinyin-table.js    自动生成的拼音首字母表
      sort.js            排序与 A–Z 分组
      markdown.js        安全的最小 Markdown 渲染器
      errors.js
    ui/                  视图层：索引、词条页、搜索框、状态行、路由、公式渲染、DOM 小工具
    util/storage.js      localStorage 包装（缓存用）
tools/
  serve.js               本地预览用的静态服务器（仅开发用，不参与部署）
  gen_pinyin_table.py    重新生成拼音首字母表
tests/                   212 个测试：单元、集成、jsdom 整页、架构与数据守卫
docs/                    数据格式、搜索语法、编辑方式、部署、架构
```

## 设计要点

- **没有构建步骤**：`web/` 就是产物。改完直接刷新浏览器；发布就是 `git push`。
- **核心与界面分离**：`core/`、`data/` 里不出现 `document`/`window`/`localStorage`（`tests/architecture.test.js` 强制检查），所以搜索、排序、校验、Markdown 全部可以在 Node 里直接测。
- **只读**：没有写请求、没有令牌、没有服务器，站点的外部面只有"读取一个同源 JSON 文件"。
- **安全默认**：Markdown 先转义再渲染，链接只允许 `http/https/mailto` 与相对地址；公式交给 KaTeX 时关掉了 `trust`（禁止 `\href` 之类的 HTML 能力）；正则查询有长度上限、输入截断、灾难性回溯拦截与时间预算。
- **零维护元数据**：页脚的「更新于」从词条数组里取最新日期，不需要手动维护任何时间戳；时间写 `2026-10-04` 这种只到日的格式即可。
- **可分享**：`#/?q=熵` 是一次搜索，`#/e/entropy` 是一个词条，直接发给手机就能打开。

细节见 [docs/architecture.md](docs/architecture.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/deployment.md](docs/deployment.md) | 上线：GitHub Pages 两种发布方式、自定义域名、故障排查、检查清单 |
| [docs/editing.md](docs/editing.md) | 怎么加 / 改 / 删词条（git 流程） |
| [docs/data-format.md](docs/data-format.md) | JSON 结构与字段规则 |
| [docs/search-syntax.md](docs/search-syntax.md) | 搜索语法与正则安全说明 |
| [docs/architecture.md](docs/architecture.md) | 分层、模块图、关键取舍 |

## 许可

MIT（见 `LICENSE`）。

第三方资源（都随仓库分发，不使用 CDN）：

- 拼音首字母表由 [pypinyin](https://github.com/mozillazg/python-pinyin)（MIT）生成，`tools/gen_pinyin_table.py` 保留了完整的再生成方式；
- 数学公式由 [KaTeX](https://katex.org/) 0.17.0（MIT）渲染，见 `web/assets/katex/NOTICE.md`（含只保留 woff2 字体、如何升级的说明）。