# 上线指南（只用 GitHub Pages）

本站是纯静态站点：没有后端、没有数据库、没有写接口，因此**没有备案问题**，也没有需要长期维护的服务。上线只有一件事——把 `web/` 目录发布出去。

- [1. 五分钟上线](#1-五分钟上线)
- [2. 访问地址长什么样](#2-访问地址长什么样)
- [3. 以后怎么更新词条](#3-以后怎么更新词条)
- [4. 自定义域名（可选）](#4-自定义域名可选)
- [5. 本地预览](#5-本地预览)
- [6. 常见故障排查](#6-常见故障排查)
- [7. 上线检查清单](#7-上线检查清单)

---

## 1. 五分钟上线

```bash
cd searchLADR
git remote add origin git@github.com:<用户名>/<仓库名>.git
git push -u origin main
```

然后打开仓库的 **Settings → Pages → Build and deployment**：

- **Source** 选 **GitHub Actions**（推荐）；
- 推送 `main` 后，`.github/workflows/pages.yml` 会自动把 `web/` 作为制品发布；
- 在 **Actions** 标签能看到进度，**Settings → Pages** 会显示站点地址。

### 两种发布方式

| 方式 | 怎么做 | 说明 |
| --- | --- | --- |
| **GitHub Actions**（推荐） | Source 选 “GitHub Actions” | 站点留在 `web/`，仓库结构和文档都保持整齐；`web/.nojekyll` 已就位，GitHub 不会做任何预处理 |
| 分支目录 | 把 `web/` 改名 `docs/`，Source 选 “Deploy from a branch → main → /docs” | 完全不依赖 Actions；代价是目录名叫 `docs/`，会和文档目录混在一起 |

两种方式都只是"原样托管静态文件"，没有构建步骤、没有 Jekyll、没有博客生成器。

### 前置条件

- 仓库需要是 **public**（Free 计划下 Pages 一般只为公开仓库发布；私有仓库发布通常需要 Pro 及以上——以 GitHub 当前文档为准）；
- 首次发布后等 30–60 秒再刷新页面。

---

## 2. 访问地址长什么样

| 情况 | 地址 |
| --- | --- |
| 仓库名就是 `<用户名>.github.io`（账号主站点） | `https://<用户名>.github.io/` |
| 普通仓库（项目站点，最常见） | `https://<用户名>.github.io/<仓库名>/` |
| 绑定自定义域名后 | `https://<你的域名>/` |

**子路径不影响任何功能**：页面内所有引用都是相对路径（`./assets/style.css`、`./js/boot.js`、`./data/entries.json`），所以 `https://<用户名>.github.io/<仓库名>/` 这种地址可以直接工作。这一点由 `tests/architecture.test.js` 强制保证，不靠人工注意。

页面内的两种地址都是哈希路由，可以直接分享：

- `https://<用户名>.github.io/<仓库名>/#/?q=熵` —— 一次搜索；
- `https://<用户名>.github.io/<仓库名>/#/e/entropy` —— 某个词条。

---

## 3. 以后怎么更新词条

只有一条路：**改 `web/data/entries.json` 并提交**。详见 [editing.md](editing.md)。

```bash
# 1. 编辑词条
$EDITOR web/data/entries.json
# 2. 本地检查（可选，但推荐）
npm test
# 3. 提交并推送
git commit -am "content(entries): add 熵"
git push
```

推送后 Pages 会在几十秒内重建，所有设备刷新即可看到新内容（页面用 `cache: 'no-cache'` 重新校验，不会拿到旧缓存）。

---

## 4. 自定义域名（可选）

1. 在仓库 **Settings → Pages → Custom domain** 填入域名；
2. 在域名服务商处添加 CNAME 记录指向 `<用户名>.github.io`；
3. 等 DNS 生效后勾选 **Enforce HTTPS**。

Actions 方式下，把 `CNAME` 文件放在 `web/CNAME`（内容只有域名一行，文件名无扩展名），它会随站点一起发布。

一个容易踩的坑：如果你给**账号主站点**（`<用户名>.github.io`）绑了自定义域名，那么同账号下项目站点的 `github.io` 地址会被重定向到该域名，需要给每个项目站点也绑定同一域名，否则会 404。参见 [About custom domains and GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages)。

---

## 5. 本地预览

```bash
npm run preview          # http://127.0.0.1:8080/   （tools/serve.js，仅开发用）
# 或者用任意静态服务器：
cd web && python3 -m http.server 8000
```

`tools/serve.js` 只有读取能力（没有任何写接口），而且**不会**出现在部署里——Pages 发布的是 `web/` 目录。

不要用 `file://` 直接双击 `index.html`：浏览器会因为 CORS 拒绝加载 ES 模块，页面会显示"页面无法启动"。

---

## 6. 常见故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 一直显示"正在读取词条…" | `data/entries.json` 请求失败。看页面上的红色提示，并用开发者工具的 Network 面板确认它返回 200 |
| 提示 `找不到词条文件 …（HTTP 404）` | 路径大小写不对，或文件没提交、没推送 |
| 提示 `不是合法的 JSON` | 手工编辑时多了/少了逗号或引号；用 `node -e "JSON.parse(require('fs').readFileSync('web/data/entries.json','utf8'))"` 定位 |
| 提示"有 N 条词条格式不对，已跳过" | 那几条缺少 `name`、`id` 格式不对或 id 重复；`npm test` 会给出具体位置 |
| 提示"不是相对路径" | `config.json` 里的 `data.url` 写成了绝对地址；本站约定只用相对路径 |
| 推送后页面还是旧的 | 等 Pages 的 Actions 跑完，再强制刷新（Ctrl/Cmd+Shift+R） |
| 公式显示成灰底的 TeX 原文 | KaTeX 没加载成功（`assets/katex/` 没提交或被拦）。检查该目录是否存在，或看控制台的加载报错 |
| 界面语言不对/切换后没变 | 默认语言在 `web/config.json` 的 `site.defaultLocale`；访问者的选择存在自己浏览器的 localStorage（清除站点数据即可回到默认） |
| 打开页面显示"页面无法启动" | 多半是用 `file://` 打开的，改用 `npm run preview` 或 Pages 地址 |
| 中文首字母不对（如"重庆"跑到 Z） | 逐字查表无法判断多音字；给该词条加 `"initial": "C"` 覆盖 |
| 正则查询提示"灾难性回溯" | 表达式里有 `(a+)+`、`(a\|a)+`、`.*.*` 这类会指数级回溯的写法，改写为 `a+` 等安全形式（见 [search-syntax.md](search-syntax.md)） |
| 手机上打开很慢 | Pages 走海外 CDN，速度取决于线路；数据只有一个 JSON，已经是最省的做法 |

---

## 7. 上线检查清单

- [ ] `npm test` 全绿（248 个测试）
- [ ] `web/data/entries.json` 已换成自己的词条，且 JSON 能解析
- [ ] Pages 的 Source 已设置，Actions 里部署成功
- [ ] 用 `https://<用户名>.github.io/<仓库名>/` 打开，索引能显示
- [ ] 三种搜索写法都试过：`熵`、`=熵`、`/^熵/`
- [ ] 点开一个词条，正文、别名、标签、上下条导航都正常
- [ ] 用手机打开同一个地址，能查、能点
- [ ] （可选）自定义域名 + Enforce HTTPS 已生效
- [ ] 把"怎么加词条"的步骤记在自己的备忘里（[editing.md](editing.md)）