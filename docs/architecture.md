# 架构说明

## 目标与约束

| 需求 | 落地方式 |
| --- | --- |
| 输入概念名 → 输出词条 | 单页应用：搜索框 + 结果列表 + 详情面板 |
| 精确搜索 | `=名字` 前缀或界面上的「精确」模式（名称/别名全等，忽略大小写与全半角） |
| 正则搜索 | `/表达式/flags` 或界面上的「正则」模式，带长度上限、时间预算与回溯拦截 |
| 首页搜索框 + 首字母排序列表 | 空查询即浏览模式：按首字母（中文按拼音）分组排序；`#` 桶收纳数字与符号开头 |
| 只能用传统三件套、不能用博客生成器 | `web/` 就是产物：原生 ES 模块 + 一份 CSS + 一个 HTML，无构建、无 CDN、无框架 |
| 多设备查找 | 静态 JSON 天然共享；后端模式则所有设备读写同一份文件 |
| 支持直接增删改 | 四种数据源插件，其中三种可写（本地 / GitHub / 自建后端） |
| 可维护的代码 | 纯核心 + 视图隔离 + 213 个测试 + 架构守卫测试 |

## 分层

```
        ┌────────────────────────── 浏览器 ──────────────────────────┐
        │  ui/        视图：只碰 DOM，不含业务规则                    │
        │  app.js     组装层：状态、路由、快捷键、错误横幅            │
        │  config.js  配置：默认值 < config.json < 本机 localStorage   │
        │  data/      数据源插件 + 仓库（缓存/乐观更新/冲突/串行化）   │
        │  core/      纯逻辑：模型、集合、搜索、Markdown、首字母、排序 │
        └─────────────────────────────────────────────────────────────┘
                                  │  同一套 core/ 直接被 Node 后端 import
        ┌────────────────────────── Node 后端 ────────────────────────┐
        │  server/lib/store.js   文件存储 + 原子写 + 修订号 + git 提交 │
        │  server/lib/api.js     REST 路由                            │
        │  server/lib/static.js  同源托管 web/（避免混合内容与 CORS）  │
        └─────────────────────────────────────────────────────────────┘
```

依赖方向是单向的：`ui → data → core`，`server → core`。`core/` 不依赖任何人。

## 关键取舍

### 1. 为什么核心要「纯」

`tests/architecture.test.js` 会扫描 `web/js/core` 与 `web/js/data`，一旦出现 `document.`、`window.`、`localStorage`、`node:fs` 或 `innerHTML =` 就失败。收益：

- **一份校验规则**：网页和服务器用同一个 `assertValidEntry`，不可能出现「前端能存、后端拒绝」；
- **可以直接在 Node 里测**：213 个测试里绝大部分不需要浏览器；
- **换框架不用重写逻辑**：将来要上 Vue/React，`core/` 一行不改。

浏览器专属的东西（localStorage、计时器、DOM）都在 `util/`、`ui/`，或用参数注入（`storage`、`fetchImpl`）。

### 2. 为什么数据源是插件

四种数据源的差异很大（只读文件 / 浏览器本地 / GitHub Contents API / 自建 REST），但界面与仓库层只认四个方法：

```js
{ id, label, writable, load(), createEntry(entry, ctx), updateEntry(entry, ctx), deleteEntry(id, ctx) }
```

`ctx` 里带着当前集合与修订号，所以既能实现「整份文件重写」（GitHub、本地），也能实现「补丁式写入」（REST）。新增后端只需在 `data/registry.js` 加一个分支。

### 3. 为什么数据是「一个 JSON 文件」

- GitHub Pages 只能读文件，一个文件 = 一次请求，刷新快；
- 后端写文件可以用「临时文件 + rename」做到原子替换；
- git diff 友好，`git log web/data/entries.json` 就是词条的完整历史；
- 冲突用内容哈希当修订号 + `If-Match` 检测，比拆分多个文件更容易推理。

代价：整体导入/导出是整份文件级别的（所以有 `<文件>.bak` 与导出功能兜底）。

### 4. 为什么用 hash 路由

