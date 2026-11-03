import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, dayTitle, slotInstant, todayIn, weekStart } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { PAD, PX } from './gridScale'

type Appointment = Schemas['AppointmentView']

/** Широкий экран компьютера: min-width-запросы совпадают, телефонные (max-width) — нет. */
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

// Следующая неделя — целиком впереди: её приёмы можно перетаскивать
const monday = weekStart(addDays(todayIn(), 7))
const tuesday = addDays(monday, 1)
const thursday = addDays(monday, 3)
const sunday = addDays(monday, 6)

/** Вымышленный приём врача 1 в день {@code date} с {@code minutes} (по Бишкеку), 30 минут. */
function visit(id: number, date: string, minutes: number, name: string, extra: Partial<Appointment> = {}): Appointment {
  const startAt = slotInstant(date, minutes)
  return {
    id, doctorId: 1, startAt, endAt: new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString(), status: 'SCHEDULED',
    reply: 'NONE', version: 4, patient: { id, fullName: name, phone: '996555000111' }, ...extra,
  }
}

function backend(list: Appointment[], who: Schemas['BookingViewsMe'] = me) {
  const moves: Schemas['AppointmentRequestsReschedule'][] = []
  const ranges: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/range', ({ request }) => {
      const q = new URL(request.url).searchParams
      ranges.push(`${q.get('from')}/${q.get('days')}/${q.get('doctorId')}`)
      return HttpResponse.json(list.filter((a) => String(a.doctorId) === q.get('doctorId')))
    }),
    http.get('*/api/slots', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date')!
      if (date === sunday) return HttpResponse.json({ workingDay: false, breaks: [], free: [] } satisfies Schemas['SlotsView'])
      return HttpResponse.json({
        workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [],
        free: [{ start: slotInstant(date, 14 * 60), end: slotInstant(date, 18 * 60) }],
      } satisfies Schemas['SlotsView'])
    }),
  )
  return { moves, ranges }
}

async function openWeek() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Неделя' }))
  await userEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }))
}

/** Колонки дней в jsdom без раскладки: день i — x от 100·i до 100·(i+1), сверху — 0. */
function layColumns() {
  for (let i = 0; i < 7; i++) {
    const column = screen.getByRole('group', { name: dayTitle(addDays(monday, i)) })
    column.getBoundingClientRect = () => ({ left: 100 * i, right: 100 * (i + 1), top: 0, bottom: 2000, width: 100, height: 2000, x: 100 * i, y: 0, toJSON: () => ({}) })
  }
}

/** Экранная y минуты дня (сетка начинается в 09:00 — часы врача). */
const yOf = (minutes: number) => PAD + (minutes - 9 * 60) * PX

/** Взять приём мышью в точке его начала и отпустить в колонке {@code day} на {@code minutes}. */
function drag(block: HTMLElement, from: { day: number; minutes: number }, to: { day: number; minutes: number }) {
  const pointer = { pointerId: 1, button: 0, pointerType: 'mouse' }
  fireEvent.pointerDown(block, { ...pointer, clientX: 100 * from.day + 50, clientY: yOf(from.minutes) + 3 })
  fireEvent.pointerMove(block, { ...pointer, clientX: 100 * to.day + 50, clientY: yOf(to.minutes) + 3 })
  fireEvent.pointerUp(block, { ...pointer, clientX: 100 * to.day + 50, clientY: yOf(to.minutes) + 3 })
  fireEvent.click(block)
}

