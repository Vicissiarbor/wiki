# 后端 HTTP API

`server/index.js` 提供的小型 REST 接口。零依赖，只有一个 JSON 数据文件。

- 基地址：`http://<host>:<port>`（默认端口 `8787`）
- 读取公开；写入需要 `Authorization: Bearer <LADR_TOKEN>`
- 所有响应都是 JSON，除静态资源外

## 接口一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | 否 | 服务与数据文件状态 |
| `GET` | `/api/entries` | 否 | 取整份词条文档（含 `revision`） |
| `POST` | `/api/entries` | 是 | 新增一个词条 |
| `PUT` | `/api/entries/{id}` | 是 | 覆盖某个词条 |
| `DELETE` | `/api/entries/{id}` | 是 | 删除某个词条 |
| `POST` | `/api/entries/import` | 是 | 整体替换（备份恢复用） |
| `GET` | `/*` | 否 | `--static-root` 指定的前端目录（默认 `web/`） |

写入请求可以带 `If-Match: <revision>`；与当前修订不一致时返回 `409`。

## 请求与响应

### GET /api/health

```json
{
  "ok": true,
  "service": "searchladr",
  "writable": true,
  "uptimeSeconds": 128,
  "dataFile": "/srv/searchLADR/web/data/entries.json",
  "entries": 13,
  "revision": "c1f2ab3",
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "issues": 0
}
```

`issues` 是读取时被跳过的坏词条数量（大于 0 时说明文件里有需要修的数据）。

### GET /api/entries

```json
{
  "version": 1,
  "updatedAt": "2025-01-02T03:04:05.000Z",
  "revision": "c1f2ab3",
  "entries": [ { "id": "entropy", "name": "熵", "aliases": [], "tags": [], "summary": "", "content": "" } ]
}
```

响应带 `ETag: "<revision>"`。

### POST /api/entries

```bash
curl -X POST http://127.0.0.1:8787/api/entries \
  -H "Authorization: Bearer $LADR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"entry":{"name":"熵","aliases":["entropy"],"tags":["物理"],"content":"## 定义\n…"}}'
```

- `id` 可以省略，服务端会按名称生成（ASCII 名称转 slug，中文转 `term-<hash>`）；
- 返回 `201`，body 是**新的整份文档**，外加 `created` 字段；
- 也接受裸词条对象（不带 `{"entry": …}` 包装）。

### PUT /api/entries/{id}

```bash
curl -X PUT http://127.0.0.1:8787/api/entries/entropy \
  -H "Authorization: Bearer $LADR_TOKEN" -H 'Content-Type: application/json' \
  -H 'If-Match: c1f2ab3' \
  -d '{"entry":{"name":"熵","summary":"新的简介"}}'
```

路径里的 `id` 为准，body 里的 `id` 会被忽略；`createdAt` 保留，`updatedAt` 自动刷新。返回 `200` + 新文档 + `updated`。id 不存在返回 `404`。

### DELETE /api/entries/{id}

返回 `200` + 新文档 + `removed`（`{id, name}`）。

### POST /api/entries/import

```bash
curl -X POST http://127.0.0.1:8787/api/entries/import \
  -H "Authorization: Bearer $LADR_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @entries.json
```

body 可以是整份文档，也可以是裸数组。会**替换**当前全部词条（严格校验，任何一条不合法则整体拒绝）。

## 状态码

| 状态码 | `code` | 含义 |
| --- | --- | --- |
| 200 / 201 | — | 成功 |
| 400 | `invalid-json` / `empty-body` | 请求体不是 JSON / 为空 |
| 401 | `unauthorized` | 令牌缺失或错误 |
| 403 | `read-only` | 服务端未配置令牌（只读模式） |
| 404 | `not-found` | 路径或词条不存在 |
| 409 | `conflict` | `If-Match` 与当前修订不一致 |
| 413 | `payload-too-large` | 请求体超过 `--body-limit`（默认 2 MB） |
| 422 | `invalid-entry` | 词条校验失败，`issues` 里逐字段说明 |
| 429 | `too-many-attempts` | 同一 IP 认证失败过多，`Retry-After` 提示等待秒数 |
| 500 | `internal` | 服务端异常（日志里有堆栈） |

冲突响应示例：

```json
{ "message": "数据已被其他设备修改，请刷新后重试。", "code": "conflict", "expected": "c1f2ab3", "actual": "c9e0d41" }
```

校验失败响应示例：

```json
{
  "message": "词条数据不合法。 — name: 名称 “熵” 已存在。",
  "code": "invalid-entry",
  "issues": [{ "field": "name", "code": "duplicate", "message": "名称 “熵” 已存在。" }]
}
```

## CORS

- 预检 `OPTIONS` 返回 `204`，允许 `GET/POST/PUT/DELETE/OPTIONS` 与 `Content-Type, Authorization, If-Match`，暴露 `ETag`；
- 允许的来源由 `--cors-origin` 决定，默认 `*`（词条数据本身就发布在 Pages 上是公开的）。收紧示例：`--cors-origin https://your-name.github.io`。

## 命令行选项

```bash
node server/index.js --help
```

| 选项 | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--host` | `LADR_HOST` | `0.0.0.0` | 监听地址 |
| `--port` | `LADR_PORT` | `8787` | 监听端口（未备案服务器用高位端口，见部署文档） |
| `--data` | `LADR_DATA` | `web/data/entries.json` | 词条文件路径 |
| `--token` | `LADR_TOKEN` | 空 | 写操作令牌；为空则只读 |
| `--static-root` | `LADR_STATIC_ROOT` | `web` | 同源托管的前端目录 |
| `--no-static` | — | — | 关闭静态托管 |
| `--cors-origin` | `LADR_CORS_ORIGINS` | `*` | 允许来源，可重复/逗号分隔 |
| `--read-only` | — | — | 强制只读 |
| `--git-commit` | `LADR_GIT_COMMIT=1` | 关 | 每次写入提交一次 |
| `--git-push` | `LADR_GIT_PUSH=1` | 关 | 提交后再推送 |
| `--git-prefix` | `LADR_GIT_PREFIX` | `content(entries)` | 提交信息前缀 |
| `--body-limit` | `LADR_BODY_LIMIT` | `2097152` | 请求体上限（字节） |
| `--log-level` | `LADR_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |

## 行为约定

- **原子写**：先写 `<文件>.tmp-*` 再 `rename`，写前把旧内容存成 `<文件>.bak`；
- **写串行化**：内部队列保证并发请求不会交错读改写；
- **不做内存缓存**：每次都读磁盘，所以 `git pull` 或手工改文件会立刻生效；
- **校验复用前端核心**：`web/js/core/entry.js`，所以网页与服务器对「合法词条」的定义永远一致；
- **优雅退出**：`SIGINT`/`SIGTERM` 停止接收新连接，最多等 5 秒。