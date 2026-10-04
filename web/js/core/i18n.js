/**
 * Every user-visible string, in both languages.
 *
 * Rules
 *   - English is the source language (`en`), so a missing Chinese key falls back
 *     to English rather than showing a raw key.
 *   - `t(key, params)` replaces `{name}` placeholders.
 *   - When `params.count === 1` and a `key.one` variant exists, that variant is
 *     used (English only — Chinese has no plural form, so it simply omits it).
 *   - Nothing here touches the DOM: core modules (search) and UI modules share
 *     exactly one dictionary, so the two can never drift apart.
 *
 * Adding a language means adding one entry to LANGUAGE_STRINGS and one code to
 * LOCALES in core/locale.js.
 */

/** @type {Record<string, Record<string, string>>} */
export const LANGUAGE_STRINGS = {
  en: {
    // ---------------------------------------------------------------- header
    'search.label': 'Search',
    'search.submit': 'Find',
    'search.clear': 'Clear',
    'search.placeholder': 'Type a concept name… (=exact, /regex/, tag:…)',
    'lang.switch': 'Language',
    'lang.switchTo': 'Switch to {language}',
    // ---------------------------------------------------------------- hints
    'hint.browse': 'Browsing all entries (sorted by initial)',
    'hint.contains': 'Contains match',
    'hint.exact': 'Exact match',
    'hint.regex': 'Regular expression',
    'hint.fields.all': 'all fields',
    'hint.fields.name': 'name',
    'hint.fields.aliases': 'aliases',
    'hint.fields.tags': 'tags',
    'hint.fields.summary': 'summary',
    'hint.fields.content': 'body',
    'hint.entryPage': 'Type a name to search (=exact / /regex/); Esc returns to the index.',
    'hint.missingEntry': 'No such entry. Press Esc or follow the index link.',
    // ---------------------------------------------------------------- counts
    'count.total': '{count} entries',
    'count.total.one': '1 entry',
    'count.matched': '{count} matched',
    'count.matched.one': '1 match',
    'count.showing': 'showing {shown}',
    'count.truncated': '(truncated)',
    'footer.cached': 'showing local cache',
    'footer.updated': '{label} {date}',
    // ---------------------------------------------------------------- empty
    'empty.noMatch': 'Nothing matches “{query}”.',
    'empty.noEntries': 'No entries yet.',
    'empty.noLetter': 'No entries start with {letter}.',
    'empty.hintSearch': 'Try a plain contains search, =exact, or /regex/.',
    'empty.hintData': 'Add entries to data/entries.json and commit; the index updates by itself.',
    'truncated.note': 'Too many results: showing the first {count}. Narrow the query (for example with tag:).',
    // ---------------------------------------------------------------- entries
    'entry.index': '← Index',
    'entry.aliasesLabel': 'Aliases: ',
    'entry.tagsLabel': 'Tags: ',
    'entry.id': 'id: {id}',
    'entry.noContent': 'This entry has no body yet.',
    'entry.missingTitle': 'No such entry',
    'entry.missingBody': 'The address points at id “{id}”, which is not in the current data.',
    'entry.missingHint': 'It may have been renamed or removed. Search for it by name from the index.',
    // ---------------------------------------------------------------- status
    'status.loading': 'Loading entries…',
    'status.issues': '{count} entries were skipped (first at #{index}); run npm test for details.',
    'status.issueHint.check': 'Verify data/entries.json is committed (the name is case sensitive).',
    'status.issueHint.json': 'Check the JSON syntax with npm test.',
    'status.issueHint.http': 'If you just published, wait for GitHub Pages to finish rebuilding.',
    'store.notFound': 'Entries file not found: {url} (HTTP 404).',
    'store.httpError': 'Could not read the entries file (HTTP {status}): {url}',
    'store.notJson': '{url} is not valid JSON.',
    'store.timeout': 'Timed out reading {url}.',
    'store.unreachable': 'Could not read {url}; check your connection and try again.',
    'config.unreadable': 'config.json could not be read (HTTP {status}); using the built-in defaults.',
    'config.missing': 'config.json could not be read; using the built-in defaults.',
    'config.notRelative': 'data.url is not a relative path ({url}); only relative paths are allowed, so it was ignored.',
    // ---------------------------------------------------------------- search
    'search.error.tooLong': 'Query is too long: at most {max} characters.',
    'search.error.scopeEmpty': 'Type something after “{scope}”.',
    'search.error.regexInvalid': 'Invalid regular expression: {message}',
    'search.error.regexFlags': 'The g / y flags are not supported.',
    'search.error.regexRisky': 'This pattern can backtrack catastrophically ({reason}); it was refused. Rewrite it, for example (a+)+ → a+.',
    'search.error.budget': 'Search took longer than {ms} ms; showing partial results. Try a more specific query.',
    'search.reason.nested': 'a quantifier inside a quantified group, as in (a+)+',
    'search.reason.alternation': 'a quantifier applied to a group containing “|”',
    'search.reason.wildcards': 'consecutive .* or .+',
  },

  zh: {
    'search.label': '查询',
    'search.submit': '查找',
    'search.clear': '清空',
    'search.placeholder': '输入概念名称…（=精确 / /正则/ / tag:标签）',
    'lang.switch': '语言',
    'lang.switchTo': '切换到{language}',
    'hint.browse': '浏览全部词条（按首字母排序）',
    'hint.contains': '包含匹配',
    'hint.exact': '精确匹配',
    'hint.regex': '正则匹配',
    'hint.fields.all': '全字段',
    'hint.fields.name': '名称',
    'hint.fields.aliases': '别名',
    'hint.fields.tags': '标签',
    'hint.fields.summary': '简介',
    'hint.fields.content': '正文',
    'hint.entryPage': '输入名称可以继续查询（=精确 / /正则/），按 Esc 返回索引。',
    'hint.missingEntry': '没有找到这个词条。按 Esc 或点“索引”返回列表。',
    'count.total': '共 {count} 条',
    'count.matched': '命中 {count} 条',
    'count.showing': '显示 {shown} 条',
    'count.truncated': '（结果已截断）',
    'footer.cached': '显示本地缓存',
    'footer.updated': '{label} {date}',
    'empty.noMatch': '没有匹配「{query}」的词条。',
    'empty.noEntries': '还没有任何词条。',
    'empty.noLetter': '没有以 {letter} 开头的词条。',
    'empty.hintSearch': '可以试试包含匹配（直接输入）、=精确匹配，或 /正则/ 写法。',
    'empty.hintData': '把词条写进 data/entries.json 并提交，索引会自动更新。',
    'truncated.note': '结果过多，只显示了前 {count} 条。请把查询写得更具体一些（例如加上字段前缀 tag:）。',
    'entry.index': '← 索引',
    'entry.aliasesLabel': '别名：',
    'entry.tagsLabel': '标签：',
    'entry.id': 'id: {id}',
    'entry.noContent': '这个词条还没有正文。',
    'entry.missingTitle': '没有这个词条',
    'entry.missingBody': '地址里的 id “{id}” 在当前数据里找不到。',
    'entry.missingHint': '可能是词条被重命名或删除了。可以在索引页用搜索框按名称查找。',
    'status.loading': '正在读取词条…',
    'status.issues': '有 {count} 条词条格式不对，已跳过（第 {index} 条起）；详情见 npm test。',
    'status.issueHint.check': '确认 data/entries.json 已提交到仓库（大小写敏感）。',
    'status.issueHint.json': '用 npm test 检查该文件的 JSON 语法。',
    'status.issueHint.http': '如果刚刚发布，等 GitHub Pages 重建完成后再刷新。',
    'store.notFound': '找不到词条文件 {url}（HTTP 404）。',
    'store.httpError': '读取词条文件失败（HTTP {status}）：{url}',
    'store.notJson': '{url} 不是合法的 JSON。',
    'store.timeout': '读取 {url} 超时。',
    'store.unreachable': '无法读取 {url}，请检查网络后重试。',
    'config.unreadable': 'config.json 读取失败（HTTP {status}），使用内置默认配置。',
    'config.missing': '未能读取 config.json，使用内置默认配置。',
    'config.notRelative': 'data.url 不是相对路径（{url}）：本站约定只用相对路径，已忽略。',
    'search.error.tooLong': '查询过长：最多 {max} 个字符。',
    'search.error.scopeEmpty': '请在 “{scope}” 后输入要查找的内容。',
    'search.error.regexInvalid': '正则表达式无效：{message}',
    'search.error.regexFlags': '正则表达式不支持 g / y 标志。',
    'search.error.regexRisky': '该正则表达式可能导致灾难性回溯（{reason}），已拒绝执行。请改写表达式，例如把 (a+)+ 改成 a+。',
    'search.error.budget': '搜索超过 {ms} 毫秒，已返回部分结果。请尝试更精确的查询。',
    'search.reason.nested': '嵌套量词（如 (a+)+）',
    'search.reason.alternation': '对含“|”的分组做量词会指数级回溯',
    'search.reason.wildcards': '连续的 .* 或 .+ 会造成指数级回溯',
  },
};

