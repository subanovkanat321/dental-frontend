import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'

beforeEach(() => {
  window.location.hash = '/cash'
})
afterEach(() => {
  window.location.hash = ''
})

test('аналитика: выручка по месяцам, по врачам, по услугам, доля неявок', async () => {
  const thisMonth = todayIn().slice(0, 7)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/revenue', ({ request }) => {
      const q = new URL(request.url).searchParams
      const doctor = q.get('doctorId')
      // Текущий месяц — 50 000, прошлые — 40 000; по врачам — 30 000 и 20 000
      const total = doctor ? (doctor === '1' ? 30000 : 20000) : q.get('from')!.startsWith(thisMonth) ? 50000 : 40000
      // Касса (по дате платежа) — на 5 000 больше: доплаты за прошлые приёмы; по способам — она
      const cash = total + 5000
      return HttpResponse.json({
        totalSom: total, paidCount: 5, unpaidCount: 0, byMethod: doctor ? {} : { CASH: total * 0.6, TRANSFER: total * 0.4 }, days: [],
        cash: { totalSom: cash, paymentsCount: 6, depositsSom: 0, byMethod: doctor ? {} : { CASH: cash * 0.6, TRANSFER: cash * 0.4 }, days: [] },
      } satisfies Schemas['RevenueView'])
    }),
    // Отчёт — по месяцам: строки только за запрошенный месяц (30 дней могут захватить два)
    http.get('*/api/appointments/report', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('month') !== thisMonth ? [] : [
      { id: 1, startAt: `${todayIn()}T04:00:00Z`, patient: 'Бакыт М.', doctor: 'Айгерим', service: 'Пломба', status: 'DONE', paidSom: 3000 },
      { id: 2, startAt: `${todayIn()}T05:00:00Z`, patient: 'Нурлан К.', doctor: 'Айгерим', service: 'Пломба', status: 'DONE', paidSom: 3000 },
      { id: 3, startAt: `${todayIn()}T06:00:00Z`, patient: 'Асель У.', doctor: 'Дастан', service: 'Чистка', status: 'DONE', paidSom: 2000 },
    ] satisfies Schemas['AppointmentServiceReportRow'][])),
    http.get('*/api/appointments/sources', () => HttpResponse.json({
      newPatients: [{ sourceId: 11, emoji: '📱', title: 'Instagram', active: true, patients: 3 }, { sourceId: 19, emoji: '📣', title: 'Реклама', active: false, patients: 2 }, { active: true, patients: 1 }], firstVisits: 4, repeatVisits: 12,
    } satisfies Schemas['SourcesControllerSourcesView'])),
    http.get('*/api/appointments/stats', () => HttpResponse.json([
      { weekStart: '2026-10-26', booked: 10, done: 9, noShow: 1, cancelled: 0 },
      { weekStart: '2026-10-19', booked: 10, done: 7, noShow: 3, cancelled: 1 },
    ] satisfies Schemas['WeekStats'][])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Аналитика'))

  const months = await screen.findByRole('region', { name: 'Выручка за 6 месяцев' })
  // Главная цифра — последний полный месяц (текущий идёт): 40 000, как месяцем раньше
  expect(await within(months).findByText(/как было/)).toBeInTheDocument()
  expect(within(months).getByRole('img').getAttribute('aria-label')).toMatch(/50\s000 сом$/)
  // Рядом — касса того же месяца: деньги, полученные за период
  expect(within(months).getByLabelText('Касса за месяц')).toHaveTextContent(/45\s000 сом — деньги, полученные за период/)

  // Врачей двое (2–6) — бублик: доли в описании и в легенде, в центре — выручка всех
  const doctors = await screen.findByRole('region', { name: 'Выручка по врачам' })
  const rows = await within(doctors).findAllByRole('listitem')
  expect(rows[0]).toHaveTextContent(/Айгерим Садыкова.*30\s000 сом.*60%/)
  expect(within(doctors).getByRole('img').getAttribute('aria-label')).toMatch(/^Выручка по врачам: Айгерим Садыкова 30\s000 сом \(60%\), .+ 20\s000 сом \(40%\)$/)
  expect(within(doctors).getByText('выручка').previousSibling).toHaveTextContent(/50\s000 сом/)

  const services = screen.getByRole('region', { name: 'Выручка по услугам' })
  expect((await within(services).findAllByRole('listitem'))[0]).toHaveTextContent(/Пломба.*6\s000 сом.*75%/)

  // Как платят: бублик — наличные 60%, перевод 40% (карты нет — сегмента нет), в центре касса за период
  const methods = screen.getByRole('region', { name: 'Способы оплаты' })
  expect(within(methods).getByRole('img').getAttribute('aria-label')).toMatch(/^Способы оплаты: Наличные [\d\s]+ сом \(60%\), Перевод [\d\s]+ сом \(40%\)$/)
  expect(within(within(methods).getByRole('list', { name: 'Способы оплаты' })).getAllByRole('button')).toHaveLength(2)
  expect(within(methods).getByText('касса').previousSibling).toHaveTextContent(/[\d\s]+ сом/)
  // Чем закончились приёмы: все три пришли — в центре 100% «пришли»
  const outcomes = screen.getByRole('region', { name: 'Чем закончились приёмы' })
  expect(within(outcomes).getByRole('img').getAttribute('aria-label')).toBe('Чем закончились приёмы: Пришли 3 (100%)')
  expect(within(outcomes).getByText('пришли').previousSibling).toHaveTextContent('100%')
  // Загрузка: три приёма сегодня — пик в одном из часов, таблица дней × часов
  const load = screen.getByRole('region', { name: 'Загрузка по дням и часам' })
  expect(within(load).getByText(/Пик —/)).toBeInTheDocument()
  expect(within(load).getByRole('table', { name: 'Приёмы по дням недели и часам' })).toBeInTheDocument()

  const sources = screen.getByRole('region', { name: 'Откуда новые пациенты' })
  // В центре бублика — сколько новых (3 + 2 + 1)
  expect((await within(sources).findByText('новых пациентов')).previousSibling).toHaveTextContent('6')
  expect(within(sources).getByRole('img').getAttribute('aria-label')).toBe('Новые пациенты по источникам: 📱 Instagram 3 чел. (50%), 📣 Реклама (скрыт) 2 чел. (33%), Не указано 1 чел. (17%)')
  expect(within(sources).getAllByRole('listitem')[0]).toHaveTextContent(/📱 Instagram.*3 чел\..*50%/)
  // Скрытый вариант — в истории, с пометкой; без варианта — «Не указано»
  expect(within(sources).getAllByRole('listitem')[1]).toHaveTextContent(/📣 Реклама \(скрыт\).*2 чел\./)
  expect(within(sources).getAllByRole('listitem')[2]).toHaveTextContent(/Не указано/)
  expect(within(sources).getByText(/Не указано» — в карточке/)).toBeInTheDocument()
  // Первичные и повторные: бублик, в центре — доля повторных; цифры — строкой под ним
  const visits = screen.getByRole('region', { name: 'Первичные и повторные визиты' })
  expect(within(visits).getByRole('img').getAttribute('aria-label')).toBe('Первичные и повторные визиты: Первичные 4 (25%), Повторные 12 (75%)')
  expect(within(visits).getByText('повторных').previousSibling).toHaveTextContent('75%')
  expect(within(visits).getByLabelText('Визиты за период')).toHaveTextContent(/16.*первичных 4, повторных 12/)

  const noShow = screen.getByRole('region', { name: 'Неявки по неделям' })
  expect(await within(noShow).findByText('20%')).toBeInTheDocument() // 4 неявки из 20
})

