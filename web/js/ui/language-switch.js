/**
 * The language switch: two plain text links, in the spirit of the rest of the
 * page (no dropdown, no flags).
 *
 * Switching re-renders everything — header, search box, index, entry page,
 * footer, status line — and is remembered for the next visit.
 */

import { LOCALE_LABELS, LOCALES } from '../core/locale.js';
import { el } from './dom.js';

/**
 * @param {{onSelect: (locale: string) => void, t: (key: string) => string}} options
 * @returns {{element: HTMLElement, update: (locale: string) => void}}
 */
export function createLanguageSwitch(options) {
  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();

  const element = el('nav.lang', { 'aria-label': 'Language / 语言', lang: 'en' }, [
    el('span.lang__label', { text: '' }),
    ...LOCALES.map((locale) => {
      const button = el('button.lang__item', {
        type: 'button',
        text: LOCALE_LABELS[locale],
        lang: locale === 'zh' ? 'zh-CN' : 'en',
        dataset: { locale },
        on: { click: () => options.onSelect(locale) },
      });
      buttons.set(locale, button);
      return button;
    }).flatMap((button, index) => (index === 0 ? [button] : [el('span.lang__sep', { text: '·' }), button])),
  ]);

  return {
    element,
    /**
     * @param {string} locale
     */
    update(locale) {
      element.querySelector('.lang__label').textContent = options.t('lang.switch');
      for (const [code, button] of buttons) {
        const active = code === locale;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-current', active ? 'true' : 'false');
        button.disabled = active;
        button.title = active
          ? LOCALE_LABELS[code]
          : options.t('lang.switchTo', { language: LOCALE_LABELS[code] });
      }
    },
  };
}