import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'

import type { Schemas } from '../api/client'
import { DateInput } from '../layout/DateInput'
import { wishText } from '../patients/wish'
import { dateOf, dayTitle, minutesOf, nowMinutes5, slotInstant, suggestTime, timeOf, todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { PAD, PX } from './gridScale'

/**
 * Время клиники — Бишкек (UTC+6), а не зона компьютера. Ошибка конкурента: компьютер в Москве, приём перетащили —
 * он сохранился на 3 часа мимо. Эти тесты гоняются и в обычном прогоне, и с чужой зоной процесса
 * (`npm run test:tz`: Europe/Moscow, America/New_York, UTC): ожидания — буквальные UTC-строки, не через slotInstant.
 * Пациенты вымышленные.
 */

type Appointment = Schemas['AppointmentView']

/** 01:00 пятницы 27 ноября по Бишкеку = 19:00 четверга 26 ноября в UTC (в Москве ещё 22:00 26-го, в Нью-Йорке 14:00). */
const NIGHT = '2026-11-26T19:00:00Z'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

test('зона процесса подхватилась: TZ из окружения — та, что видит Intl (иначе прогон test:tz ничего не проверяет)', () => {
  const tz = process.env.TZ
  if (tz) expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz === 'UTC' ? 'UTC' : tz)
})

test('«сегодня» по Бишкеку: 23:30 (17:30Z) — ещё 27-е; 01:00 (19:00Z прошлого UTC-дня) — уже 27-е', () => {
  expect(todayIn(new Date('2026-11-27T17:30:00Z'))).toBe('2026-11-27')
  expect(todayIn(new Date('2026-11-27T18:00:00Z'))).toBe('2026-11-28')
  expect(todayIn(new Date(NIGHT))).toBe('2026-11-27')
  expect(dateOf(NIGHT)).toBe('2026-11-27')
  expect(timeOf(NIGHT)).toBe('01:00')
  expect(minutesOf(NIGHT)).toBe(60)
  expect(nowMinutes5(new Date('2026-11-27T04:47:00Z'))).toBe(10 * 60 + 45)
  // «Другое время» сегодня — от «сейчас» по Бишкеку, не по зоне компьютера
  expect(suggestTime('2026-11-27', '09:00:00', 5, new Date('2026-11-27T16:43:00Z'))).toBe('22:45')
  expect(suggestTime('2026-11-27', '09:00:00', 5, new Date(NIGHT))).toBe('09:00')
})

test('слот 11:15 по Бишкеку → 05:15Z при любой зоне компьютера; полночь и 23:45 — свои UTC-дни', () => {
  expect(slotInstant('2026-11-27', 11 * 60 + 15)).toBe('2026-11-27T05:15:00.000Z')
  expect(slotInstant('2026-11-27', 0)).toBe('2026-11-26T18:00:00.000Z')
  expect(slotInstant('2026-11-27', 23 * 60 + 45)).toBe('2026-11-27T17:45:00.000Z')
})

test('«Когда удобно» в листе ожидания: дни «с … по …» не съезжают на соседний день', () => {
  expect(wishText({ desiredFrom: '2026-11-25', desiredTo: '2026-12-05' })).toContain('с 25 нояб по 5 дек')
})

test('календарь DateInput: в 01:00 по Бишкеку «сегодня» — 27-е, хотя в Москве и Нью-Йорке ещё 26-е', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(NIGHT) })
  function Day() {
    const [day, setDay] = useState('')
    return <label className="field"><span>День</span><DateInput value={day} onChange={(e) => setDay(e.target.value)} /><output>{day}</output></label>
  }
  render(<Day />)
  fireEvent.click(screen.getByLabelText('День'))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('button', { name: /Ноябрь 2026/ })).toBeInTheDocument()
  expect(dialog.querySelector('.date-day.today')).toHaveAttribute('data-date', '2026-11-27')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Сегодня' }))
  expect(screen.getByRole('status')).toHaveTextContent('2026-11-27')
})

test('календарь DateInput: в 23:30 по Бишкеку «сегодня» — ещё 27-е, в 00:00 — уже 28-е', () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-11-27T17:30:00Z') })
  const { unmount } = render(<DateInput aria-label="День" value="" onChange={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /День/ }))
  expect(screen.getByRole('dialog').querySelector('.date-day.today')).toHaveAttribute('data-date', '2026-11-27')
  unmount()
  vi.setSystemTime(new Date('2026-11-27T18:00:00Z'))
  render(<DateInput aria-label="День" value="" onChange={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /День/ }))
  expect(screen.getByRole('dialog').querySelector('.date-day.today')).toHaveAttribute('data-date', '2026-11-28')
})