test('аналитика: ошибка сервера — сообщение, а не «0 сом» и «оплат нет»', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/revenue', () => HttpResponse.json({ title: 'Нет доступа', detail: 'Нет доступа к выручке', status: 403 }, { status: 403 })),
    http.get('*/api/appointments/stats', () => HttpResponse.json([])),
    http.get('*/api/appointments/sources', () => HttpResponse.json({ newPatients: [], firstVisits: 0, repeatVisits: 0 })),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Аналитика'))
  const months = await screen.findByRole('region', { name: 'Выручка за 6 месяцев' })
  expect(await within(months).findByText('Нет доступа к выручке')).toBeInTheDocument()
  expect(within(months).queryByText(/0 сом за/)).not.toBeInTheDocument()
})

test('аналитика: выручка по дням — среднее, лучший день, пустые дни нулём, клавиатура', async () => {
  const today = todayIn()
  const best = addDays(today, -3)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/stats', () => HttpResponse.json([])),
    http.get('*/api/appointments/sources', () => HttpResponse.json({ newPatients: [], firstVisits: 0, repeatVisits: 0 })),
    // Сервер отдаёт только дни с оплатами (вымышленные суммы)
    http.get('*/api/appointments/revenue', () => HttpResponse.json({
      totalSom: 17000, paidCount: 4, unpaidCount: 0, byMethod: { CASH: 17000 },
      days: [{ date: best, totalSom: 12000 }, { date: addDays(today, -1), totalSom: 5000 }],
    } satisfies Schemas['RevenueView'])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Аналитика'))
  const chart = await screen.findByRole('region', { name: 'Выручка по дням' })
  // Текстовая сводка: среднее за день с оплатами и сколько таких дней
  expect(await within(chart).findByLabelText('Среднее за день')).toHaveTextContent(/8\s500 сом в среднем за день с оплатами · таких дней 2 из 30/)
  const bars = within(chart).getAllByRole('button')
  expect(bars).toHaveLength(30)
  // У каждого столбика — подпись с датой и суммой; выбран лучший день, он один в Tab
  const picked = within(chart).getByRole('button', { pressed: true })
  expect(picked.getAttribute('aria-label')).toMatch(/12\s000 сом$/)
  expect(bars.filter((b) => b.tabIndex === 0)).toEqual([picked])
  expect(within(chart).getByText(/— лучший день/)).toBeInTheDocument()
  expect(bars.at(-1)!.getAttribute('aria-label')).toMatch(/: 0 сом$/)
  // ← → — соседний день
  picked.focus()
  await user.keyboard('{ArrowRight}{ArrowRight}')
  expect(within(chart).getByRole('button', { pressed: true }).getAttribute('aria-label')).toMatch(/5\s000 сом$/)
  expect(document.activeElement).toBe(within(chart).getByRole('button', { pressed: true }))
})

test('аналитика: выручка по дням — оплат нет', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/stats', () => HttpResponse.json([])),
    http.get('*/api/appointments/sources', () => HttpResponse.json({ newPatients: [], firstVisits: 0, repeatVisits: 0 })),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Аналитика'))
  const chart = await screen.findByRole('region', { name: 'Выручка по дням' })
  expect(await within(chart).findByText('Оплат за этот период нет')).toBeInTheDocument()
  expect(within(chart).queryByRole('group')).not.toBeInTheDocument()
})

test('«Аналитика»: под «30 дней / Месяц» — какие именно дни считаются', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  renderApp()
  await userEvent.click(await findSub('Аналитика'))
  expect(await screen.findByLabelText('Даты периода')).toHaveTextContent('последние 30 дней по сегодня')
  await userEvent.click(screen.getByRole('button', { name: 'Месяц' }))
  expect(screen.getByLabelText('Даты периода')).toHaveTextContent(/с 1-го числа|месяц только начался/)
})
