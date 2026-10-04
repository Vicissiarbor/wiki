# 内置的 KaTeX

本站把 KaTeX 打包进仓库（不走 CDN、不走构建），用于渲染词条里的数学公式。

| 项 | 值 |
| --- | --- |
| 版本 | **0.17.0**（`web/assets/katex/katex.min.js` 内的 `katex.version`） |
| 上游 | <https://katex.org/> · <https://github.com/KaTeX/KaTeX> |
| 许可 | MIT，见同目录的 `LICENSE` |
| 来源 | 取自本机已有的一份 `katex` 发行包（与其博客 `blog/libs/katex/` 同源），只保留运行时需要的文件 |

## 保留了什么

```
katex.min.js        运行时（UMD，加载后挂在 window.katex 上）
katex.min.css       样式（内部用 url(fonts/…) 相对引用字体）
fonts/*.woff2       20 个字体文件（只保留 woff2；CSS 里 woff2 是首选源）
LICENSE             MIT 许可原文
```

刻意**没有**保留：`katex.js` / `katex.mjs`（未压缩版，598 KB）、`katex.css`、`*.woff` / `*.ttf`（约 580 KB 的冗余回退字体）、`contrib/`（auto-render 等扩展，本站用不到）。

合计约 600 KB，且**只在词条页出现公式时才加载**（见 `web/js/ui/math.js`）。

## 怎么升级

```bash
# 从本机已有的 katex 发行包更新（或从 https://github.com/KaTeX/KaTeX/releases 下载）
SRC=/path/to/katex
cp "$SRC/katex.min.js" "$SRC/katex.min.css" web/assets/katex/
cp "$SRC"/fonts/*.woff2 web/assets/katex/fonts/
curl -sS https://raw.githubusercontent.com/KaTeX/KaTeX/v<版本>/LICENSE \
  -o web/assets/katex/LICENSE
```

升级后跑一次 `npm test`：`tests/data-files.test.js` 会检查这些文件在位，
`tests/ui.test.js` 会检查渲染接线没断。