import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  window.location.hash = ''
})

test('«Помощь» внизу меню (компьютер): открывает чат с помощником, закрывается; пункт есть и в «Настройках»', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
    http.get('*/api/support/chat', () => HttpResponse.json({ ai: true, dailyLimit: 20, usedToday: 0, maxLength: 1000 })),
  )
  renderApp()
  // Пункт меню (не плавающая кнопка в углу: та закрывала последнюю строку таблиц)
  const item = await screen.findByRole('button', { name: 'Помощь: спросить помощника Tish' })
  expect(item.closest('aside')).toHaveClass('sidebar')
  expect(item).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(item)
  const chat = await screen.findByRole('complementary', { name: 'Помощь' })
  expect(await within(chat).findByText(/Спросите, как что-то сделать в Tish/)).toBeInTheDocument()
  expect(item).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(within(chat).getAllByRole('button', { name: 'Закрыть' }).at(-1)!)
  await vi.waitFor(() => expect(screen.queryByRole('complementary', { name: 'Помощь' })).not.toBeInTheDocument())
  expect(item).toHaveAttribute('aria-expanded', 'false')

  // Меню одно на все разделы: в «Настройках» пункт тот же
  window.location.hash = '#/settings'
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Помощь: спросить помощника Tish' }).closest('aside')).toHaveClass('sidebar'))
  // Плавающей кнопки на компьютере нет
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