/**
 * @param {string} text
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
function fill(text, params) {
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  );
}

/**
 * @param {string} locale
 * @param {Record<string, string>} [overrides] Extra or replacement strings.
 * @returns {(key: string, params?: Record<string, unknown>) => string}
 */
export function createTranslator(locale, overrides) {
  const target = Object.prototype.hasOwnProperty.call(LANGUAGE_STRINGS, locale) ? locale : 'en';
  const table = LANGUAGE_STRINGS[target];
  const fallback = LANGUAGE_STRINGS.en;
  const extra = overrides ?? {};

  return (key, params) => {
    // A plural variant only applies inside its own language: Chinese has no
    // plural form, so it must not inherit the English "1 entry".
    const pluralKey = params?.count === 1 ? `${key}.one` : key;
    const text = extra[pluralKey] ?? table[pluralKey] ?? extra[key] ?? table[key] ?? fallback[key];
    if (text === undefined) {
      // A missing key is a bug in the caller: make it obvious instead of silent.
      console.warn(`[SearchLADR] 缺少文案：${key}`);
      return key;
    }
    return fill(text, params);
  };
}

/**
 * Plural variants (`key.one`) are optional per language — Chinese has no plural
 * form — so they are not reported as missing.
 *
 * @param {string} locale
 * @returns {string[]} Keys that exist in English but are not translated yet.
 */
export function missingKeys(locale) {
  const table = LANGUAGE_STRINGS[locale] ?? {};
  return Object.keys(LANGUAGE_STRINGS.en).filter(
    (key) => !key.endsWith('.one') && table[key] === undefined,
  );
}