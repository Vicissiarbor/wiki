# 上线指南

本文档对应 `需求.md` 里的两个条件：**一个只能用传统三件套的 GitHub Page** 和 **一台没有备案的 aliyun 小服务器**。按下面的顺序做即可。

- [0. 先在本机确认](#0-先在本机确认)
- [1. 方案 A：只上 GitHub Pages](#1-方案-a只上-github-pages)
- [2. 方案 B：Pages 查询 + 服务器编辑](#2-方案-bpages-查询--服务器编辑)
- [3. 方案 C：只用 aliyun 服务器](#3-方案-c只用-aliyun-服务器)
- [4. 关于没备案的服务器](#4-关于没备案的服务器)
- [5. 让 HTTPS 页面调用 HTTP 接口（混合内容）](#5-让-https-页面调用-http-接口混合内容)
- [6. 用 systemd 常驻后端](#6-用-systemd-常驻后端)
- [7. 编辑方式怎么选](#7-编辑方式怎么选)
- [8. 备份与恢复](#8-备份与恢复)
- [9. 常见故障排查](#9-常见故障排查)
- [10. 上线检查清单](#10-上线检查清单)

---

## 0. 先在本机确认

```bash
npm install          # 只为跑测试；网站本身零依赖
npm test             # 213 个测试，应该全绿

# 静态站点（只读）
npm run dev          # http://127.0.0.1:8787/
```

打开后确认：首页有搜索框、A–Z 索引、词条列表；输入 `熵`、`=熵`、`/^熵|热力学/`、`tag:物理` 都能查到东西。

---

## 1. 方案 A：只上 GitHub Pages

这是最快见效的方案：查询随处可用、免费、天然多设备。

### 1.1 建仓库并推送

```bash
cd searchLADR
git init -b main            # 本仓库已经初始化过，跳过
git add -A
git commit -m "chore: initial import of SearchLADR"
git remote add origin git@github.com:<你的用户名>/<仓库名>.git
git push -u origin main
```

### 1.2 开启 Pages

仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
`main` 分支一推送，`.github/workflows/pages.yml` 会把 `web/` 原样发布（没有构建步骤、没有 Jekyll、没有博客生成器）。

几十秒后访问：

```
https://<你的用户名>.github.io/<仓库名>/
```

> 如果只想用 `main` 分支目录发布（不用 Actions）：把 `web/` 改名为 `docs/`，然后在 Pages 里选 **Deploy from a branch → main → /docs**。两种方式都只是「原样托管静态文件」。`web/.nojekyll` 保留着，确保 GitHub 不做任何处理。

### 1.3 自定义域名（可选）

在 `web/` 下加一个 `CNAME` 文件，内容是你的域名；再到域名服务商加 CNAME 记录指向 `<用户名>.github.io`，最后在 Pages 设置里填上域名并勾选 Enforce HTTPS。注意 GitHub Pages 走的是海外节点，国内访问速度取决于线路。

### 1.4 怎么更新词条

Pages 上没有后端，所以三种方式（详见 [editing.md](editing.md)）：

1. 直接编辑 `web/data/entries.json` 并提交（最稳）；
2. 网页上「设置 → 本地编辑」增删改，再点「导出 JSON」，把文件覆盖回仓库提交；
3. 「设置 → GitHub 仓库」，填 `owner/repo/branch/path` 和一把细粒度令牌（只勾该仓库的 **Contents: Read and write**），之后网页上的保存会直接提交到仓库，Pages 自动重建。

---

## 2. 方案 B：Pages 查询 + 服务器编辑

页面还是放在 Pages 上（快、稳、免费），编辑交给 aliyun 上的 Node 服务。

```
浏览器 ──打开──> https://you.github.io/searchLADR/     （查询）
   └────写请求──> https://data.example.com:8443        （增删改，需要令牌）
```

### 2.1 服务器上准备代码与数据

```bash
# 以 Ubuntu/Debian 为例
sudo apt update && sudo apt install -y git
sudo useradd -r -m -s /usr/sbin/nologin ladr
sudo -u ladr git clone <仓库地址> /srv/searchLADR
sudo -u ladr node --version   # 需要 Node 20+；没有的话装一个：
# curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

### 2.2 生成令牌并首次启动

```bash
TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)
echo "LADR_TOKEN=$TOKEN" | sudo tee /etc/ladr.env
sudo chmod 600 /etc/ladr.env && sudo chown ladr:ladr /etc/ladr.env

sudo -u ladr env $(cat /etc/ladr.env) node /srv/searchLADR/server/index.js \
  --host 0.0.0.0 --port 8787 \
  --data /srv/searchLADR/web/data/entries.json \
  --static-root /srv/searchLADR/web
```

看到 `词条服务已启动 ... writable=true` 就说明写权限已开启。用浏览器或 curl 验证：

```bash
curl http://127.0.0.1:8787/api/health
```

### 2.3 放行端口（安全组 + 防火墙）

- aliyun 控制台 → 该实例 → **安全组 → 入方向**：放行 TCP **8787**（若走 HTTPS 则放行 **8443**）。**不要**放行 80/443（见第 4 节）。
- 服务器本机：`sudo ufw allow 8787/tcp`（如果启用了 ufw）。

### 2.4 精确限制跨域来源

页面在 `https://you.github.io`，接口在服务器上，属于跨域。默认后端允许任意来源（因为词条数据本来就在 Pages 上公开），更安全的做法是指定来源：

```bash
--cors-origin https://you.github.io
```

多个来源就重复写多次 `--cors-origin`。

### 2.5 在网页上配置

打开 Pages 站点 → 右上角「设置」：

- 数据源选 **自建后端（可写）**
- 后端地址：`http://<服务器公网IP>:8787`（或第 5 节的 HTTPS 地址）
- 访问令牌：粘贴 `LADR_TOKEN` 的值
- 点「应用并重新加载」

令牌只存在你这台设备的浏览器里，不会写进仓库。**如果页面是 HTTPS 而接口是 HTTP，浏览器会拦截**——见第 5 节。

---

## 3. 方案 C：只用 aliyun 服务器

不想用 GitHub 的话，后端会把前端一起托管在同源上，不需要处理 CORS，也不会有混合内容问题：

```bash
node /srv/searchLADR/server/index.js \
  --host 0.0.0.0 --port 8787 \
  --data /srv/searchLADR/web/data/entries.json \
  --static-root /srv/searchLADR/web \
  --token '<你的令牌>'
```

然后所有设备访问 `http://<公网IP>:8787/`：查询、编辑都在同一个源上，手机上也能改。这个 URL 可以直接做成手机书签，满足「多设备查找」。

如果以后有了备案域名，把 `--port` 换成 443 前面加一层 Nginx 即可（本服务本身不支持 TLS，交给 Nginx/Cloudflare 处理）。

---

## 4. 关于没备案的服务器

- 境内服务器的 **80/443 端口绑定域名**需要 ICP 备案，未备案会被阻断或拦截；**IP + 高位端口**（如 `8787`、`8443`）不属于该限制范围，也是本项目默认的做法。
- 因此不要试图把后端挂在 80/443 上，也不要指望 `http://你的域名` 能直接访问。
- 如果你确实想要域名 + HTTPS，有两条不需要 80 端口的常见路线：
  1. **DNS-01 验证的证书**：用 `acme.sh --dns` 或 certbot 的 DNS 插件申请 Let's Encrypt 证书（不依赖 80 端口），把证书交给 Nginx 监听 8443；
  2. **Cloudflare Tunnel**：服务器主动出网建立隧道，不需要开放任何入站端口，也自带 HTTPS 与域名。

第 2 条对「小服务器 + 无备案」最省事：装了 `cloudflared` 之后，后端地址会变成一个 `https://xxx.example.com` 的 HTTPS 域名，第 5 节的问题自然消失。

---

## 5. 让 HTTPS 页面调用 HTTP 接口（混合内容）

现象：Pages 是 HTTPS，接口是 `http://IP:8787`，浏览器直接拦截请求，页面上出现「混合内容」提示。三种解法，任选其一：

| 解法 | 做法 | 代价 |
| --- | --- | --- |
| **改成用服务器地址访问**（最简单） | 直接用 `http://IP:8787/` 打开网站（方案 C），前后端同源 | 需要记住 IP |
| **给后端加 HTTPS**（最正规） | DNS-01 申请证书 + Nginx 反代到 8443，或用 Cloudflare Tunnel | 需要域名（Tunnel 也需要） |
| **改用 GitHub 编辑**（完全不用服务器） | 设置里切到「GitHub 仓库」，用令牌直接提交 | 每次改动是一次 commit，稍慢 |

本项目在前端做了明确提示：一旦检测到「HTTPS 页面 + HTTP 数据源」，会直接给出「混合内容」说明，而不是丢一个 `Failed to fetch`。

---

## 6. 用 systemd 常驻后端

`server/systemd/searched-ladr.service` 已经写好，改一下路径和用户名即可：

```bash
sudo cp server/systemd/searched-ladr.service /etc/systemd/system/
sudo vim /etc/systemd/system/searched-ladr.service   # 改 User/WorkingDirectory/路径
sudo systemctl daemon-reload
sudo systemctl enable --now searched-ladr
systemctl status searched-ladr
journalctl -u searched-ladr -f           # 看日志
```

`LADR_TOKEN` 放在 `/etc/ladr.env`（`chmod 600`），不会出现在 `systemctl status` 的完整命令行里（`EnvironmentFile` 是文件方式加载）。

---

## 7. 编辑方式怎么选

四种方式的功能对比、令牌权限要求、冲突处理，见 [editing.md](editing.md)。一句话结论：

- 只是偶尔改：**直接在仓库里编辑 JSON**（有 git 历史、可回滚）；
- 不想碰 JSON 又不想开服务器：**网页里的「GitHub 仓库」模式**（浏览器直接提交）；
- 想让改动立刻在多设备生效、并且不想每次提交：**自建后端**（本文第 2/3 节）。

如果服务器上想顺便把改动同步回 GitHub，加上：

```bash
--git-commit --git-push
```

每次写操作会变成一次提交并推送（提交信息形如 `content(entries): add "熵"`）。要让 `git push` 免密，给 `ladr` 用户配一把 **只读+写该仓库的 deploy key**：

```bash
sudo -u ladr ssh-keygen -t ed25519 -C ladr@server -f /srv/searchLADR/.ssh/id_ed25519 -N ''
# 把公钥加到仓库 Settings → Deploy keys（勾选 Allow write access）
sudo -u ladr git -C /srv/searchLADR remote set-url origin git@github.com:<用户名>/<仓库>.git
```

---

## 8. 备份与恢复

数据只有一个文件，很简单：

- 每次写入前，服务会留一份 `<文件>.bak`；
- 建议再加一条定时任务：

```bash
# 每天 3 点打包一份带日期的备份，保留 30 天
30 3 * * * tar -czf /srv/backup/entries-$(date +\%F).tgz -C /srv/searchLADR web/data/entries.json && find /srv/backup -name 'entries-*.tgz' -mtime +30 -delete
```

- 恢复：把备份里的 `entries.json` 放回原路径，重启服务（或者直接 `curl` 用 `/api/entries/import` 整体导入，见 [api.md](api.md)）。
- 用了 `--git-commit` 的话，`git log web/data/entries.json` 本身就是完整历史。

---

## 9. 常见故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 页面显示「无法连接数据源 … CORS」 | 后端没启动、端口未在安全组放行，或 `--cors-origin` 没包含站点来源。先在服务器上 `curl http://127.0.0.1:8787/api/health` 自测 |
| 页面显示「混合内容」 | HTTPS 页面调 HTTP 接口，见第 5 节 |
| 保存时报 401 | 令牌为空或写错；在「设置」里重新填 `LADR_TOKEN` 的值 |
| 保存时报 403 `read-only` | 服务启动时没有 `--token`/`LADR_TOKEN`，或加了 `--read-only` |
| 保存时报 409 `conflict` | 另一台设备已经改过；点「刷新」后重做这次修改（这是防覆盖，不是 bug） |
| 保存时报 422 | 词条数据不合法（重名、字段超长等），提示里会写明字段 |
| 打开页面一片空白 | 多半是用 `file://` 直接打开了 HTML：必须用 HTTP(S) 打开 |
| 手机上打开很慢 | Pages 在海外；可以考虑用服务器同源托管（方案 C）或在 Cloudflare 后面加缓存 |
| 中文首字母不对（如「重庆」跑到 Z） | 逐字查表无法判断多音字，给该词条填 `"initial": "C"` 覆盖即可 |
| 正则查询提示「灾难性回溯」 | 表达式里出现了 `(a+)+`、`(a\|a)+`、`.*.*` 这类会指数级回溯的写法，改写成 `a+` 等安全形式 |

---

## 10. 上线检查清单

- [ ] `npm test` 全绿
- [ ] `web/data/entries.json` 已换成自己的词条，且 `node -e "JSON.parse(...)"` 能解析
- [ ] Pages 已发布，首页能搜、能按首字母浏览
- [ ] （方案 B/C）`/api/health` 返回 `writable:true`
- [ ] 令牌保存在浏览器设置里，**没有**写进 `config.json` 或仓库
- [ ] 安全组只放行了需要的高位端口，80/443 未被误开
- [ ] systemd 服务 `enabled`，重启服务器后能自动起来
- [ ] 备份任务已配置，并且**实际恢复演练过一次**
- [ ] 用手机浏览器打开链接做过一次真实查询和一次真实编辑