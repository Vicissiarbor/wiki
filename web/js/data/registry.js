/**
 * Build the configured data source.
 *
 * The rest of the app only ever sees the DataSource interface, so adding a new
 * backend means adding one factory here.
 */

import { createGithubSource } from './github-source.js';
import { createJsonSource } from './json-source.js';
import { createLocalSource } from './local-source.js';
import { createRestSource } from './rest-source.js';

/**
 * @param {import('../config.js').AppConfig} config
 * @param {{storage: {get: Function, set: Function, remove: Function},
 *   fetchImpl?: typeof fetch}} options
 * @returns {import('./source.js').DataSource}
 */
export function createSource(config, options) {
  switch (config.source) {
    case 'rest':
      return createRestSource({
        baseUrl: config.rest.baseUrl,
        token: config.rest.token,
        timeoutMs: config.rest.timeoutMs,
        fetchImpl: options.fetchImpl,
      });
    case 'github':
      return createGithubSource({
        owner: config.github.owner,
        repo: config.github.repo,
        branch: config.github.branch,
        path: config.github.path,
        token: config.github.token,
        fetchImpl: options.fetchImpl,
      });
    case 'local':
      return createLocalSource({
        storage: options.storage,
        seedUrl: config.data.url,
        fetchImpl: options.fetchImpl,
      });
    case 'json':
    default:
      return createJsonSource({
        url: config.data.url,
        cacheBust: config.data.cacheBust,
        fetchImpl: options.fetchImpl,
      });
  }
}

/**
 * Descriptions shown in the settings dialog, independent of the current config.
 *
 * @returns {Array<{id: import('../config.js').SourceKind, label: string, description: string, writable: boolean}>}
 */
export function describeSources() {
  return [
    {
      id: 'json',
      label: '静态 JSON（只读）',
      description: '读取仓库里的 web/data/entries.json。零配置、零后端，所有设备可查。',
      writable: false,
    },
    {
      id: 'local',
      label: '本地编辑（仅此设备）',
      description: '改动保存在本机浏览器，可导出 JSON 再提交。',
      writable: true,
    },
    {
      id: 'github',
      label: 'GitHub 仓库（可写）',
      description: '用个人访问令牌直接提交到仓库，无需服务器。',
      writable: true,
    },
    {
      id: 'rest',
      label: '自建后端（可写）',
      description: '连接 server/ 里的 Node 服务，改动立刻对全设备生效。',
      writable: true,
    },
  ];
}