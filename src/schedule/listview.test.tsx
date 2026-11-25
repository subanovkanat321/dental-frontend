import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { MODE_KEY, resetDefaultMode } from './viewMode'

/** Компьютер: min-width-запросы совпадают, телефонные (max-width) — нет. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function backend() {
  const today = todayIn()
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json(doctorId === 1 ? [appointment(10, 1, '10:00', 'Бакыт М.')] : [])
    }),
    http.get('*/api/slots', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json({
        workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [],
        free: doctorId === 1 ? [{ start: slotInstant(today, 13 * 60), end: slotInstant(today, 18 * 60) }] : [],
      })
    }),
  )
}

test('компьютер: «Список» — только записи и «свободно до …», без сетки; вид запоминается, «День» — снова сетка', async () => {
  backend()
  localStorage.setItem('crm.schedule.view.v2', '1')
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Список' }))
  expect(await screen.findByRole('button', { name: /^Свободно с 13:00 до 18:00, записать/ })).toBeInTheDocument()
  expect(screen.getByText('свободно до 18:00')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  expect(localStorage.getItem(MODE_KEY)).toBe('list')
  // Шапка компьютерная — одна: одна строка дня и одна «Новая запись» (своих у списка нет)
  expect(screen.getAllByRole('button', { name: 'Предыдущий день' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: '＋ Новая запись' })).toHaveLength(1)
  expect(document.querySelector('.grid-wrap')).toBeNull()

  await userEvent.click(screen.getByRole('button', { name: 'День' }))
  expect(document.querySelector('.grid-wrap')).not.toBeNull()
  expect(screen.queryByText('свободно до 18:00')).not.toBeInTheDocument()
  expect(localStorage.getItem(MODE_KEY)).toBe('day')
})

test('компьютер: по умолчанию — «Список»; прежний выбор «День» (старый ключ) не действует, свой новый выбор запоминается', async () => {
  resetDefaultMode()
  backend()
  localStorage.setItem('crm.schedule.view.v2', '1')
  localStorage.setItem('crm.schedule.mode', 'day')
  const { unmount } = renderApp()
  expect(await screen.findByRole('button', { name: /^Свободно с 13:00 до 18:00, записать/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Список' })).toHaveAttribute('aria-pressed', 'true')
  expect(document.querySelector('.grid-wrap')).toBeNull()
  // Старый ключ стёрт: больше не мешает
  expect(localStorage.getItem('crm.schedule.mode')).toBeNull()

  // Выбрали «День» — в следующий раз откроется он
  await userEvent.click(screen.getByRole('button', { name: 'День' }))
  expect(document.querySelector('.grid-wrap')).not.toBeNull()
  unmount()
  renderApp()
  expect(await screen.findByRole('button', { name: 'День' })).toHaveAttribute('aria-pressed', 'true')
  expect(document.querySelector('.grid-wrap')).not.toBeNull()
})
