/**
 * Page bootstrap: the only entry point referenced by index.html.
 *
 * Kept separate from app.js so the application module stays an ordinary
 * library that the test suite can import and drive.
 */

import { boot } from './app.js';

/**
 * @param {unknown} error
 */
function reportFatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  const view = document.querySelector('#view');
  const paragraph = document.createElement('p');
  paragraph.className = 'status status--error';
  paragraph.textContent = `页面无法启动：${message}`;
  const hints = document.createElement('p');
  hints.className = 'empty__hint';
  hints.textContent =
    '请确认是通过 HTTP(S) 打开的页面（本地可用 node tools/serve.js），并查看浏览器控制台的详细报错。';
  if (view) {
    view.replaceChildren(paragraph, hints);
  }
}

try {
  window.__LADR_APP__ = await boot();
} catch (error) {
  console.error('[SearchLADR] 启动失败', error);
  reportFatal(error);
}
