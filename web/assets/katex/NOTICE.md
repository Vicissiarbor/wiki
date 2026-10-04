# 内置的 KaTeX

词条里的公式由 KaTeX 渲染，文件随仓库分发（不走 CDN）。

| 项 | 值 |
| --- | --- |
| 版本 | 0.17.0 |
| 上游 | <https://katex.org/> · <https://github.com/KaTeX/KaTeX> |
| 许可 | MIT，见同目录 `LICENSE` |

保留的文件：`katex.min.js`、`katex.min.css`、`fonts/*.woff2`（20 个字体）、`LICENSE`。
约 600 KB，只在页面出现公式时才加载（`web/js/ui/math.js`）。

升级：

```bash
SRC=/path/to/katex
cp "$SRC/katex.min.js" "$SRC/katex.min.css" web/assets/katex/
cp "$SRC"/fonts/*.woff2 web/assets/katex/fonts/
curl -sS https://raw.githubusercontent.com/KaTeX/KaTeX/v<版本>/LICENSE -o web/assets/katex/LICENSE
npm test
```
