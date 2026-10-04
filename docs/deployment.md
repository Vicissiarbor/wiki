# 上线与排障

站点是纯静态的：没有后端、没有数据库，上线只是把 `web/` 目录发布出去。

## 1. 发布

```bash
git remote add origin git@github.com:<用户名>/<仓库名>.git
git push -u origin main
```

仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**；
`main` 一推送，`.github/workflows/pages.yml` 就会发布 `web/`。
访问 `https://<用户名>.github.io/<仓库名>/`。

想不用 Actions：把 `web/` 改名 `docs/`，Source 选 “Deploy from a branch → main → /docs”。

前置条件：仓库需要是 public（Free 计划下 Pages 只为公开仓库发布）。

## 2. 地址

| 情况 | 地址 |
| --- | --- |
| 仓库名就是 `<用户名>.github.io` | `https://<用户名>.github.io/` |
| 普通仓库（项目站点） | `https://<用户名>.github.io/<仓库名>/` |
| 绑定自定义域名后 | `https://<你的域名>/` |

页面内所有引用都是相对路径，放在任意子路径下都能用。词条页与搜索结果都有可分享的地址：
`…/#/e/complexNumber`、`…/#/?q=熵`。

## 3. 自定义域名（可选）

1. 仓库 Settings → Pages → Custom domain 填域名；
2. 域名服务商处加 CNAME 记录指向 `<用户名>.github.io`；
3. 勾选 Enforce HTTPS。

Actions 方式下把只有域名一行的 `CNAME` 文件放在 `web/CNAME`，会随站点一起发布。
注意：若给账号主站点绑了自定义域名，同账号下项目站点的 `github.io` 地址会一起重定向过去，
需要给每个项目站点也绑定同一域名，否则 404。

## 4. 更新词条

改 `web/data/entries.json` → `npm test` → `git commit && git push`。
Pages 几十秒内重建，刷新即可（页面用 `cache: 'no-cache'` 重新校验，不会拿到旧缓存）。

## 5. 本地预览

```bash
npm run preview          # http://127.0.0.1:8080/
# 或者任意静态服务器：
cd web && python3 -m http.server 8000
```

`tools/serve.js` 只用于本地预览，不参与部署。不要用 `file://` 打开 `index.html`。

## 6. 排障

| 现象 | 处理 |
| --- | --- |
| 一直显示“正在读取词条…”/ 找不到词条文件 | 确认 `web/data/entries.json` 已提交并推送；注意文件名大小写 |
| 提示不是合法的 JSON / 有词条被跳过 | 手工编辑的语法或字段有问题，跑 `npm test` 会指出位置 |
| 推送后页面还是旧的 | 等 Pages 的 Actions 跑完，再强制刷新 |
| 页面显示“页面无法启动” | 多半是用 `file://` 打开的，改用 `npm run preview` 或 Pages 地址 |
| 公式显示成灰底的 TeX 原文 | KaTeX 没加载成功：确认 `web/assets/katex/` 已提交 |
| 中文首字母不对（如“重庆”跑到 Z） | 逐字查表无法判断多音字，给该词条加 `"initial": "C"`（中文界面用 `initialZh`） |
| 界面语言不是预期的 | 默认语言在 `web/config.json` 的 `site.defaultLocale`；访问者的选择存在自己浏览器里 |
| 手机上打开很慢 | Pages 走海外 CDN，速度取决于线路 |

## 7. 上线检查

- [ ] `npm test` 全绿（248 个测试）
- [ ] `web/data/entries.json` 是自己的词条，且 JSON 能解析
- [ ] Pages 的 Source 已设置，Actions 部署成功
- [ ] 索引能显示；三种搜索（`熵`、`=熵`、`/^熵/`）都能用
- [ ] 点开一个词条，正文、别名、标签、公式、上下条导航正常
- [ ] 页头切换 English / 中文，整页跟着变
- [ ] 手机打开同一地址能查、能点