describe('сетка на компьютере', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }))
  })

  const shift = (date: string): Schemas['SlotsView'] => ({
    workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [],
    work: [{ start: `${date}T03:00:00Z`, end: `${date}T12:00:00Z` }],
    free: [{ start: `${date}T08:00:00Z`, end: `${date}T12:00:00Z` }],
  })

  /** Приём 30 минут с буквальным UTC-началом. */
  function visit(id: number, startAt: string, name: string): Appointment {
    return {
      id, doctorId: 1, startAt, endAt: new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString(), status: 'SCHEDULED',
      reply: 'NONE', version: 4, source: 'DOCTOR', debtSom: 0, firstVisit: false, chairManual: false, lockedForDoctors: false,
      patient: { id, fullName: name, phone: '996555000111', telegram: false },
    }
  }

  test('«День» в 01:00 по Бишкеку открывается на пятнице 27-го; нажали пустое место на 11:15 — запись на 11:15 27-го', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(NIGHT) })
    localStorage.setItem('crm.schedule.view.v2', 'all')
    const days: string[] = []
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(me)),
      http.get('*/api/appointments', ({ request }) => {
        days.push(new URL(request.url).searchParams.get('date') ?? '')
        return HttpResponse.json([])
      }),
      http.get('*/api/slots', ({ request }) => HttpResponse.json(shift(new URL(request.url).searchParams.get('date')!))),
    )
    renderApp()
    expect(await screen.findByRole('heading', { level: 1, name: /Пятница, 27 ноября/ })).toBeInTheDocument()
    expect(days).toContain('2026-11-27')
    expect(days).not.toContain('2026-11-26')
    const column = await screen.findByRole('group', { name: 'Айгерим Садыкова' })
    column.getBoundingClientRect = () => ({ top: 0, bottom: 3000, left: 0, right: 300, width: 300, height: 3000, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.click(column, { clientY: PAD + (11 * 60 + 15 - 9 * 60) * PX + 2 })
    const panel = await screen.findByRole('complementary', { name: 'Новая запись' })
    expect(panel).toHaveTextContent('11:15 · пт 27 нояб')
  })

  test('«Неделя»: перетащили приём со вторника 10:00 на четверг 11:15 — на сервер 2026-12-03T05:15Z, нажали пустое — та же минута', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(NIGHT) })
    const moves: Schemas['AppointmentRequestsReschedule'][] = []
    let current = visit(10, '2026-12-01T04:00:00Z', 'Бакыт М.')
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(me)),
      http.get('*/api/appointments', () => HttpResponse.json([])),
      http.get('*/api/appointments/range', ({ request }) => {
        const q = new URL(request.url).searchParams
        return HttpResponse.json(q.get('doctorId') === '1' ? [current] : [])
      }),
      http.get('*/api/slots', ({ request }) => HttpResponse.json(shift(new URL(request.url).searchParams.get('date')!))),
      http.post('*/api/appointments/10/reschedule', async ({ request }) => {
        moves.push(await request.json() as Schemas['AppointmentRequestsReschedule'])
        current = { ...visit(10, '2026-12-03T05:15:00Z', 'Бакыт М.'), version: 5 }
        return HttpResponse.json(current)
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Неделя' }))
    await userEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }))
    // Неделя с понедельника 30 ноября; приём 04:00Z — вторник 1 декабря, 10:00 по Бишкеку
    const tue = await screen.findByRole('group', { name: dayTitle('2026-12-01') })
    const block = await within(tue).findByRole('button', { name: /10:00–10:30, Бакыт М\./ })
    for (let i = 0; i < 7; i++) {
      const column = screen.getByRole('group', { name: dayTitle(`2026-${i === 0 ? '11-30' : `12-0${i}`}`) })
      column.getBoundingClientRect = () => ({ left: 100 * i, right: 100 * (i + 1), top: 0, bottom: 2000, width: 100, height: 2000, x: 100 * i, y: 0, toJSON: () => ({}) })
    }
    const yOf = (minutes: number) => PAD + (minutes - 9 * 60) * PX
    const pointer = { pointerId: 1, button: 0, pointerType: 'mouse' }
    fireEvent.pointerDown(block, { ...pointer, clientX: 150, clientY: yOf(10 * 60) + 3 })
    fireEvent.pointerMove(block, { ...pointer, clientX: 350, clientY: yOf(11 * 60 + 15) + 3 })
    fireEvent.pointerUp(block, { ...pointer, clientX: 350, clientY: yOf(11 * 60 + 15) + 3 })
    fireEvent.click(block)
    await waitForSlow(() => expect(moves).toEqual([{ version: 4, startAt: '2026-12-03T05:15:00.000Z', durationMinutes: 30 }]))
    expect(await within(screen.getByRole('group', { name: dayTitle('2026-12-03') }))
      .findByRole('button', { name: /11:15–11:45, Бакыт М\./ })).toBeInTheDocument()

    // Пустое место пятницы на 11:15 — «Новая запись» на 11:15 4 декабря
    fireEvent.click(screen.getByRole('group', { name: dayTitle('2026-12-04') }), { clientY: yOf(11 * 60 + 15) + 2 })
    expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toHaveTextContent('11:15 · пт 4 дек')
  })
})
