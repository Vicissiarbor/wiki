/**
 * The entry editor (create / edit) and the JSON export helpers.
 *
 * Validation uses the very same core function as the backend, so an entry that
 * the editor accepts is guaranteed to be accepted by the server and vice versa.
 */

import { inspectEntry } from '../core/entry.js';
import { renderMarkdown } from '../core/markdown.js';
import { el, fragment } from './dom.js';
import { createModal } from './modal.js';
import { copyText, toastError, toastSuccess } from './toast.js';

/**
 * @param {string} value
 * @returns {string[]} Split a comma/、 separated field into a list.
 */
export function splitList(value) {
  return String(value ?? '')
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * @param {{getCollection: () => import('../core/collection.js').EntryCollection,
 *   onSave: (entry: object) => Promise<void>,
 *   onDelete: (entry: object) => Promise<void>}} options
 * @returns {{openCreate: (seed?: object) => void, openEdit: (entry: object) => void}}
 */
export function createEntryEditor(options) {
  /** @type {import('../core/entry.js').Entry|null} */
  let editing = null;

  const nameInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'f-name',
      type: 'text',
      name: 'name',
      maxlength: '200',
      autocomplete: 'off',
      'aria-describedby': 'editor-issues',
    })
  );
  const aliasesInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'f-aliases',
      type: 'text',
      name: 'aliases',
      autocomplete: 'off',
      placeholder: '用逗号分隔，例如：熵、entropy',
    })
  );
  const initialInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'f-initial',
      type: 'text',
      name: 'initial',
      maxlength: '1',
      placeholder: '自动',
      title: '可选：强制归属的字母（A-Z 或 #），留空则按名称自动判断',
    })
  );
  const tagsInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'f-tags',
      type: 'text',
      name: 'tags',
      autocomplete: 'off',
      placeholder: '用逗号分隔，例如：物理、信息论',
    })
  );
  const summaryInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'f-summary',
      type: 'text',
      name: 'summary',
      maxlength: '500',
      placeholder: '一句话说明',
    })
  );
  const contentInput = /** @type {HTMLTextAreaElement} */ (
    el('textarea', {
      id: 'f-content',
      name: 'content',
      rows: '14',
      spellcheck: 'false',
      placeholder: '正文。支持 Markdown 子集：## 标题、- 列表、**粗体**、`代码`、[链接](url)、[[其他词条]]',
    })
  );

  const issuesBox = el('ul.editor__issues', { id: 'editor-issues', hidden: true });
  const previewBox = el('div.editor__preview', { hidden: true });
  const editPane = el('div.editor__pane', {}, [contentInput]);
  const editTab = el('button.tab.is-active', {
    type: 'button',
    text: '编辑',
    on: { click: () => switchTab('edit') },
  });
  const previewTab = el('button.tab', {
    type: 'button',
    text: '预览',
    on: { click: () => switchTab('preview') },
  });
  const tabs = el('div.editor__tabs', {}, [editTab, previewTab]);

  /**
   * @param {'edit'|'preview'} which
   */
  function switchTab(which) {
    const isPreview = which === 'preview';
    editPane.hidden = isPreview;
    previewBox.hidden = !isPreview;
    editTab.classList.toggle('is-active', !isPreview);
    previewTab.classList.toggle('is-active', isPreview);
    if (isPreview) {
      previewBox.replaceChildren(
        el('div.detail__content', {
          html: renderMarkdown(contentInput.value, {
            resolveTermLink: (name) => {
              const target = options.getCollection().byName(name);
              return target ? `#/?e=${encodeURIComponent(target.id)}` : null;
            },
          }),
        }),
      );
    }
  }

  const modal = createModal({ title: '新增词条', size: 'lg' });

  const saveButton = el('button.button.primary', {
    type: 'button',
    text: '保存',
    on: { click: () => submit() },
  });

  /**
   * @returns {{entry: object|null, issues: Array<{field: string, message: string, code?: string}>}}
   */
  function readForm() {
    const collection = options.getCollection();
    const raw = {
      id: editing?.id ?? '',
      name: nameInput.value.trim(),
      aliases: splitList(aliasesInput.value),
      initial: initialInput.value.trim().toUpperCase(),
      tags: splitList(tagsInput.value),
      summary: summaryInput.value.trim(),
      content: contentInput.value.replace(/\r\n?/g, '\n').trim(),
      createdAt: editing?.createdAt ?? '',
      updatedAt: editing?.updatedAt ?? '',
    };
    const siblings = collection.entries.filter((item) => item.id !== (editing?.id ?? ''));
    const { entry, issues } = inspectEntry(raw, { siblings });
    return { entry: entry ? { ...entry, id: raw.id } : null, issues };
  }

  /**
   * @param {boolean} [showIssues]
   * @returns {boolean} True when the form can be saved.
   */
  function validate(showIssues = true) {
    const { entry, issues } = readForm();
    // A missing id is expected when creating: it is generated on save.
    const blocking = issues.filter((issue) => issue.code !== 'missing');
    issuesBox.hidden = !showIssues || blocking.length === 0;
    issuesBox.replaceChildren(
      fragment(blocking.map((issue) => el('li', { text: `${issue.field}：${issue.message}` }))),
    );
    saveButton.disabled = blocking.length > 0 || (entry?.name ?? '') === '';
    return blocking.length === 0;
  }

  async function submit() {
    const { entry, issues } = readForm();
    if (entry === null || issues.some((issue) => issue.code !== 'missing')) {
      validate(true);
      modal.setStatus('请先修正表单中的问题。', 'error');
      return;
    }
    saveButton.disabled = true;
    modal.setStatus('正在保存…', 'info');
    try {
      await options.onSave(entry);
      modal.close();
      toastSuccess(editing ? `已更新「${entry.name}」` : `已新增「${entry.name}」`);
    } catch (error) {
      modal.setStatus(error instanceof Error ? error.message : String(error), 'error');
      saveButton.disabled = false;
    }
  }

  const deleteButton = el('button.button.danger', {
    type: 'button',
    text: '删除',
    on: {
      click: async () => {
        if (!editing) {
          return;
        }
        const entry = editing;
        modal.setStatus('正在删除…', 'info');
        try {
          await options.onDelete(entry);
          modal.close();
          toastSuccess(`已删除「${entry.name}」`);
        } catch (error) {
          modal.setStatus(error instanceof Error ? error.message : String(error), 'error');
        }
      },
    },
  });

  const exportButton = el('button.button', {
    type: 'button',
    text: '复制 JSON',
    title: '复制该词条的 JSON，便于手工提交到仓库',
    on: {
      click: async () => {
        const { entry } = readForm();
        const ok = await copyText(JSON.stringify(entry ?? {}, null, 2));
        if (ok) {
          toastSuccess('词条 JSON 已复制到剪贴板');
        } else {
          toastError('复制失败，请手动选择文本');
        }
      },
    },
  });

  const form = el(
    'form.editor',
    {
      novalidate: 'novalidate',
      on: {
        submit: (/** @type {Event} */ event) => {
          event.preventDefault();
          submit();
        },
        input: () => validate(),
      },
    },
    [
      el('div.editor__row', {}, [
        el('div.editor__field', {}, [
          el('label', { for: 'f-name', text: '名称 *' }),
          nameInput,
        ]),
        el('div.editor__field.editor__field--narrow', {}, [
          el('label', { for: 'f-initial', text: '首字母' }),
          initialInput,
        ]),
      ]),
      el('div.editor__field', {}, [
        el('label', { for: 'f-aliases', text: '别名' }),
        aliasesInput,
      ]),
      el('div.editor__field', {}, [el('label', { for: 'f-tags', text: '标签' }), tagsInput]),
      el('div.editor__field', {}, [
        el('label', { for: 'f-summary', text: '简介' }),
        summaryInput,
      ]),
      el('div.editor__field', {}, [
        el('div.editor__field-head', {}, [
          el('label', { for: 'f-content', text: '正文（Markdown 子集）' }),
          tabs,
        ]),
        editPane,
        previewBox,
      ]),
      issuesBox,
    ],
  );

  modal.setBody([form]);
  modal.footer.append(exportButton, deleteButton, saveButton);

  /**
   * @param {import('../core/entry.js').Entry|null} entry
   * @param {string} title
   */
  function prepare(entry, title) {
    editing = entry;
    modal.setTitle(title);
    nameInput.value = entry?.name ?? '';
    aliasesInput.value = (entry?.aliases ?? []).join('、');
    initialInput.value = entry?.initial ?? '';
    tagsInput.value = (entry?.tags ?? []).join('、');
    summaryInput.value = entry?.summary ?? '';
    contentInput.value = entry?.content ?? '';
    deleteButton.hidden = entry === null;
    modal.setStatus('');
    switchTab('edit');
    validate(false);
  }

  return {
    /**
     * @param {{name?: string, content?: string}} [seed]
     */
    openCreate(seed = {}) {
      prepare(null, '新增词条');
      if (seed.name) {
        nameInput.value = seed.name;
      }
      if (seed.content) {
        contentInput.value = seed.content;
      }
      modal.open();
      nameInput.focus();
      nameInput.select();
    },
    openEdit(entry) {
      prepare(entry, `编辑「${entry.name}」`);
      modal.open();
      nameInput.focus();
      nameInput.select();
    },
  };
}