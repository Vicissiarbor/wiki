# SearchLADR · 概念词条库

输入一个概念的名字，查到它的词条。名字和词条由你自己维护。

- **纯静态站点**：只有 HTML + CSS + 原生 JS（ES 模块），**没有构建步骤**，没有打包器，没有 CDN，可以直接放到 GitHub Pages。
- **查询方式**：包含匹配（默认）、精确匹配（`=名字`）、正则表达式（`/表达式/`），可限定字段（`tag:物理`、`content:/定理/`）。
- **首页**：搜索框 + 按首字母排序的索引列表（中文按拼音首字母，如「熵 → S」）。
- **多设备**：同一份 `web/data/entries.json`，任何设备打开网页都能查。
- **可编辑**：四种数据源可切换——只读 JSON、本地编辑、GitHub 仓库、自建后端（`server/`，零依赖 Node 服务，专门为那台没备案的 aliyun 小服务器准备）。
- **可维护**：纯函数核心 + 数据源插件 + 211 个自动化测试（含 jsdom 整页集成测试）。

---

## 快速开始

### 1. 本地预览静态站点（30 秒）

```bash
git clone <your-repo> searchLADR && cd searchLADR
node server/index.js --port 8787 --static-root web --data web/data/entries.json --read-only
# 打开 http://127.0.0.1:8787/
```

或者用任意静态服务器（注意：必须通过 HTTP 打开，`file://` 下浏览器会拒绝加载 ES 模块）：

```bash
cd web && python3 -m http.server 8000   # 然后访问 http://127.0.0.1:8000/
```

### 2. 换成你自己的词条

编辑 `web/data/entries.json`（格式见 [docs/data-format.md](docs/data-format.md)），或在网页上点「新增词条」（需要先切到可写数据源，见 [docs/editing.md](docs/editing.md)）。

### 3. 跑测试

```bash
npm install   # 只装 jsdom，测试用；部署的网站不需要任何依赖
npm test
```

### 4. 上线

完整步骤见 **[docs/deployment.md](docs/deployment.md)**，两种组合任选：

| 方案 | 需要什么 | 适合 |
| --- | --- | --- |
| A. 只用 GitHub Pages（推荐先做） | 一个仓库 | 查询到处可用；编辑用「本地编辑 + 导出 JSON 提交」或浏览器里填 GitHub 令牌直接提交 |
| B. Pages 查询 + aliyun 后端编辑 | 小服务器 + 一个端口 | 想在网页上直接增删改，且改动立刻对全设备生效 |
| C. 只用 aliyun 服务器 | 小服务器 | 不想用 GitHub；后端顺便把前端一起托管（同源，最省事） |

> 注意：**国内未备案的服务器不能用域名解析 80/443**，所以方案 B/C 都使用高端口（例如 `8787`、`8443`），并用 IP + 端口访问。HTTPS 页面调用 HTTP 接口会被浏览器按「混合内容」拦截，`docs/deployment.md` 里给了三种解法。

---

## 目录结构

```
web/                     静态站点（GitHub Pages 发布的就是这个目录）
  index.html             唯一页面：搜索框 + 首字母索引 + 列表 + 详情
  config.json            站点配置（标题、默认数据源、后端地址；**不要放令牌**）
  js/
    boot.js              页面入口
    app.js               组装层：把仓库、视图、路由、快捷键接起来
    config.js            配置加载与优先级（默认 < config.json < 本机设置）
    core/                纯逻辑，浏览器与 Node 后端共用（无 DOM、无网络）
      entry.js           词条模型与校验
      collection.js      词条集合与 JSON 文档格式
      search.js          查询解析与匹配（含正则安全阀）
      markdown.js        安全的最小 Markdown 渲染器
      initials.js        首字母/拼音首字母
      pinyin-table.js    自动生成（pypinyin → 紧凑查表）
      sort.js            排序与 A-Z 分组
      errors.js          错误类型
    data/                数据源插件（同一接口的四种实现）
      repository.js      缓存、乐观更新、回滚、写串行化
      json-source.js     只读 JSON
      local-source.js    localStorage 本地编辑
      github-source.js   GitHub Contents API（浏览器内直接提交）
      rest-source.js     自建后端
      http.js            请求、错误翻译（CORS/混合内容/超时）
    ui/                  视图层（只负责 DOM）
    util/                计时与存储小工具
  data/entries.json      词条数据（唯一数据源）
  assets/css/main.css    样式（含深色模式、响应式、打印样式）
server/                  可选的零依赖 Node 后端（REST + 静态托管 + git 提交）
tools/                   生成脚本（拼音首字母表）
tests/                   211 个测试：单元、集成、HTTP、jsdom 整页
docs/                    架构、数据格式、搜索语法、编辑方式、部署、API
```

## 设计要点

- **无构建步骤**：`web/` 目录即产物，改完直接刷新浏览器。模块用原生 ES import，测试用 Node 内置测试运行器。
- **核心与界面分离**：`core/`、`data/` 里不出现 `document`/`window`/`localStorage`（`tests/architecture.test.js` 会强制检查），所以同一套校验规则同时用于浏览器和后端，永远不会出现「网页能存、服务器拒绝」。
- **数据源可插拔**：任何后端都只需实现 `load/createEntry/updateEntry/deleteEntry` 四个方法。
- **冲突可感知**：每次写入携带修订号（`If-Match`），旧修订写入会得到 409，而不是静默覆盖另一台设备的修改。
- **安全默认**：Markdown 先转义再渲染，链接只允许 `http/https/mailto` 与相对地址；正则查询有长度上限、时间预算与灾难性回溯拦截；后端未配置令牌时自动降级为只读。

细节见 [docs/architecture.md](docs/architecture.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/deployment.md](docs/deployment.md) | 上线步骤：GitHub Pages、aliyun 服务器、HTTPS、systemd、备份、常见故障 |
| [docs/editing.md](docs/editing.md) | 四种编辑方式对比、令牌安全、冲突处理 |
| [docs/data-format.md](docs/data-format.md) | JSON 结构与字段规则 |
| [docs/search-syntax.md](docs/search-syntax.md) | 搜索语法与正则安全说明 |
| [docs/architecture.md](docs/architecture.md) | 分层、模块图、关键取舍 |
| [docs/api.md](docs/api.md) | 自建后端 REST API |

## 许可

MIT（见 `LICENSE`）。拼音首字母表由 [pypinyin](https://github.com/mozillazg/python-pinyin)（MIT）生成，`tools/gen_pinyin_table.py` 保留了完整的再生成方式。