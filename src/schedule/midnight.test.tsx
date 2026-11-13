import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useRef, useState } from 'react'

import type { Schemas } from '../api/client'
import { addDays, dayTitle, slotInstant, todayIn, weekStart } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { PAD, PX, useFitToWindow } from './gridScale'
import { gridRange, hourLabel } from './workSpans'

type Appointment = Schemas['AppointmentView']

/**
 * Приём вечером через полночь (23:45–00:45) у дневного врача: в своём дне виден целиком — сетка
 * продлена после 24:00 (не больше 4 часов); на следующий день — «со вчера»; у ночной смены (сетка
 * и так на сутки) — обрезан полуночью с подписью «→ до …». Пациенты вымышленные.
 */
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

/** Вымышленный приём врача 1 с {@code minutes} от полуночи дня {@code date}, длиной {@code duration}. */
function visit(id: number, date: string, minutes: number, duration: number, name: string): Appointment {
  const startAt = slotInstant(date, minutes)
  return {
    id, doctorId: 1, startAt, endAt: new Date(new Date(startAt).getTime() + duration * 60_000).toISOString(), status: 'SCHEDULED',
    reply: 'NONE', version: 3, source: 'DOCTOR', debtSom: 0, firstVisit: true, patient: { id, fullName: name, phone: '996555000111', telegram: false },
  }
}

const day = addDays(todayIn(), 1)
const dayShift = (date: string): Schemas['SlotsView'] => ({
  workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [],
  work: [{ start: slotInstant(date, 9 * 60), end: slotInstant(date, 18 * 60) }],
  free: [{ start: slotInstant(date, 9 * 60), end: slotInstant(date, 18 * 60) }],
})

/** «День» врача 1: приём завтра 23:45–00:45; на послезавтра сервер отдаёт его с overnight. */
function dayBackend(list: Appointment[]) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const q = new URL(request.url).searchParams
      if (q.get('doctorId') !== '1') return HttpResponse.json([])
      const date = q.get('date')!
      const from = new Date(`${date}T00:00:00+06:00`).getTime()
      return HttpResponse.json(list.filter((a) => {
        const s = new Date(a.startAt).getTime()
        const e = new Date(a.endAt).getTime()
        return (s >= from && s < from + 864e5) || (q.get('overnight') === 'true' && s < from && e > from)
      }))
    }),
    http.get('*/api/slots', ({ request }) => HttpResponse.json(dayShift(new URL(request.url).searchParams.get('date')!))),
  )
}

