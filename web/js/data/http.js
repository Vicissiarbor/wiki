/**
 * HTTP plumbing shared by every remote data source.
 *
 * The error messages are user-facing on purpose: the two failure modes that
 * actually happen with this project's deployment (mixed content on an HTTPS
 * GitHub Pages site + CORS on a self-hosted API) are explained instead of being
 * reported as a bare "Failed to fetch".
 */

import { ConflictError, DataSourceError } from '../core/errors.js';

/** Headers every JSON request carries. */
const JSON_HEADERS = Object.freeze({ Accept: 'application/json' });

/**
 * @param {string} url
 * @param {string} [pageProtocol]
 * @returns {boolean} True when the browser will block this request as mixed content.
 */
export function isMixedContent(url, pageProtocol = globalThis.location?.protocol ?? '') {
  return pageProtocol === 'https:' && /^http:\/\//i.test(url);
}

/**
 * @param {string} url An absolute URL.
 * @returns {string} `http://host:port`, or '' when `url` is not absolute.
 */
export function originOf(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return '';
  }
}

/**
 * Perform a JSON request and return the parsed body.
 *
 * @param {string} url
 * @param {{method?: string, headers?: Record<string, string>, body?: unknown,
 *   timeoutMs?: number, credentials?: RequestCredentials, cache?: RequestCache,
 *   fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<unknown>}
 * @throws {ConflictError} On HTTP 409.
 * @throws {DataSourceError} On any other failure, with an actionable message.
 */
export async function requestJson(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new DataSourceError('当前环境不支持 fetch，无法访问远程数据源。', { kind: 'unsupported' });
  }
  if (isMixedContent(url)) {
    throw new DataSourceError(
      '页面通过 HTTPS 打开，但数据源是 HTTP，浏览器会以“混合内容”为由拦截该请求。' +
        '请把后端升级为 HTTPS（见 docs/deployment.md），或直接通过后端地址访问本站。',
      { url, kind: 'mixed-content' },
    );
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const timer =
    controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  /** @type {Response} */
  let response;
  try {
    response = await fetchImpl(url, {
      method: options.method ?? 'GET',
      headers: {
        ...JSON_HEADERS,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: options.credentials ?? 'same-origin',
      cache: options.cache ?? 'no-cache',
      signal: controller?.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new DataSourceError(
      aborted
        ? `请求超时（${timeoutMs} 毫秒）：${url}`
        : `无法连接数据源 ${url}。请检查地址、网络，以及服务端是否允许本站的跨域访问（CORS）。`,
      { url, kind: aborted ? 'timeout' : 'network', cause: error },
    );
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }

  const text = await response.text();
  /** @type {any} */
  let payload = null;
  if (text !== '') {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new DataSourceError(`数据源返回的不是合法 JSON：${url}`, { url, kind: 'format' });
      }
    }
  }

  if (response.status === 409) {
    throw new ConflictError(
      typeof payload?.message === 'string' ? payload.message : '数据已被其他设备修改，请刷新后重试。',
      { expected: payload?.expected, actual: payload?.actual },
    );
  }
  if (!response.ok) {
    const detail = typeof payload?.message === 'string' ? `：${payload.message}` : '';
    const kind = response.status === 401 || response.status === 403 ? 'auth' : 'http';
    throw new DataSourceError(`请求失败（HTTP ${response.status}）${url}${detail}`, {
      status: response.status,
      url,
      kind,
    });
  }
  return payload;
}