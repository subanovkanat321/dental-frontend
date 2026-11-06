/// <reference types="node" />
import { readFileSync } from 'node:fs'

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

// CSS читаем файлом: в тестах Vite отдаёт .css (и ?raw) пустыми
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const styles = read('../styles.css')
const learn = read('../learn/learn.css')
const teeth = read('../medical/toothChart.css')

afterEach(() => {
  window.location.hash = ''
})

/** Все правила CSS с ровно этим селектором (в начале строки), склеенные: свойства могут быть в нескольких. */
function rule(css: string, selector: string): string {
  const found = css.split('\n').flatMap((line, i, lines) => {
    if (line.trim().startsWith(`${selector} {`) === false) return []
    const rest = lines.slice(i).join('\n')
    return [rest.slice(0, rest.indexOf('}'))]
  })
  expect(found.length, `нет правила ${selector} (длина CSS ${css.length})`).toBeGreaterThan(0)
  return found.join('\n')
}

test('карточка «на весь экран»: высота от top до bottom, лишнее листается внутри', () => {
  // align-self: start у fixed-блока = высота по содержимому: низ уходил за окно, колесо ничего не листало
  const full = rule(styles, '.panel.panel-full, .day-summary.ds-full').replace(/\s+/g, ' ')
  expect(full).toContain('align-self: stretch')
  expect(full).toContain('overflow: auto')
})

test('панель справа (карточка приёма, пациента, материал, формы) прокручивается внутри и не выше окна от своего верха', () => {
  const panel = rule(styles, '.panel').replace(/\s+/g, ' ')
  // Не «100vh - 32px»: панель под шапкой раздела уходила низом за край экрана (ноутбук, масштаб 125–150%)
  expect(panel).toContain('max-height: calc(100dvh - var(--panel-top, 16px) - 16px)')
  expect(panel).toContain('overflow-y: auto')
  expect(panel).toContain('overscroll-behavior: contain')
  expect(rule(styles, '.day-summary')).toContain('var(--panel-top, 16px)')
  // Меню слева на низком окне: пункты не обрезаются — меню листается само
  expect(rule(styles, '.sidebar')).toContain('overflow-y: auto')
})

test('остальные окна поверх — со своей прокруткой: подтверждение, «Ещё», календарь, презентация, зубы во весь экран', () => {
  expect(rule(styles, '.confirm')).toContain('overflow-y: auto')
  expect(rule(styles, '.date-pop')).toContain('overflow-y: auto')
  expect(rule(styles, '.more-card')).toContain('overflow-y: auto')
  expect(rule(learn, '.lsn-stage')).toContain('overflow-y: auto')
  expect(rule(teeth, '.tooth-fullscreen')).toContain('overflow-y: auto')
})

test('открытой карточке приёма ставится --panel-top — где её верх на экране (не меньше 16px)', async () => {
  const a = appointment(10, 1, '10:00', 'Бакыт М.')
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await waitFor(() => expect(panel.style.getPropertyValue('--panel-top')).toBe('16px'))
})

test('телефон: открыта карточка — страница под ней не прокручивается (iPhone сдвигал карточку вместе со страницей)', () => {
  expect(styles).toContain('html:has(.workspace .panel), html:has(.workspace .panel) body { overflow: hidden; overscroll-behavior: none; }')
})
