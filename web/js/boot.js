/**
 * Page bootstrap.
 *
 * Kept separate from app.js so the application module stays a plain library
 * (importable by tests) and the page has exactly one entry point.
 */

import { boot } from './app.js';

/**
 * @param {unknown} error
 */
function reportFatal(error) {
  const banner = document.querySelector('#app-banner');
  const list = document.querySelector('#list-host');
  const message = error instanceof Error ? error.message : String(error);
  const hints = [
    '请确认页面是通过 HTTP(S) 打开的（GitHub Pages 或本地服务器），而不是 file:// 路径。',
    '请确认浏览器支持 ES 模块（Chrome/Edge 90+、Firefox 90+、Safari 15+）。',
    '可以在浏览器控制台查看详细错误信息。',
  ];
  if (banner) {
    banner.hidden = false;
    banner.textContent = `初始化失败：${message}`;
  }
  if (list) {
    const pre = document.createElement('div');
    pre.className = 'fatal';
    const title = document.createElement('p');
    title.textContent = '页面无法启动。可能的原因：';
    const ul = document.createElement('ul');
    for (const hint of hints) {
      const li = document.createElement('li');
      li.textContent = hint;
      ul.appendChild(li);
    }
    pre.append(title, ul);
    list.replaceChildren(pre);
  }
}

try {
  window.__LADR_APP__ = await boot();
} catch (error) {
  console.error('[SearchLADR] 启动失败', error);
  reportFatal(error);
}