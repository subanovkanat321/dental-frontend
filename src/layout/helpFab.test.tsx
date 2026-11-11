import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  window.location.hash = ''
  vi.unstubAllGlobals()
})

test('«Помощь» внизу меню (компьютер): список — чат первым, руководство, техподдержка, отзыв, конфиденциальность, Instagram; чат открывается и закрывается', async () => {
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
    'Спросить помощника', 'Руководство', 'Помощь и техподдержка', 'Отзыв о Tish', 'Конфиденциальность', 'Пройти тур ещё раз', 'Tish в Instagram',
  ])
  await userEvent.click(within(menu).getByRole('button', { name: /^Спросить помощника/ }))
  expect(screen.queryByRole('dialog', { name: 'Помощь' })).not.toBeInTheDocument()
  const chat = await screen.findByRole('complementary', { name: 'Помощь' })
  expect(await within(chat).findByText(/Спросите, как что-то сделать в Tish/)).toBeInTheDocument()
  await userEvent.click(within(chat).getAllByRole('button', { name: 'Закрыть' }).at(-1)!)
  await vi.waitFor(() => expect(screen.queryByRole('complementary', { name: 'Помощь' })).not.toBeInTheDocument())

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
  expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
  expect(screen.queryByText('Руководство', { selector: '.settings-text strong' })).not.toBeInTheDocument()
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
