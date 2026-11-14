/// <reference types="node" />
import { readFileSync } from 'node:fs'

// CSS читаем файлом: в тестах Vite отдаёт .css пустыми. Раскладку jsdom не считает — проверяем правила
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const crm = read('../crm.css')
const tokens = read('../tokens.css')
const flat = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')

test('на компьютере страница — во всю рабочую область: у контейнеров страниц нет колонки 880/1280/1480px', () => {
  const css = flat(crm + tokens)
  for (const box of ['.settings-item', '.schedule-main', '.medical', '.page', '.workspace']) {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel]) => sel!.split(',').some((s) => s.trim() === box || s.trim().startsWith(`${box}:is(`)))
    for (const [, sel, body] of rules) expect(body, `${sel!.trim()} ограничивает ширину страницы`).not.toMatch(/max-width:\s*\d{3,}px/)
  }
  // Таблицы — во всю ширину карточки, не по содержимому
  expect(css).toMatch(/\.table \{ width: 100%;/)
  expect(css).not.toMatch(/display:\s*inline-table/)
})

test('несколько карточек подряд — сеткой в две колонки от 1280px; широкие и без пары — во всю строку', () => {
  const css = flat(crm)
  const wide = css.slice(css.indexOf('@media (min-width: 1280px) { :is(.schedule:not(.with-panel)'))
  expect(wide).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
  expect(wide).toContain(':has(> .card-block + .card-block)')
  expect(wide).toMatch(/\.card-block:is\(\.wide, details, :has\(:is\(table, \.table-scroll/)
  expect(wide).toContain('grid-column: 1 / -1')
  // С открытой карточкой справа — только на широком окне
  expect(css).toContain('@media (min-width: 1760px) { .with-panel :where(.schedule-main')
})

test('строки текста в карточках — не длиннее ~75 знаков, а не сужение всей страницы', () => {
  const css = flat(crm)
  expect(css).toContain('.card-block > p.hint, .settings-item .card-block > p { max-width: 75ch; }')
  expect(css).toContain('.agreement-text, .faq, .privacy-text { max-width: 75ch; }')
})

test('плитки итогов делят ширину карточки поровну, сколько бы их ни было', () => {
  const css = flat(crm)
  expect(css).toContain('.salary-sums { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }')
  expect(css).toContain('.methods.profit { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }')
})

test('«Касса» на телефоне: «Вся клиника» — в одной строке с месяцем, а без инструментов — во всю ширину', () => {
  const css = flat(crm)
  expect(css).toContain('.cash > .page-head > .ui-select { flex: 1 1 0; min-width: 0; max-width: none; }')
  expect(css).toContain('.cash > .page-head > .head-tools > .month-picker { flex: none; }')
  expect(css).toContain('.cash > .page-head:not(:has(> .head-tools > *)) > .ui-select { flex-basis: 100%; }')
})