GitHub Pages 项目站点是 `https://user.github.io/repo/`，没有服务端重写能力，`history.pushState` 的深层路径刷新会 404。因此状态都放在 `#`（形如 `#/?q=%E7%84%93&mode=exact&e=entropy`），可以直接分享给手机：

- `#/?q=熵` 分享一次搜索；
- `#/?e=entropy` 直达某个词条；
- `#/?letter=S` 分享首字母视图。

### 5. 写入的可靠性

`data/repository.js` 负责：

- **先画后刷**：先渲染 localStorage 缓存（体感即时），再请求网络；
- **乐观更新 + 回滚**：先在内存里应用改动，失败则恢复旧快照并把错误抛给编辑器；
- **写串行化**：`enqueueWrite` 保证两次快速保存不会交错；
- **过期响应丢弃**：`refreshToken` 保证慢的旧请求不会覆盖新数据；
- **冲突可视化**：409 → `ConflictError` → 界面提示「数据已被其他设备修改」。

### 6. 安全

| 面 | 处理 |
| --- | --- |
| Markdown 注入 | 先 HTML 转义再套规则；生成片段用占位符隔离，链接只允许 `http/https/mailto` 与相对地址；`tests/ui.test.js` 用 jsdom 验证「词条里写 `<script>` 不会产生任何元素」 |
| 正则 DoS | 查询长度上限、每次匹配输入截断、`(a+)+`/`(a\|a)+`/`.*.*` 等回溯形状直接拒绝、整轮搜索 400 ms 预算 |
| 令牌泄露 | 令牌只存本机 localStorage；`config.json` 里出现令牌会被明确警告；README 强调不要把令牌提交进仓库 |
| 后端鉴权 | `Bearer` 令牌，常数时间比较，同一 IP 连续失败会限流；未配置令牌时写接口整体降级为 403 只读 |
| 路径穿越 | 静态托管在解码后做前缀校验，越界返回 400 |
| 头部 | `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY` |

## 请求时序（后端模式的一次编辑）

```
用户点保存
  └─ 编辑器校验（core/entry.js inspectEntry）
      └─ repository.saveEntry：本地先应用（乐观）
          └─ rest-source.updateEntry → PUT /api/entries/{id}
                 headers: Authorization: Bearer …   If-Match: <revision>
              └─ server: 读文件 → 校验（同一份 core）→ 原子写 + 可选 git 提交
                    └─ 200 { entries, revision } → 仓库用服务器返回的快照替换本地
                    └─ 409 → ConflictError → 回滚并提示刷新
```

## 扩展点

| 想做的事 | 改哪里 |
| --- | --- |
| 换标题/默认搜索模式 | `web/config.json` |
| 加字段（如「来源」） | `core/entry.js` 的 `ENTRY_KEYS` + `normalizeEntry` + 编辑器字段 + 详情视图 |
| 支持 Markdown 表格之外的语法 | `core/markdown.js`，并在 `tests/markdown.test.js` 补用例 |
| 新增数据源（如 Cloudflare KV） | `data/` 加一个工厂 + `data/registry.js` 注册 + 设置面板文案 |
| 换后端语言 | 实现 [api.md](api.md) 的六个接口即可，前端不用改 |
| 改首字母规则 | `core/initials.js`（表来自 `tools/gen_pinyin_table.py`） |

## 测试策略

| 层次 | 文件 | 关注点 |
| --- | --- | --- |
| 单元 | `entry` `collection` `initials` `search` `markdown` `config` `util` `http` | 规则与边界（重名、超长、正则、注入、转义） |
| 集成 | `repository` | 缓存、乐观更新、回滚、串行化、过期响应、数据源切换 |
| 后端 | `server-store` `server-api` | 原子写、修订号冲突、鉴权、限流形状、静态托管、路径穿越、CORS 预检 |
| 整页 | `ui`（jsdom） | 真实 `index.html` + 真实模块：分组渲染、搜索、首字母筛选、详情、编辑器、深链、注入防护、快捷键 |
| 守卫 | `architecture` `data-files` | 核心纯度、依赖方向、示例数据与配置文件的有效性 |

运行：`npm test`（Node 内置测试运行器，无需测试框架）。