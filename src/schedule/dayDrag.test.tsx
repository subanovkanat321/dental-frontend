import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, dayTitle, slotInstant, todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { PAD, PX } from './gridScale'

type Appointment = Schemas['AppointmentView']

/**
 * Перетаскивание в сетке «Дня» (компьютер): в своей колонке — другое время (/reschedule), в колонке коллеги —
 * передать ему (/transfer); Esc — отмена; 409 — блок возвращается. Время — по Бишкеку при любой зоне компьютера
 * (файл в npm run test:tz). Пациенты вымышленные.
 */
beforeEach(() => {
  localStorage.setItem('crm.schedule.view.v2', 'all')
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

// Завтра — целиком впереди: приёмы можно тащить
const day = addDays(todayIn(), 1)

function visit(id: number, doctorId: number, minutes: number, name: string, extra: Partial<Appointment> = {}): Appointment {
  const startAt = slotInstant(day, minutes)
  return {
    id, doctorId, startAt, endAt: new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString(), status: 'SCHEDULED',
    reply: 'NONE', version: 4, source: 'DOCTOR', debtSom: 0, firstVisit: false, chairManual: false, lockedForDoctors: false,
    patient: { id, fullName: name, phone: '996555000111', telegram: false }, ...extra,
  }
}

function backend(list: Appointment[]) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const q = new URL(request.url).searchParams
      return HttpResponse.json(q.get('date') === day ? list.filter((a) => String(a.doctorId) === q.get('doctorId')) : [])
    }),
    http.get('*/api/slots', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date')!
      return HttpResponse.json({
        workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [], free: [],
        work: [{ start: slotInstant(date, 9 * 60), end: slotInstant(date, 18 * 60) }],
      } satisfies Schemas['SlotsView'])
    }),
  )
}

const DOCTORS = ['Айгерим Садыкова', 'Дастан Т.']

async function openTomorrow() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(dayTitle(day))
}

/** Колонки врачей в jsdom без раскладки: врач i — x от 100·i до 100·(i+1), сверху — 0. */
function layColumns() {
  DOCTORS.forEach((name, i) => {
    screen.getByRole('group', { name }).getBoundingClientRect = () =>
      ({ left: 100 * i, right: 100 * (i + 1), top: 0, bottom: 2000, width: 100, height: 2000, x: 100 * i, y: 0, toJSON: () => ({}) })
  })
}

/** Экранная y минуты (сетка с 09:00 — часы врачей). */
const yOf = (minutes: number) => PAD + (minutes - 9 * 60) * PX
const pointer = { pointerId: 1, button: 0, pointerType: 'mouse' }

function drag(block: HTMLElement, from: { col: number; minutes: number }, to: { col: number; minutes: number }) {
  fireEvent.pointerDown(block, { ...pointer, clientX: 100 * from.col + 50, clientY: yOf(from.minutes) + 3 })
  fireEvent.pointerMove(block, { ...pointer, clientX: 100 * to.col + 50, clientY: yOf(to.minutes) + 3 })
  fireEvent.pointerUp(block, { ...pointer, clientX: 100 * to.col + 50, clientY: yOf(to.minutes) + 3 })
  fireEvent.click(block)
}

