# server/ · 自建后端

零依赖的 Node 服务：REST 接口 + 同源托管前端 + 可选的 git 自动提交。它是为「一台没备案的 aliyun 小服务器」准备的，但任何能跑 Node 20+ 的地方都能用。

```bash
node server/index.js --help          # 全部选项
npm start                            # 默认：0.0.0.0:8787，只读，托管 web/
npm run dev                          # 本地只读预览
```

## 最短可用命令

```bash
LADR_TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40) \
node server/index.js \
  --host 0.0.0.0 --port 8787 \
  --data web/data/entries.json \
  --static-root web \
  --cors-origin https://your-name.github.io
```

启动后会打印实际地址、是否可写和数据文件路径。验证：

```bash
curl http://127.0.0.1:8787/api/health
```

## 为什么不默认监听 80/443

境内未备案的服务器无法把域名解析到 80/443，所以默认用高位端口（`8787`），直接以 `IP:端口` 访问。需要 HTTPS 时有两条不依赖 80 端口的路线：DNS-01 证书 + Nginx 监听 8443，或 Cloudflare Tunnel。详见 [../docs/deployment.md](../docs/deployment.md) 第 4、5 节。

## 三种典型用法

| 用法 | 命令要点 |
| --- | --- |
| 只当静态托管（等于本地预览） | `--read-only --static-root web` |
| 前端交给 Pages，只提供写接口 | `--no-static --cors-origin https://user.github.io` |
| 前后端同一个源（推荐给「只用服务器」的场景） | `--static-root web --token …`，访问 `http://IP:8787/` |

## 数据与备份

- 数据文件就是 `web/data/entries.json`：后端改它，Pages 也发布它，一份数据两个出口；
- 每次写入前会留 `<文件>.bak`；
- 加 `--git-commit`（可选 `--git-push`）让每次改动成为一次提交，提交信息形如 `content(entries): update "熵"`。

## 文件结构

```
server/
  index.js            CLI 入口：装配 store / auth / api / static，监听与优雅退出
  lib/config.js       命令行与环境变量
  lib/store.js        文件存储：原子写、备份、修订号、串行化、git 提交
  lib/api.js          REST 路由与错误映射
  lib/auth.js         Bearer 令牌（常数时间比较 + 失败限流）
  lib/static.js       静态托管（ETag/304、MIME、路径穿越防护、404 页）
  lib/git.js          git add/commit/push 包装（失败只记录，不阻塞保存）
  systemd/            systemd 单元示例
```

## 相关文档

- [../docs/api.md](../docs/api.md) —— 接口、状态码、选项表
- [../docs/deployment.md](../docs/deployment.md) —— systemd、安全组、HTTPS、备份、排障
- [../docs/architecture.md](../docs/architecture.md) —— 为什么后端能直接复用前端的校验核心