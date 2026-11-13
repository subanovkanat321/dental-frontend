import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

afterEach(() => {
  window.location.hash = ''
  vi.unstubAllGlobals()
})

test('«Помощь» внизу меню (компьютер): список — чат первым, руководство, видео, техподдержка, отзыв, конфиденциальность, Instagram; чат открывается и закрывается', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
    http.get('*/api/support/chat', () => HttpResponse.json({ ai: true, dailyLimit: 20, usedToday: 0, maxLength: 1000 })),
  )
  renderApp()
  // Пункт меню (не плавающая кнопка в углу: та закрывала последнюю строку таблиц)
  const item = await screen.findByRole('button', { name: 'Помощь' })
  expect(item.closest('aside')).toHaveClass('sidebar')
  expect(item).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(item)
  const menu = screen.getByRole('dialog', { name: 'Помощь' })
  expect(item).toHaveAttribute('aria-expanded', 'true')
  expect(within(menu).getAllByRole('button').map((b) => b.querySelector('.menu-title')?.textContent)).toEqual([
    'Спросить помощника', 'Руководство', 'Видео: как сделать', 'Помощь и техподдержка', 'Отзыв о Tish', 'Конфиденциальность', 'Пройти тур ещё раз', 'Tish в Instagram',
  ])
  await userEvent.click(within(menu).getByRole('button', { name: /^Спросить помощника/ }))
  expect(screen.queryByRole('dialog', { name: 'Помощь' })).not.toBeInTheDocument()
  const chat = await screen.findByRole('complementary', { name: 'Помощь' })
  expect(await within(chat).findByText(/Спросите, как что-то сделать в Tish/)).toBeInTheDocument()
  await userEvent.click(within(chat).getAllByRole('button', { name: 'Закрыть' }).at(-1)!)
  await waitForSlow(() => expect(screen.queryByRole('complementary', { name: 'Помощь' })).not.toBeInTheDocument())

  // Пункт списка — свой экран (#/help/…), «Помощь» подсвечена; Esc закрывает список
  await userEvent.click(item)
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Помощь' })).getByRole('button', { name: 'Руководство' }))
  expect(window.location.hash).toBe('#/help/guide')
  expect(await screen.findByRole('heading', { name: 'Руководство' })).toBeInTheDocument()
  expect(item).toHaveClass('active')
  await userEvent.click(item)
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Помощь' })).not.toBeInTheDocument()
  // Из «Настроек» группа «Помощь» ушла; плавающей кнопки на компьютере нет
  window.location.hash = '#/settings'
  const tabs = await screen.findByRole('navigation', { name: 'Подразделы: Настройки' })
  expect(within(tabs).queryByRole('link', { name: 'Руководство' })).not.toBeInTheDocument()
  expect(document.querySelector('.help-fab')).toBeNull()
})

test('телефон: «Помощь» — маленькая круглая кнопка на главных экранах (в меню её нет), открывает тот же чат', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 760px'), addEventListener() {}, removeEventListener() {} }))
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
    http.get('*/api/support/chat', () => HttpResponse.json({ ai: true, dailyLimit: 20, usedToday: 0, maxLength: 1000 })),
  )
  renderApp()
  const fab = await screen.findByRole('button', { name: 'Помощь: спросить помощника Tish' })
  expect(fab).toHaveClass('help-fab')
  expect(fab).toHaveTextContent('💬')
  expect(fab).not.toHaveTextContent('Помощь')
  await userEvent.click(fab)
  expect(await screen.findByRole('complementary', { name: 'Помощь' })).toBeInTheDocument()
})

test('телефон: «Ещё → Помощь» — тот же список листом снизу', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 760px'), addEventListener() {}, removeEventListener() {} }))
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Ещё' }))
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Ещё разделы' })).getByRole('button', { name: 'Помощь' }))
  const sheet = screen.getByRole('dialog', { name: 'Помощь' })
  expect(sheet).toHaveClass('menu-sheet')
  await userEvent.click(within(sheet).getByRole('button', { name: 'Конфиденциальность' }))
  expect(window.location.hash).toBe('#/help/privacy')
  expect(screen.queryByRole('dialog', { name: 'Помощь' })).not.toBeInTheDocument()
})

test('«Помощь → Группа врачей Tish»: ссылка из «Сведений о платформе» открывается наружу; без ссылки пункта нет', async () => {
  const group = 'https://t.me/+tYKBuv9OgZ40YTky'
  let info: Schemas['PlatformInfoInfo'] = { doctorsGroupUrl: group, accessLog: false, accessNotify: false, accessRequiresGrant: false }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/platform-info', () => HttpResponse.json(info)),
  )
  const open = vi.fn()
  vi.stubGlobal('open', open)
  const view = renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Помощь' }))
  const menu = screen.getByRole('dialog', { name: 'Помощь' })
  const item = await within(menu).findByRole('button', { name: /^Группа врачей Tish/ })
  // Перед Instagram: обе — ссылки наружу
  expect(within(menu).getAllByRole('button').map((b) => b.querySelector('.menu-title')?.textContent).slice(-2))
    .toEqual(['Группа врачей Tish', 'Tish в Instagram'])
  await userEvent.click(item)
  expect(open).toHaveBeenCalledWith(group, '_blank', 'noopener')
  expect(screen.queryByRole('dialog', { name: 'Помощь' })).not.toBeInTheDocument()
  view.unmount()

  // Владелец очистил поле — пункта нет
  info = { accessLog: false, accessNotify: false, accessRequiresGrant: false }
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Помощь' }))
  const empty = screen.getByRole('dialog', { name: 'Помощь' })
  expect(await within(empty).findByRole('button', { name: /^Tish в Instagram/ })).toBeInTheDocument()
  expect(within(empty).queryByRole('button', { name: /Группа врачей/ })).not.toBeInTheDocument()
})
