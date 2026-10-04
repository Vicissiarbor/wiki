/**
 * The settings dialog: pick a data source, configure endpoints/tokens, and
 * move data in and out as JSON.
 *
 * Tokens are stored per device in localStorage by the caller — never in
 * config.json, which is published together with the site.
 */

import { describeSources } from '../data/registry.js';
import { el, fragment } from './dom.js';
import { createModal } from './modal.js';
import { toastError, toastSuccess } from './toast.js';

/**
 * @param {string} filename
 * @param {string} text
 * @returns {void}
 */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {{config: import('../config.js').AppConfig,
 *   getStatus: () => {origin: string, revision: string, fetchedAt: string, writable: boolean, error: string, errorKind: string, issues: Array<{message: string}>},
 *   onApply: (patch: object) => Promise<void>,
 *   onReset: () => Promise<void>,
 *   onExportAll: () => void,
 *   onImportAll: (raw: unknown) => Promise<void>}} options
 * @returns {{open: () => void}}
 */
export function createSettingsPanel(options) {
  const modal = createModal({
    title: '数据源设置',
    description: '选择词条存放在哪里。设置保存在本机浏览器，不会写回仓库。',
    size: 'lg',
  });

  /** @type {Map<string, {radio: HTMLInputElement, pane: HTMLElement}>} */
  const sources = new Map();

  const jsonUrl = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', name: 'jsonUrl', placeholder: './data/entries.json' })
  );
  const restBaseUrl = /** @type {HTMLInputElement} */ (
    el('input', { type: 'url', name: 'restBaseUrl', placeholder: 'http://1.2.3.4:8787' })
  );
  const restToken = /** @type {HTMLInputElement} */ (
    el('input', { type: 'password', name: 'restToken', autocomplete: 'off' })
  );
  const ghOwner = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', name: 'ghOwner', placeholder: 'your-name' })
  );
  const ghRepo = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', name: 'ghRepo', placeholder: 'searchLADR' })
  );
  const ghBranch = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', name: 'ghBranch', placeholder: 'main' })
  );
  const ghPath = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', name: 'ghPath', placeholder: 'web/data/entries.json' })
  );
  const ghToken = /** @type {HTMLInputElement} */ (
    el('input', { type: 'password', name: 'ghToken', autocomplete: 'off' })
  );

  const statusBox = el('div.settings__status');

  /**
   * @param {string} label
   * @param {HTMLElement} control
   * @param {string} [hint]
   * @returns {HTMLElement}
   */
  function field(label, control, hint) {
    return el('div.editor__field', {}, [
      el('label', { text: label, for: control.id || undefined }),
      control,
      hint ? el('p.settings__hint', { text: hint }) : null,
    ]);
  }

  /** @type {HTMLElement[]} */
  const panels = [];
  for (const source of describeSources()) {
    const radio = /** @type {HTMLInputElement} */ (
      el('input', {
        type: 'radio',
        name: 'source',
        value: source.id,
        on: { change: () => syncPanes() },
      })
    );
    const pane = el('div.settings__pane', { dataset: { source: source.id } });
    sources.set(source.id, { radio, pane });
    panels.push(
      el('div.settings__source', {}, [
        el('label.settings__source-head', {}, [
          radio,
          el('span.settings__source-label', { text: source.label }),
          source.writable ? el('span.chip.chip--tiny', { text: '可写' }) : el('span.chip.chip--tiny', { text: '只读' }),
        ]),
        el('p.settings__source-desc', { text: source.description }),
        pane,
      ]),
    );
  }

  sources.get('json').pane.append(
    field('词条 JSON 地址', jsonUrl, '相对站点根目录或完整 URL；GitHub Pages 上默认 ./data/entries.json。'),
  );
  sources.get('rest').pane.append(
    field('后端地址', restBaseUrl, '例如 http://1.2.3.4:8787 或 https://data.example.com。'),
    field('访问令牌', restToken, '与服务器上的 LADR_TOKEN 一致；只保存在本机浏览器。'),
  );
  sources.get('github').pane.append(
    el('div.editor__row', {}, [
      field('仓库所有者', ghOwner),
      field('仓库名', ghRepo),
    ]),
    el('div.editor__row', {}, [
      field('分支', ghBranch),
      field('文件路径', ghPath),
    ]),
    field(
      '个人访问令牌',
      ghToken,
      '细粒度令牌，只勾选该仓库的 Contents: Read and write。保存在本机浏览器，可随时在 GitHub 撤销。',
    ),
  );
  sources.get('local').pane.append(
    el('p.settings__hint', {
      text: '本地编辑模式下，改动保存在当前浏览器，可随时导出 JSON 再手工提交到仓库。',
    }),
  );

  const importInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'file',
      accept: 'application/json,.json',
      hidden: true,
      on: {
        change: async () => {
          const file = importInput.files?.[0];
          if (!file) {
            return;
          }
          try {
            const raw = JSON.parse(await file.text());
            await options.onImportAll(raw);
            toastSuccess(`已导入 ${file.name}`);
            renderStatus();
          } catch (error) {
            toastError(error instanceof Error ? error.message : String(error));
          } finally {
            importInput.value = '';
          }
        },
      },
    })
  );

  const dataTools = el('div.settings__tools', {}, [
    el('button.button', {
      type: 'button',
      text: '导出全部 JSON',
      title: '下载当前全部词条，用于提交到仓库或备份',
      on: { click: () => options.onExportAll() },
    }),
    el('button.button', {
      type: 'button',
      text: '导入 JSON（覆盖本地）',
      title: '仅“本地编辑”模式支持整体覆盖',
      on: { click: () => importInput.click() },
    }),
    importInput,
  ]);

  modal.setBody([
    el('div.settings__sources', {}, fragment(panels)),
    el('h3.settings__section-title', { text: '数据导入 / 导出' }),
    dataTools,
    el('h3.settings__section-title', { text: '当前状态' }),
    statusBox,
  ]);

  const applyButton = el('button.button.primary', {
    type: 'button',
    text: '应用并重新加载',
    on: {
      click: async () => {
        const patch = readForm();
        applyButton.disabled = true;
        modal.setStatus('正在切换数据源…', 'info');
        try {
          await options.onApply(patch);
          modal.setStatus('已切换。', 'success');
          renderStatus();
        } catch (error) {
          modal.setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
          applyButton.disabled = false;
        }
      },
    },
  });

  modal.footer.append(
    el('button.button', {
      type: 'button',
      text: '恢复默认配置',
      title: '清除本机保存的设置，回到 config.json 的值',
      on: {
        click: async () => {
          try {
            await options.onReset();
            modal.close();
            toastSuccess('已恢复默认配置');
          } catch (error) {
            modal.setStatus(error instanceof Error ? error.message : String(error), 'error');
          }
        },
      },
    }),
    el('button.button', {
      type: 'button',
      text: '关闭',
      on: { click: () => modal.close() },
    }),
    applyButton,
  );

  /** Show only the pane of the selected source. */
  function syncPanes() {
    for (const [id, entry] of sources) {
      entry.pane.hidden = !entry.radio.checked;
      entry.pane.dataset.source = id;
    }
  }

  /** @returns {object} A config patch built from the form. */
  function readForm() {
    const selected = [...sources.entries()].find(([, entry]) => entry.radio.checked)?.[0] ?? 'json';
    return {
      source: selected,
      data: { url: jsonUrl.value.trim() || './data/entries.json' },
      rest: {
        baseUrl: restBaseUrl.value.trim(),
        token: restToken.value.trim(),
      },
      github: {
        owner: ghOwner.value.trim(),
        repo: ghRepo.value.trim(),
        branch: ghBranch.value.trim() || 'main',
        path: ghPath.value.trim() || 'web/data/entries.json',
        token: ghToken.value.trim(),
      },
    };
  }

  /** @param {import('../config.js').AppConfig} config */
  function fill(config) {
    for (const [id, entry] of sources) {
      entry.radio.checked = id === config.source;
    }
    jsonUrl.value = config.data.url;
    restBaseUrl.value = config.rest.baseUrl;
    restToken.value = config.rest.token;
    ghOwner.value = config.github.owner;
    ghRepo.value = config.github.repo;
    ghBranch.value = config.github.branch;
    ghPath.value = config.github.path;
    ghToken.value = config.github.token;
    syncPanes();
  }

  /** Render the live status of the active source. */
  function renderStatus() {
    const status = options.getStatus();
    const rows = [
      ['数据源', status.origin || '（内存）'],
      ['版本号', status.revision || '—'],
      ['最近读取', status.fetchedAt ? new Date(status.fetchedAt).toLocaleString('zh-CN') : '—'],
      ['可写', status.writable ? '是' : '否（只读数据源）'],
    ];
    statusBox.replaceChildren(
      fragment([
        el(
          'dl.settings__dl',
          {},
          rows.flatMap(([label, value]) => [
            el('dt', { text: label }),
            el('dd', { text: String(value) }),
          ]),
        ),
        status.error
          ? el('p.settings__error', { text: `最近一次错误：${status.error}` })
          : null,
        status.issues.length > 0
          ? el('p.settings__warning', {
              text: `有 ${status.issues.length} 条词条在读取时被跳过：${status.issues[0]?.message ?? ''}`,
            })
          : null,
      ]),
    );
  }

  return {
    open() {
      fill(options.config);
      renderStatus();
      modal.setStatus('');
      modal.open();
    },
  };
}