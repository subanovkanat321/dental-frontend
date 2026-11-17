import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { DateInput } from '../layout/DateInput'
import { useFreeDays } from '../lib/freeDays'
import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { badgesOf } from './badges'

// Значки на записи (❗ 🧾 ⭐ 🆕) и свободные дни в календаре. Пациенты вымышленные

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

const vipNew = (extra: Partial<Schemas['AppointmentView']> = {}) =>
  appointment(21, 1, '10:00', 'Вымышленная Айпери', { firstVisit: true, comment: 'Позвонить', ...extra, patient: { id: 21, fullName: 'Вымышленная Айпери', telegram: false, vip: true } })

test('порядок значков: ❗ > 🧾 > ⭐ > 🆕 > 💬', () => {
  const list = badgesOf(vipNew({ status: 'DONE', debtSom: 1500 }), true, undefined, null, 0, { text: '⚠️ Аллергия: лидокаин' })
  expect(list.map((b) => b.icon)).toEqual(['❗', '🧾', '⭐', '🆕', '💬'])
  expect(list[0]!.text).toBe('Важно для врача: ⚠️ Аллергия: лидокаин')
  // Без доступа к медкарте — значок есть, диагноза нет
  const closed = badgesOf(vipNew(), false, undefined, null, 0, { text: null })
  expect(closed[0]!.icon).toBe('❗')
  expect(closed[0]!.text).not.toMatch(/лидокаин/)
  // Нет отметок — нет значка
  expect(badgesOf(vipNew(), false, undefined, null, 0, null).map((b) => b.icon)).toEqual(['⭐', '🆕', '💬'])
})

test('сетка: не больше трёх значков, на записи 30 минут — один самый важный', async () => {
  const today = todayIn()
  const asked: number[][] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      if (Number(new URL(request.url).searchParams.get('doctorId')) !== 1) return HttpResponse.json([])
      return HttpResponse.json([
        // Час: ❗ ⭐ 🆕 💬 — видны три первых
        { ...vipNew({ startAt: slotInstant(today, 600), endAt: slotInstant(today, 660) }) },
        // 30 минут: ⭐ 🆕 — виден только ⭐
        appointment(22, 1, '12:00', 'Вымышленный Бакыт', { startAt: slotInstant(today, 720), endAt: slotInstant(today, 750), firstVisit: true,
          patient: { id: 22, fullName: 'Вымышленный Бакыт', telegram: false, vip: true } }),
      ])
    }),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [], free: [] })),
    http.post('*/api/anamnesis/alerts', async ({ request }) => {
      const body = (await request.json()) as { patientIds: number[] }
      asked.push(body.patientIds)
      return HttpResponse.json([{ patientId: 21, text: '⚠️ Аллергия: лидокаин' }] satisfies Schemas['AnamnesisAlert'][])
    }),
  )
  renderApp()
  const long = await screen.findByRole('button', { name: /^10:00–11:00, Вымышленная Айпери/ })
  await within(long).findByRole('img', { name: 'Важно для врача: ⚠️ Аллергия: лидокаин' })
  expect(within(long).getAllByRole('img').map((i) => i.textContent)).toEqual(['❗', '⭐', '🆕'])
  const short = screen.getByRole('button', { name: /^12:00–12:30, Вымышленный Бакыт/ })
  expect(within(short).getAllByRole('img').map((i) => i.textContent)).toEqual(['⭐'])
  expect(within(short).getByRole('img', { name: 'ВИП — особое внимание' })).toHaveAttribute('data-short', 'ВИП')
  // Один запрос на экран за всех пациентов, а не по запросу на запись
  expect(asked.flat().sort()).toEqual([21, 22])
  expect(asked.length).toBe(1)
})

function FreeDaysCalendar() {
  const [month, setMonth] = useState('2099-06')
  const marks = useFreeDays(1, month, 30)
  return <DateInput value="2099-06-01" marks={marks} onMonthView={setMonth} aria-label="День записи" />
}

test('календарь: зелёные дни — есть свободное время, серые — нет, выходной бледно', async () => {
  const months: string[] = []
  server.use(http.get('*/api/slots/month', ({ request }) => {
    const url = new URL(request.url)
    months.push(`${url.searchParams.get('month')} ${url.searchParams.get('doctorId')} ${url.searchParams.get('duration')}`)
    return HttpResponse.json([
      { date: '2099-06-01', state: 'FREE', freeMinutes: 540 },
      { date: '2099-06-02', state: 'FULL', freeMinutes: 0 },
      { date: '2099-06-05', state: 'FREE', freeMinutes: 420 },
      { date: '2099-06-07', state: 'OFF', freeMinutes: 0 },
      { date: '2099-06-10', state: 'OFF', freeMinutes: 0, note: 'Отпуск' },
    ] satisfies Schemas['SlotServiceFreeDay'][])
  }))
  render(<QueryClientProvider client={createQueryClient({ queries: { retry: false } })}><FreeDaysCalendar /></QueryClientProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'День записи' }))
  const dialog = await screen.findByRole('dialog', { name: 'День записи' })
  const friday = await within(dialog).findByRole('button', { name: /5 июня.*свободно 7 ч/ })
  expect(friday).toHaveClass('mark-free')
  expect(within(dialog).getByRole('button', { name: /2 июня.*свободного времени нет/ })).toHaveClass('mark-full')
  expect(within(dialog).getByRole('button', { name: /7 июня.*выходной/ })).toHaveClass('mark-off')
  expect(within(dialog).getByRole('button', { name: /10 июня.*отпуск/ })).toHaveClass('mark-off')
  expect(within(dialog).getByText('есть свободное время')).toBeInTheDocument()
  expect(months).toEqual(['2099-06 1 30'])
  // Следующий месяц — новый запрос; назад — из кэша
  await userEvent.click(within(dialog).getByRole('button', { name: 'Следующий месяц' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Предыдущий месяц' }))
  await within(dialog).findByRole('button', { name: /5 июня.*свободно 7 ч/ })
  expect(months).toEqual(['2099-06 1 30', '2099-07 1 30'])
})
