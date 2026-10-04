# SearchLADR · 概念词条库

输入概念名查到词条，也可以直接翻索引。界面是复古目录页：字母标题 + 一列链接 + 一个搜索框。

```
A
  abandon
  aport
B
  banana
```

- 纯静态：原生 HTML + CSS + ES 模块，**无构建步骤、无依赖、无后端**，直接放在 GitHub Pages 上。
- 搜索：包含（默认）、精确（`=名字`）、正则（`/表达式/`），可限定字段（`tag:物理`）。
- 索引：按首字母分组，中文按拼音（`熵 → S`）。
- 双语：界面与词条都有中英文，默认英文，页头一键切换；词条缺中文时显示英文。
- 公式：正文里用 `$…$` / `$$…$$` 写 KaTeX，仓库自带，不请求 CDN。
- 只读：内容靠改 `web/data/entries.json` 并提交来维护。

## 本地预览

```bash
npm install        # 只为跑测试（jsdom）；站点本身零依赖
npm test           # 248 个测试
npm run preview    # http://127.0.0.1:8080/
```

必须通过 HTTP(S) 打开；用 `file://` 双击 `index.html` 会因浏览器拒绝加载 ES 模块而白屏。

## 上线

```bash
git remote add origin git@github.com:<用户名>/<仓库名>.git
git push -u origin main
```

仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**，
访问 `https://<用户名>.github.io/<仓库名>/`。详见 [docs/deployment.md](docs/deployment.md)。

## 更新词条

编辑 `web/data/entries.json` → `npm test` → 提交推送。字段、双语、日期、Markdown 与公式
的写法见 [docs/data-format.md](docs/data-format.md)。

## 目录结构

```
web/                    站点本体（GitHub Pages 发布的就是这个目录）
  index.html            唯一页面
  config.json           站点配置：标题、标语、默认语言、数据路径
  data/entries.json     全部词条
  assets/style.css      样式
  assets/katex/         内置 KaTeX（公式用）
  js/
    boot.js             页面入口
    app.js              组装层：读取、渲染、路由、语言、快捷键
    config.js           配置加载
    core/               纯逻辑（无 DOM、无网络）
      entry.js          词条模型与校验
      collection.js     词条集合、名称查找
      search.js         查询解析与匹配
      markdown.js       Markdown 渲染 + 公式抽取
      initials.js       首字母（中文取拼音）
      pinyin-table.js   自动生成的拼音首字母表
      sort.js           排序与 A–Z 分组
      locale.js         语言选择、词条本地化
      i18n.js           界面文案（中英）
      errors.js
    data/
      entries-store.js  读取 data/entries.json + 本地缓存
    ui/                 视图：索引、词条页、搜索框、语言切换、状态行、路由、公式渲染
    util/storage.js     localStorage 包装
tools/
  serve.js              本地预览用静态服务器（仅开发）
  gen_pinyin_table.py   重新生成拼音首字母表
tests/                  248 个测试
docs/                   词条格式、搜索语法、上线
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/data-format.md](docs/data-format.md) | 词条字段、双语、日期、Markdown 与公式、维护流程 |
| [docs/search-syntax.md](docs/search-syntax.md) | 搜索语法与正则限制 |
| [docs/deployment.md](docs/deployment.md) | 上线步骤、排障、检查清单 |

## 许可

MIT（见 `LICENSE`）。第三方资源随仓库分发：拼音首字母表由
[pypinyin](https://github.com/mozillazg/python-pinyin) 生成，
数学公式由 [KaTeX](https://katex.org/) 0.17.0 渲染（见 `web/assets/katex/NOTICE.md`）。