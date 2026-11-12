import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { todayIn } from '../lib/time'
import { waitForSlow } from '../test/wait'

type Appointment = Schemas['AppointmentView']

/** Телефон: узкий экран и тач. desktop — узкое окно браузера с мышью: «День» списком, но без свайпов. */
function screenOf(kind: 'phone' | 'desktop') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: kind === 'phone' ? query.includes('max-width') || query.includes('coarse') : query.includes('760px'),
    media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
}

beforeEach(() => {
  screenOf('phone')
  vi.stubGlobal('innerWidth', 390) // ширина строки в jsdom 0 — порог от ширины экрана: min(35% ≈ 137, 90) = 90 px
  localStorage.setItem('crm.schedule.view', '1')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

function backend(start: Appointment) {
  let a = { ...start }
  const calls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
    http.post('*/api/appointments/:id/reminder-opened', () => {
      calls.push('opened')
      a = { ...a, reminderOpenedAt: new Date().toISOString() }
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('*/api/appointments/:id/status', async ({ request }) => {
      const body = (await request.json()) as Schemas['AppointmentRequestsChangeStatus']
      calls.push(`status:${body.status}:v${body.version}`)
      a = { ...a, status: body.status, version: a.version + 1 }
      return HttpResponse.json(a)
    }),
    http.post('*/api/appointments/:id/undo', async ({ request }) => {
      const body = (await request.json()) as Schemas['AppointmentRequestsUndo']
      calls.push(`undo:${body.previousStatus}:v${body.version}`)
      a = { ...a, status: body.previousStatus, version: a.version + 1 }
      return HttpResponse.json(a)
    }),
  )
  return calls
}

/** Палец: от (x, y) на dx, dy (тремя шагами) и отпустить. */
function swipe(el: Element, x: number, y: number, dx: number, dy = 0) {
  const at = (cx: number, cy: number) => [{ identifier: 1, clientX: cx, clientY: cy }]
  fireEvent.touchStart(el, { touches: at(x, y), changedTouches: at(x, y) })
  for (const k of [0.1, 0.5, 1]) fireEvent.touchMove(el, { touches: at(x + dx * k, y + dy * k), changedTouches: at(x + dx * k, y + dy * k) })
  fireEvent.touchEnd(el, { touches: [], changedTouches: at(x + dx, y + dy) })
}

/** Строка приёма по имени пациента: у кнопки строки имя — «…, Бакыт М.: статус» */
const rowOf = async (name: string) => (await screen.findByRole('button', { name: new RegExp(`, ${name}: `) })).closest('li')!

test('свайп вправо за порог — напоминание в WhatsApp с готовым текстом и отметка; клик после жеста карточку не открывает', async () => {
  const calls = backend(appointment(10, 1, '23:30', 'Бакыт М.'))
  const opened: string[] = []
  vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
  renderApp()
  const row = await rowOf('Бакыт М.')
  await screen.findByRole('button', { name: /Напомнить в WhatsApp: Бакыт М\./ }) // настройки загружены
  expect(row).toHaveClass('swipe')
  const button = within(row).getByRole('button', { name: /Бакыт М\.:/ })
  swipe(button, 100, 300, 200)
  expect(decodeURIComponent(opened[0]!)).toContain('Ответьте 1 — приду, 2 — перенести')
  fireEvent.click(button)
  expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument()
  await waitForSlow(() => expect(calls).toEqual(['opened']))
  expect(await within(row).findByText('✓ отправлено')).toBeInTheDocument()
})

test('во время жеста строка едет за пальцем, под ней подложка; отпустили до порога — назад, ничего не случилось', async () => {
  const calls = backend(appointment(10, 1, '23:30', 'Бакыт М.'))
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  renderApp()
  const row = await rowOf('Бакыт М.')
  await screen.findByRole('button', { name: /Напомнить в WhatsApp/ })
  const at = (cx: number) => [{ identifier: 1, clientX: cx, clientY: 300 }]
  fireEvent.touchStart(row, { touches: at(100), changedTouches: at(100) })
  fireEvent.touchMove(row, { touches: at(115), changedTouches: at(115) })
  fireEvent.touchMove(row, { touches: at(160), changedTouches: at(160) })
  expect(row).toHaveAttribute('data-swipe', 'right')
  expect(row).not.toHaveAttribute('data-swipe-armed')
  expect(row.style.getPropertyValue('--swipe-x')).toBe('60px')
  expect(within(row).getByText('💬 WhatsApp')).toBeInTheDocument()
  fireEvent.touchEnd(row, { touches: [], changedTouches: at(160) })
  expect(row).not.toHaveAttribute('data-swipe')
  expect(row.style.getPropertyValue('--swipe-x')).toBe('0px')
  expect(open).not.toHaveBeenCalled()
  expect(calls).toEqual([])
})

test('свайп влево у начавшегося приёма — «Приём состоялся» и «Вернуть»', async () => {
  const calls = backend(appointment(10, 1, '00:00', 'Бакыт М.'))
  renderApp()
  const row = await rowOf('Бакыт М.')
  swipe(row, 300, 300, -200)
  const undo = await within(row).findByRole('status')
  expect(undo).toHaveTextContent('Приём отмечен состоявшимся')
  expect(calls).toEqual(['status:DONE:v0'])
  await userEvent.click(within(undo).getByRole('button', { name: 'Вернуть' }))
  await waitForSlow(() => expect(calls).toEqual(['status:DONE:v0', 'undo:SCHEDULED:v1']))
  expect(within(row).queryByRole('status')).not.toBeInTheDocument()
})

test('порог — 35% ширины, но не больше 90px: 95px на строке 390px уже действие, 80px — ещё нет', async () => {
  const calls = backend(appointment(10, 1, '00:00', 'Бакыт М.'))
  renderApp()
  const row = await rowOf('Бакыт М.')
  swipe(row, 300, 300, -80)
  expect(within(row).queryByRole('status')).not.toBeInTheDocument()
  expect(calls).toEqual([])
  swipe(row, 300, 300, -95)
  expect(await within(row).findByRole('status')).toHaveTextContent('Приём отмечен состоявшимся')
  expect(calls).toEqual(['status:DONE:v0'])
})

test('будущий приём: влево неактивно (не начался), вправо — напоминание', async () => {
  // «Сейчас» — 10:00 по Бишкеку: иначе поздно вечером приём в 23:30 уже начался
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${todayIn()}T10:00:00+06:00`))
  try {
    const calls = backend(appointment(10, 1, '23:30', 'Бакыт М.'))
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderApp()
    const row = await rowOf('Бакыт М.')
    await screen.findByRole('button', { name: /Напомнить в WhatsApp/ })
    expect(within(row).queryByText('Состоялся ✅')).not.toBeInTheDocument()
    swipe(row, 300, 300, -250)
    expect(row).not.toHaveAttribute('data-swipe')
    expect(open).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

test('чужой приём (коллега, только просмотр) — без свайпов в обе стороны', async () => {
  const calls = backend(appointment(10, 1, '00:00', 'Бакыт М.'))
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: 2 })))
  renderApp()
  // Телефон открывает свой день — переходим к коллеге
  await userEvent.click(await screen.findByRole('button', { name: /^Чьё расписание/ }))
  await userEvent.click(within(screen.getByRole('listbox', { name: 'Чьё расписание' })).getByRole('option', { name: /Айгерим Садыкова/ }))
  const row = await rowOf('Бакыт М.')
  swipe(row, 300, 300, -250)
  swipe(row, 100, 300, 250)
  expect(within(row).queryByRole('status')).not.toBeInTheDocument()
  expect(calls).toEqual([])
})

test('вертикальный жест (прокрутка), короткий и от левого края — ничего; нажатие открывает карточку', async () => {
  const calls = backend(appointment(10, 1, '00:00', 'Бакыт М.'))
  renderApp()
  const row = await rowOf('Бакыт М.')
  swipe(row, 300, 300, -60) // короче порога
  swipe(row, 300, 300, -40, -220) // прокрутка списка
  swipe(row, 10, 300, 250) // у левого края — свайп «назад», не наш
  expect(row).not.toHaveAttribute('data-swipe')
  expect(within(row).queryByRole('status')).not.toBeInTheDocument()
  expect(calls).toEqual([])
  await new Promise((r) => setTimeout(r, 450)) // клик сразу после жеста глушится — нажимаем позже
  await userEvent.click(within(row).getByRole('button', { name: /Бакыт М\.:/ }))
  expect(screen.getByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
})

test('компьютер (мышь): без свайпов и без подсказки — кнопки', async () => {
  screenOf('desktop')
  const calls = backend(appointment(10, 1, '00:00', 'Бакыт М.'))
  renderApp()
  const row = await rowOf('Бакыт М.')
  expect(row).not.toHaveClass('swipe')
  swipe(row, 300, 300, -250)
  expect(calls).toEqual([])
  expect(screen.queryByText(/Подсказка: свайп/)).not.toBeInTheDocument()
})

test('подсказка про свайпы — один раз: закрыли — больше не показываем', async () => {
  backend(appointment(10, 1, '23:30', 'Бакыт М.'))
  const { unmount } = renderApp()
  expect(await screen.findByText('Подсказка: свайп вправо — напомнить, влево — приём состоялся')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть подсказку' }))
  expect(screen.queryByText(/Подсказка: свайп/)).not.toBeInTheDocument()
  expect(localStorage.getItem('crm.schedule.swipeHint')).toBe('seen')
  unmount()
  renderApp()
  await rowOf('Бакыт М.')
  expect(screen.queryByText(/Подсказка: свайп/)).not.toBeInTheDocument()
})

test('«Уменьшение движения» на iPhone: строка всё равно едет за пальцем (это не анимация)', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width') || query.includes('coarse') || query.includes('reduce'),
    media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
  backend(appointment(10, 1, '23:30', 'Бакыт М.'))
  renderApp()
  const row = await rowOf('Бакыт М.')
  await screen.findByRole('button', { name: /Напомнить в WhatsApp/ })
  const at = (cx: number) => [{ identifier: 1, clientX: cx, clientY: 300 }]
  fireEvent.touchStart(row, { touches: at(100), changedTouches: at(100) })
  fireEvent.touchMove(row, { touches: at(115), changedTouches: at(115) })
  fireEvent.touchMove(row, { touches: at(160), changedTouches: at(160) })
  expect(row.style.getPropertyValue('--swipe-x')).toBe('60px')
  fireEvent.touchEnd(row, { touches: [], changedTouches: at(160) })
})