test('дневной врач, приём 23:45–00:45: сетка продлена до 01:00, блок целиком, «полночь» и «завтра» у 00:00', async () => {
  dayBackend([visit(30, day, 23 * 60 + 45, 60, 'Канат Вымышленный')])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const column = await screen.findByRole('group', { name: 'Айгерим Садыкова' })
  const block = await within(column).findByRole('button', { name: /^23:45–00:45, Канат Вымышленный/ })
  // Полная высота часа, а не полоска до полуночи; без маркера обрезки
  expect(block.style.height).toBe(`${60 * PX - 2}px`)
  expect(block).not.toHaveClass('continues')
  expect(block.style.top).toBe(`${PAD + (23 * 60 + 45 - 9 * 60) * PX}px`)
  // Сетка 09:00 → 01:00: подписи часов после полуночи — 00:00 с пометкой «завтра»
  const times = document.querySelector('.grid-times') as HTMLElement
  expect(within(times).getByText('00:00')).toBeInTheDocument()
  expect(within(times).getByText('завтра')).toBeInTheDocument()
  expect(within(times).queryByText('24:00')).not.toBeInTheDocument()
  expect(column.style.height).toBe(`${(25 * 60 - 9 * 60) * PX + PAD * 2}px`)
  expect(document.querySelectorAll('.grid-midnight')).toHaveLength(2)
  expect(screen.getByText(`полночь · ${dayTitle(addDays(day, 1)).toLowerCase()}`)).toBeInTheDocument()
  // После полуночи — уже следующий день: свободное окно туда не рисуем, нерабочее — серым до конца сетки
  expect(within(column).getAllByRole('button', { name: /^Свободно/ })).toHaveLength(1)
  expect(column.querySelector('.grid-off:last-of-type')).toBeTruthy()
  // Нажали на пустое место после полуночи — новая запись на следующий день
  column.getBoundingClientRect = () => ({ top: 0, bottom: 3000, left: 0, right: 300, width: 300, height: 3000, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.click(column, { clientY: PAD + (24 * 60 + 30 - 9 * 60) * PX + 2 })
  const panel = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(panel).toHaveTextContent(dayTitle(addDays(day, 1)))

  // Следующий день: тот же приём с 00:00 «со вчера», сетка с полуночи и без продления
  await userEvent.click(screen.getByRole('button', { name: 'Следующий день' }))
  const next = await within(await screen.findByRole('group', { name: 'Айгерим Садыкова' }))
    .findByRole('button', { name: /^со вчера 23:45–00:45, Канат Вымышленный/ })
  expect(next).toHaveClass('carried')
  expect(next.style.top).toBe(`${PAD}px`)
  expect(next.style.height).toBe(`${45 * PX - 2}px`)
  expect(document.querySelector('.grid-midnight')).toBeNull()
})

test('приём дольше 4 часов после полуночи: сетка продлена только до 04:00, блок обрезан с подписью «→ до 05:00»', async () => {
  dayBackend([visit(31, day, 22 * 60, 7 * 60, 'Долгий Вымышленный')])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const column = await screen.findByRole('group', { name: 'Айгерим Садыкова' })
  const block = await within(column).findByRole('button', { name: /^22:00–05:00, Долгий Вымышленный/ })
  expect(block).toHaveClass('continues')
  expect(within(block).getByText('→ до 05:00')).toBeInTheDocument()
  expect(block.style.height).toBe(`${(28 * 60 - 22 * 60) * PX - 2}px`)
  expect(column.style.height).toBe(`${(28 * 60 - 9 * 60) * PX + PAD * 2}px`)
})

test('границы сетки: продление после полуночи, ночная смена и «со вчера» — без продления', () => {
  const d = '2026-11-20'
  const work: [number, number][] = [[540, 1080]]
  const clinic: [number, number] = [540, 1080]
  // 23:45–00:45 → до 01:00, виден целиком
  expect(gridRange(work, [visit(1, d, 1425, 60, 'А')], [d], clinic)).toEqual({ from: 540, to: 1500, limit: 1680 })
  // Ночная смена (00:00–08:00 и 18:00–24:00): сутки целиком, без продления
  expect(gridRange([[0, 480], [1080, 1440]], [visit(1, d, 1425, 60, 'А')], [d], clinic)).toEqual({ from: 0, to: 1440, limit: 1440 })
  // Приём со вчера в этом дне — сетка с полуночи, свой поздний приём обрезан полуночью
  expect(gridRange(work, [visit(1, addDays(d, -1), 1425, 60, 'Б'), visit(2, d, 1425, 60, 'А')], [d], clinic)).toEqual({ from: 0, to: 1440, limit: 1440 })
  // Неделя: хвост длиннее 4 часов, а следующий день — тоже колонка: показываем его там «со вчера»
  expect(gridRange(work, [visit(1, d, 1380, 360, 'В')], [d, addDays(d, 1)], clinic).limit).toBe(1440)
  // Без часов врача — часы клиники
  expect(gridRange([], [], [d], clinic)).toEqual({ from: 540, to: 1080, limit: 1680 })
  expect(hourLabel(1440)).toBe('00:00')
  expect(hourLabel(1500)).toBe('01:00')
})

/** «Неделя» следующей недели: приём во вторник 23:45–00:45. */
test('неделя: поздний приём целиком во вторнике (сетка продлена), в среде продолжения нет; перетащить можно', async () => {
  const monday = weekStart(addDays(todayIn(), 7))
  const tuesday = addDays(monday, 1)
  const thursday = addDays(monday, 3)
  const moves: Schemas['AppointmentRequestsReschedule'][] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/range', ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('doctorId') === '1' ? [visit(40, tuesday, 23 * 60 + 45, 60, 'Канат Вымышленный')] : [])),
    http.get('*/api/slots', ({ request }) => HttpResponse.json(dayShift(new URL(request.url).searchParams.get('date')!))),
    http.post('*/api/appointments/40/reschedule', async ({ request }) => {
      moves.push((await request.json()) as Schemas['AppointmentRequestsReschedule'])
      return HttpResponse.json(visit(40, thursday, 10 * 60, 60, 'Канат Вымышленный'))
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Неделя' }))
  await userEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }))
  const tue = await screen.findByRole('group', { name: dayTitle(tuesday) })
  const block = await within(tue).findByRole('button', { name: /^23:45–00:45, Канат Вымышленный/ })
  expect(block.style.height).toBe(`${60 * PX - 2}px`)
  expect(block).not.toHaveClass('continues')
  expect(within(screen.getByRole('group', { name: dayTitle(addDays(monday, 2)) })).queryByRole('button', { name: /Канат/ })).not.toBeInTheDocument()
  expect(within(document.querySelector('.grid-times') as HTMLElement).getByText('след. день')).toBeInTheDocument()

  // Перетаскивание не сломано: взяли за верх, отпустили в четверг в 10:00 — на сервер час, как был
  for (let i = 0; i < 7; i++) {
    const column = screen.getByRole('group', { name: dayTitle(addDays(monday, i)) })
    column.getBoundingClientRect = () => ({ left: 100 * i, right: 100 * (i + 1), top: 0, bottom: 3000, width: 100, height: 3000, x: 100 * i, y: 0, toJSON: () => ({}) })
  }
  const yOf = (m: number) => PAD + (m - 9 * 60) * PX + 3
  const pointer = { pointerId: 1, button: 0, pointerType: 'mouse' }
  fireEvent.pointerDown(block, { ...pointer, clientX: 150, clientY: yOf(23 * 60 + 45) })
  fireEvent.pointerMove(block, { ...pointer, clientX: 350, clientY: yOf(10 * 60) })
  fireEvent.pointerUp(block, { ...pointer, clientX: 350, clientY: yOf(10 * 60) })
  fireEvent.click(block)
  await waitForSlow(() => expect(moves).toEqual([{ version: 3, startAt: slotInstant(thursday, 10 * 60), durationMinutes: 60 }]))
})

/** Сетка «до низа окна»: под ней — только легенда, сколько бы ни менялось то, что над ней. */
function Fit() {
  const grid = useRef<HTMLDivElement>(null)
  const [banner, setBanner] = useState(true)
  useFitToWindow(grid, 'k')
  return (
    <section className="schedule-main">
      {banner && <p className="banner"><button type="button" onClick={() => setBanner(false)}>Закрыть</button></p>}
      <div className="grid-wrap"><div ref={grid} className="grid" data-testid="grid" /></div>
      <p className="badges-legend" data-testid="legend">легенда</p>
    </section>
  )
}

test('сетка до низа окна: под ней — высота легенды, а не «низ раздела минус низ сетки»; закрыли плашку — пересчёт', async () => {
  const rect = (top: number, height: number) => () => ({ top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) })
  // Раздел растянут выше содержимого (как при пересчёте в середине перестройки) — на расчёт не влияет
  const proto = HTMLElement.prototype.getBoundingClientRect
  let gridTop = 180
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.dataset.testid === 'grid') return rect(gridTop, 500)()
    if (this.dataset.testid === 'legend') return rect(gridTop + 506, 20)()
    if (this.classList.contains('schedule-main')) return rect(0, 2000)()
    return proto.call(this)
  }
  try {
    render(<Fit />)
    const grid = screen.getByTestId('grid')
    expect(grid.style.getPropertyValue('--grid-top')).toBe('180px')
    expect(grid.style.getPropertyValue('--grid-below')).toBe('20px')
    gridTop = 124
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(grid.style.getPropertyValue('--grid-top')).toBe('124px'))
    expect(grid.style.getPropertyValue('--grid-below')).toBe('20px')
  } finally {
    HTMLElement.prototype.getBoundingClientRect = proto
  }
})