test('«День»: перетащить на другое время у того же врача — /reschedule, блок сразу на месте, «Вернуть как было»', async () => {
  // Сервер помнит перенос: перечитанный день отдаёт приём уже на новом месте
  const list = [visit(10, 1, 600, 'Бакыт М.')]
  backend(list)
  const moves: Schemas['AppointmentRequestsReschedule'][] = []
  server.use(http.post('*/api/appointments/10/reschedule', async ({ request }) => {
    const body = (await request.json()) as Schemas['AppointmentRequestsReschedule']
    moves.push(body)
    const startAt = body.startAt
    list[0] = { ...list[0]!, version: 4 + moves.length, startAt, endAt: new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString() }
    return HttpResponse.json(list[0])
  }))
  await openTomorrow()
  const col = screen.getByRole('group', { name: DOCTORS[0] })
  const block = await within(col).findByRole('button', { name: /10:00–10:30, Бакыт М\./ })
  expect(block).toHaveClass('can-drag')
  layColumns()

  drag(block, { col: 0, minutes: 600 }, { col: 0, minutes: 690 })

  // Оптимистично в 11:30, карточка не открылась
  expect(await within(col).findByRole('button', { name: /11:30–12:00, Бакыт М\./ })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument()
  await waitForSlow(() => expect(moves).toEqual([{ version: 4, startAt: slotInstant(day, 690), durationMinutes: 30 }]))
  const notice = await screen.findByText(/Перенесено на 11:30 \(было: 10:00\)/)

  await userEvent.click(within(notice).getByRole('button', { name: '↩ Вернуть как было' }))
  expect(await screen.findByText(/Вернули как было: 10:00/)).toBeInTheDocument()
  expect(moves[1]).toEqual({ version: 5, startAt: slotInstant(day, 600), durationMinutes: 30 })
})

test('«Все врачи»: перетащить в колонку коллеги — /transfer с его doctorId', async () => {
  backend([visit(10, 1, 600, 'Бакыт М.')])
  const transfers: Schemas['AppointmentRequestsTransfer'][] = []
  server.use(http.post('*/api/appointments/10/transfer', async ({ request }) => {
    const body = (await request.json()) as Schemas['AppointmentRequestsTransfer']
    transfers.push(body)
    return HttpResponse.json(visit(10, 2, 660, 'Бакыт М.', { version: 5 }))
  }))
  await openTomorrow()
  const block = await within(screen.getByRole('group', { name: DOCTORS[0] })).findByRole('button', { name: /Бакыт М\./ })
  layColumns()

  drag(block, { col: 0, minutes: 600 }, { col: 1, minutes: 660 })

  await waitForSlow(() => expect(transfers).toEqual([{ version: 4, doctorId: 2, startAt: slotInstant(day, 660), durationMinutes: 30 }]))
  expect(await screen.findByText(/Передано: Дастан Т\., 11:00 \(было: Айгерим Садыкова, 10:00\)/)).toBeInTheDocument()
})

test('Esc во время перетаскивания — приём на месте, на сервер ничего, карточка не открылась', async () => {
  backend([visit(10, 1, 600, 'Бакыт М.')])
  let posted = false
  server.use(http.post('*/api/appointments/:id/reschedule', () => { posted = true; return HttpResponse.json({}) }))
  await openTomorrow()
  const col = screen.getByRole('group', { name: DOCTORS[0] })
  const block = await within(col).findByRole('button', { name: /Бакыт М\./ })
  layColumns()

  fireEvent.pointerDown(block, { ...pointer, clientX: 50, clientY: yOf(600) + 3 })
  fireEvent.pointerMove(block, { ...pointer, clientX: 50, clientY: yOf(720) + 3 })
  expect(block).toHaveClass('moving')
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.pointerUp(block, { ...pointer, clientX: 50, clientY: yOf(720) + 3 })
  fireEvent.click(block)

  expect(within(col).getByRole('button', { name: /10:00–10:30, Бакыт М\./ })).not.toHaveClass('moving')
  expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument()
  expect(posted).toBe(false)
})

test('сервер отказал (409 «Время занято») — приём возвращается и видно почему', async () => {
  backend([visit(10, 1, 600, 'Бакыт М.'), visit(11, 1, 690, 'Асель Т.')])
  server.use(http.post('*/api/appointments/10/reschedule', () => HttpResponse.json(
    { type: 'about:blank', title: 'Conflict', status: 409, detail: 'Время занято', code: 'time-taken' }, { status: 409 })))
  await openTomorrow()
  const col = screen.getByRole('group', { name: DOCTORS[0] })
  const block = await within(col).findByRole('button', { name: /Бакыт М\./ })
  layColumns()

  drag(block, { col: 0, minutes: 600 }, { col: 0, minutes: 690 })

  expect(await screen.findByRole('alert')).toHaveTextContent('Не перенесли: Время занято')
  expect(await within(col).findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
})

test('состоявшийся приём не тащится', async () => {
  backend([visit(10, 1, 600, 'Состоялся Т.', { status: 'DONE' })])
  await openTomorrow()
  expect(await screen.findByRole('button', { name: /Состоялся Т\./ })).not.toHaveClass('can-drag')
})