test('неделя: семь дней врача одним запросом, выходной приглушён, приём — карточка, свободное — новая запись', async () => {
  const { ranges } = backend([visit(10, tuesday, 600, 'Бакыт М.', { status: 'REQUESTED' })])
  await openWeek()

  const tue = await screen.findByRole('group', { name: dayTitle(tuesday) })
  const block = await within(tue).findByRole('button', { name: /10:00–10:30, Бакыт М\.: Заявка/ })
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Неделя')
  expect(ranges).toContain(`${monday}/7/1`)
  // «Все врачи» в неделе нет — один врач (свой)
  expect(screen.queryByRole('button', { name: 'Все врачи' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('group', { name: dayTitle(sunday) })).getByText('Выходной')).toBeInTheDocument()

  await userEvent.click(block)
  expect(screen.getByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Бакыт М.')

  await userEvent.click(within(screen.getByRole('group', { name: dayTitle(thursday) }))
    .getByRole('button', { name: `${dayTitle(thursday)}: свободно с 14:00 до 18:00, записать` }))
  expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toBeInTheDocument()

  // Заголовок дня — тот же день в «Дне»
  await userEvent.click(screen.getByRole('button', { name: `${dayTitle(thursday)}: открыть день` }))
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(dayTitle(thursday))
})

test('перетащить приём на другой день: блок сразу на новом месте, на сервер — /reschedule с версией', async () => {
  const { moves } = backend([visit(10, tuesday, 600, 'Бакыт М.')])
  let release!: () => void
  const answered = new Promise<void>((resolve) => { release = resolve })
  server.use(http.post('*/api/appointments/10/reschedule', async ({ request }) => {
    const body = (await request.json()) as Schemas['AppointmentRequestsReschedule']
    moves.push(body)
    await answered
    return HttpResponse.json(visit(10, thursday, 660, 'Бакыт М.', { version: 5 }))
  }))
  await openWeek()
  const block = await within(await screen.findByRole('group', { name: dayTitle(tuesday) })).findByRole('button', { name: /Бакыт М\./ })
  layColumns()

  drag(block, { day: 1, minutes: 600 }, { day: 3, minutes: 660 })

  // Оптимистично: ещё до ответа сервера блок в четверге в 11:00, карточка не открылась
  const thu = screen.getByRole('group', { name: dayTitle(thursday) })
  expect(await within(thu).findByRole('button', { name: /11:00–11:30, Бакыт М\./ })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument()
  await vi.waitFor(() => expect(moves).toEqual([{ version: 4, startAt: slotInstant(thursday, 660), durationMinutes: 30 }]))
  release()
  const notice = await screen.findByRole('status')
  expect(notice).toHaveTextContent('Перенесено')
  // Видно, откуда перенесли, и можно вернуть одним нажатием (перетащили случайно)
  expect(notice).toHaveTextContent(`было: ${dayTitle(tuesday)}, 10:00`)
  server.use(http.post('*/api/appointments/10/reschedule', async ({ request }) => {
    const body = (await request.json()) as Schemas['AppointmentRequestsReschedule']
    moves.push(body)
    return HttpResponse.json(visit(10, tuesday, 600, 'Бакыт М.', { version: 6 }))
  }))
  await userEvent.click(within(notice).getByRole('button', { name: '↩ Вернуть как было' }))
  expect(await screen.findByText(/Вернули как было/)).toBeInTheDocument()
  // Обратно — с новой версией приёма (после первого переноса она 5)
  expect(moves[1]).toEqual({ version: 5, startAt: slotInstant(tuesday, 600), durationMinutes: 30 })
})

test('сервер отказал (409 «Время занято») — приём возвращается на место и видно почему', async () => {
  backend([visit(10, tuesday, 600, 'Бакыт М.')])
  server.use(http.post('*/api/appointments/10/reschedule', () => HttpResponse.json(
    { type: 'about:blank', title: 'Conflict', status: 409, detail: 'Время занято', code: 'time-taken' }, { status: 409 })))
  await openWeek()
  const tue = await screen.findByRole('group', { name: dayTitle(tuesday) })
  const block = await within(tue).findByRole('button', { name: /Бакыт М\./ })
  layColumns()

  drag(block, { day: 1, minutes: 600 }, { day: 3, minutes: 660 })

  expect(await screen.findByRole('alert')).toHaveTextContent('Не перенесли: Время занято')
  expect(await within(tue).findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  expect(within(screen.getByRole('group', { name: dayTitle(thursday) })).queryByRole('button', { name: /Бакыт М\./ })).not.toBeInTheDocument()
})

test('не тащатся: прошедший и состоявшийся приём, расписание коллеги; нажатие без сдвига — карточка', async () => {
  const lastWeek = addDays(monday, -7)
  backend([
    visit(10, tuesday, 600, 'Состоялся Т.', { status: 'DONE' }),
    visit(11, lastWeek, 600, 'Прошлый Т.'),
    { ...visit(12, tuesday, 720, 'Коллеги Т.'), doctorId: 2 },
  ], { ...me, admin: false })
  let posted = false
  server.use(http.post('*/api/appointments/:id/reschedule', () => { posted = true; return HttpResponse.json({}) }))
  await openWeek()
  const done = await within(await screen.findByRole('group', { name: dayTitle(tuesday) })).findByRole('button', { name: /Состоялся Т\./ })
  expect(done).not.toHaveClass('can-drag')
  layColumns()
  drag(done, { day: 1, minutes: 600 }, { day: 3, minutes: 660 })
  // Не перетаскивание — обычное нажатие: открылась карточка
  expect(screen.getByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Состоялся Т.')

  await userEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }))
  const past = await screen.findByRole('button', { name: /Прошлый Т\./ })
  expect(past).not.toHaveClass('can-drag')

  await userEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }))
  await userEvent.click(screen.getByRole('button', { name: 'Дастан Т.' }))
  const colleague = await screen.findByRole('button', { name: /Коллеги Т\./ })
  expect(colleague).not.toHaveClass('can-drag')
  // Чужое расписание — без «записать» в свободных окнах
  expect(screen.queryByRole('button', { name: /свободно с/ })).not.toBeInTheDocument()
  expect(posted).toBe(false)
})
