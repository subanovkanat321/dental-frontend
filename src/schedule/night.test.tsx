import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, dayMinutes, shiftText, slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { offSpans, workSpans } from './workSpans'

/**
 * Ночная смена (V186) в сетке «День» на компьютере: у врача №2 смена вчера 18:00 → 08:00 и сегодня
 * (завтра для теста) 18:00 → 08:00; приём вчера 23:30–00:30 виден утром «со вчера». Пациенты вымышленные.
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

const day = addDays(todayIn(), 1)
const yesterday = todayIn()

function backend(seen: string[]) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const url = new URL(request.url)
      seen.push(url.search)
      if (url.searchParams.get('date') !== day || url.searchParams.get('doctorId') !== '2') return HttpResponse.json([])
      const night = appointment(20, 2, '23:30', 'Нурлан Ночной', { startAt: slotInstant(yesterday, 23 * 60 + 30), endAt: slotInstant(day, 30) })
      const late = appointment(21, 2, '23:30', 'Асель Поздняя', { startAt: slotInstant(day, 23 * 60 + 30), endAt: slotInstant(addDays(day, 1), 30) })
      // Без overnight сервер не отдал бы вчерашний — сетка просит его явно
      return HttpResponse.json(url.searchParams.get('overnight') === 'true' ? [night, late] : [late])
    }),
    http.get('*/api/slots', ({ request }) => {
      const url = new URL(request.url)
      const date = url.searchParams.get('date')!
      if (url.searchParams.get('doctorId') === '2') {
        return HttpResponse.json({
          workingDay: true, workStart: '18:00:00', workEnd: '08:00:00', breaks: [],
          work: [{ start: slotInstant(date, 0), end: slotInstant(date, 8 * 60) }, { start: slotInstant(date, 18 * 60), end: slotInstant(addDays(date, 1), 0) }],
          free: [{ start: slotInstant(date, 60), end: slotInstant(date, 8 * 60) }],
        } satisfies Schemas['SlotsView'])
      }
      return HttpResponse.json({
        workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [], free: [],
        work: [{ start: slotInstant(date, 9 * 60), end: slotInstant(date, 18 * 60) }],
      } satisfies Schemas['SlotsView'])
    }),
  )
}

test('сетка дня с ночным врачом: часы «18:00–08:00 (ночь)», сутки целиком, приём через полночь в обоих днях', async () => {
  const seen: string[] = []
  backend(seen)
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const column = await screen.findByRole('group', { name: 'Дастан Т.' })
  expect(await screen.findByText('18:00–08:00 (ночь)')).toBeInTheDocument()
  expect(screen.getByText('09:00–18:00')).toBeInTheDocument()
  // Сетка — от полуночи до полуночи: ночные часы видны
  const times = document.querySelector('.grid-times') as HTMLElement
  expect(within(times).getByText('00:00')).toBeInTheDocument()
  expect(within(times).getByText('23:00')).toBeInTheDocument()
  // Вчерашний приём — утром, с пометкой; сегодняшний поздний — до полуночи, продолжение пунктиром
  const carried = await within(column).findByRole('button', { name: /^со вчера 23:30–00:30, Нурлан Ночной/ })
  expect(carried).toHaveClass('carried')
  expect(carried.style.top).toBe('14px')
  const late = within(column).getByRole('button', { name: /^23:30–00:30, Асель Поздняя/ })
  expect(late).toHaveClass('continues')
  // Сетка ночной смены и так на сутки — не продлеваем: обрезан полуночью с подписью, не ниже строки текста
  expect(within(late).getByText('→ до 00:30')).toBeInTheDocument()
  expect(parseFloat(late.style.height)).toBeGreaterThanOrEqual(24)
  expect(document.querySelector('.grid-midnight')).toBeNull()
  expect(within(times).queryByText('завтра')).not.toBeInTheDocument()
  // Между утром и вечером — нерабочее (серым), свободно — утром
  expect(column.querySelectorAll('.grid-off')).toHaveLength(1)
  expect(within(column).getByRole('button', { name: 'Свободно с 01:00 до 08:00, записать' })).toBeInTheDocument()
  // Вчерашний не считается в записях этого дня
  expect(screen.getByText(/Записей: 1/)).toBeInTheDocument()
  expect(seen.some((q) => q.includes('overnight=true'))).toBe(true)
})

test('минуты дня и рабочие отрезки ночной смены', () => {
  expect(dayMinutes(slotInstant('2026-11-09', 30), '2026-11-09')).toBe(30)
  expect(dayMinutes(slotInstant('2026-11-10', 30), '2026-11-09')).toBe(24 * 60)
  expect(dayMinutes(slotInstant('2026-11-08', 23 * 60), '2026-11-09')).toBe(0)
  expect(shiftText('18:00:00', '08:00:00')).toBe('18:00–08:00 (ночь)')
  expect(shiftText('09:00', '18:00')).toBe('09:00–18:00')
  expect(shiftText('18:00', '00:00')).toBe('18:00–00:00')
  // Старый ответ без work: ночная смена — до полуночи в этом дне
  expect(workSpans({ workingDay: true, workStart: '18:00:00', workEnd: '08:00:00' }, '2026-11-09')).toEqual([[18 * 60, 24 * 60]])
  expect(offSpans([[0, 480], [1080, 1440]], 0, 1440)).toEqual([[480, 1080]])
  expect(offSpans([[540, 1080]], 480, 1140)).toEqual([[480, 540], [1080, 1140]])
})
