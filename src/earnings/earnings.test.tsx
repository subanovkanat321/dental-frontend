import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp, findSub, querySub } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Earnings = Schemas['EarningsView']
type Me = Schemas['BookingViewsMe']

/** Ответ сервера: 30% + оклад, цель 250 000 — как бы посчитал EarningsController (вымышленные суммы). */
const NOVEMBER: Earnings = {
  date: '2026-11-18', month: '2026-11', hasTerms: true, percent: 30, baseSom: 10000, todaySom: 12400, todayRevenueSom: 41333,
  monthSom: 186000, monthRevenueSom: 586667, previousMonthSom: 170000, changePercent: 12, goalSom: 250000, goalLeftSom: 64000,
  workDaysLeft: 15, perDayNeededSom: 4267, eveningSummary: true,
}

const doctorOnly: Me = { ...me, admin: false }

function backend(who: Me, earnings: Earnings | null) {
  let current = earnings
  const sent: { path: string; body: unknown }[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/salaries', () => HttpResponse.json([])),
    http.get('*/api/me/earnings', () => (current ? HttpResponse.json(current) : HttpResponse.json({ status: 403 }, { status: 403 }))),
    http.put('*/api/me/earnings/goal', async ({ request }) => {
      const body = (await request.json()) as { goalSom?: number }
      sent.push({ path: 'goal', body })
      const goal = body.goalSom ?? undefined
      current = { ...current!, goalSom: goal, goalLeftSom: goal ? Math.max(0, goal - (current!.monthSom ?? 0)) : undefined,
        perDayNeededSom: goal ? 7600 : undefined }
      return HttpResponse.json(current)
    }),
    http.put('*/api/me/earnings/evening', async ({ request }) => {
      const body = (await request.json()) as { eveningSummary: boolean }
      sent.push({ path: 'evening', body })
      current = { ...current!, eveningSummary: body.eveningSummary }
      return HttpResponse.json(current)
    }),
  )
  return sent
}

afterEach(() => {
  window.location.hash = ''
})

test('«Касса → Мой заработок»: сегодня, за месяц, к прошлому месяцу, цель и итог дня', async () => {
  window.location.hash = '/cash'
  const sent = backend(doctorOnly, NOVEMBER)
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Мой заработок'))

  const block = await screen.findByRole('region', { name: 'Мой заработок' })
  expect(within(block).getByLabelText('Сегодня')).toHaveTextContent(/12\s400 сом/)
  expect(within(block).getByLabelText('За месяц')).toHaveTextContent(/186\s000 сом/)
  expect(block).toHaveTextContent('За ноябрь')
  // Оклад — только в месяце, сегодня — только процент
  expect(block).toHaveTextContent('Сегодня — 30% от принятых')
  expect(block).toHaveTextContent(/оклад 10\s000 сом \+ 30%/)
  expect(within(block).getByLabelText('Сравнение с прошлым месяцем')).toHaveTextContent('Как в прошлом месяце к этой дате: +12%')

  const goal = screen.getByRole('region', { name: 'Цель на месяц' })
  expect(within(goal).getByLabelText('До цели')).toHaveTextContent(/До цели осталось 64\s000 сом · в день нужно ≈ 4\s267 сом на 15 рабочих дней/)
  expect(within(goal).getByRole('progressbar', { name: 'Путь к цели на месяц' })).toHaveAttribute('aria-valuenow', '74')
  expect(goal).toHaveTextContent('Цель видите только вы.')

  await user.click(within(goal).getByRole('button', { name: 'Изменить цель' }))
  const input = within(goal).getByLabelText('Цель, сом')
  await user.clear(input)
  await user.type(input, '300 000')
  await user.click(within(goal).getByRole('button', { name: 'Сохранить цель' }))
  expect(await within(goal).findByLabelText('До цели')).toHaveTextContent(/114\s000 сом/)

  await user.click(within(goal).getByRole('checkbox', { name: 'Присылать итог дня в вечерней сводке' }))
  await waitForSlow(() => expect(within(goal).getByRole('checkbox', { name: 'Присылать итог дня в вечерней сводке' })).not.toBeChecked())
  expect(sent).toEqual([{ path: 'goal', body: { goalSom: 300000 } }, { path: 'evening', body: { eveningSummary: false } }])
})

test('условия зарплаты не заданы — выручка врача и подсказка про «Зарплату»', async () => {
  window.location.hash = '/cash'
  backend(doctorOnly, {
    ...NOVEMBER, hasTerms: false, percent: 0, baseSom: 0, todaySom: 5000, todayRevenueSom: 5000, monthSom: 90000, monthRevenueSom: 90000,
    goalSom: undefined, goalLeftSom: undefined, perDayNeededSom: undefined, changePercent: undefined,
  })
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Мой заработок'))

  const block = await screen.findByRole('region', { name: 'Мой заработок' })
  expect(block).toHaveTextContent(/Принято от ваших пациентов: сегодня 5\s000 сом, за ноябрь 90\s000 сом/)
  expect(block).toHaveTextContent('Процент задаёт руководитель в «Касса → Зарплата»')
  expect(within(block).queryByLabelText('Сравнение с прошлым месяцем')).not.toBeInTheDocument()
  // Цели нет — сразу поле, чтобы поставить
  const goal = screen.getByRole('region', { name: 'Цель на месяц' })
  expect(within(goal).getByLabelText('Цель, сом')).toBeInTheDocument()
  expect(within(goal).getByRole('button', { name: 'Сохранить цель' })).toBeDisabled()
})

test('админ без кресла и ассистент «Мой заработок» не видят', async () => {
  window.location.hash = '/cash'
  backend({ ...me, doctorId: undefined }, null)
  const { unmount } = renderApp()
  expect(await findSub('Деньги')).toBeInTheDocument()
  expect(querySub('Мой заработок')).not.toBeInTheDocument()
  unmount()

  // Ассистент: денег нет вовсе — и запроса за заработком нет
  let asked = false
  backend({ ...me, admin: false, assistantOf: [1] }, NOVEMBER)
  server.use(http.get('*/api/me/earnings', () => {
    asked = true
    return HttpResponse.json(NOVEMBER)
  }))
  window.location.hash = ''
  renderApp()
  expect(await screen.findByRole('group', { name: 'Требует внимания' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Мой заработок/ })).not.toBeInTheDocument()
  expect(asked).toBe(false)
})

test('«Расписание»: чип «мой день» в полосе «Сегодня» ведёт в «Кассу → Мой заработок»', async () => {
  backend(doctorOnly, NOVEMBER)
  server.use(http.get('*/api/appointments', () => HttpResponse.json([])))
  const user = userEvent.setup()
  renderApp()
  const chip = await screen.findByRole('button', { name: /Мой заработок сегодня: 12\s400 сом/ })
  expect(chip).toHaveTextContent(/12\s400 сом мой день · ноябрь 186\s000/)
  await user.click(chip)
  expect(await findSub('Мой заработок')).toHaveAttribute('aria-current', 'page')
  expect(await screen.findByRole('region', { name: 'Цель на месяц' })).toBeInTheDocument()
})

test('карточка своего оплаченного приёма: «+3 000 сом к вашему дню», у коллеги — нет', async () => {
  backend(me, NOVEMBER)
  const own = appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1, paidSom: 10000, paymentMethod: 'CASH' })
  const colleague = appointment(11, 2, '11:00', 'Нурлан К.', { status: 'DONE', version: 1, paidSom: 8000, paymentMethod: 'CASH' })
  server.use(http.get('*/api/appointments', ({ request }) => {
    const doctor = Number(new URL(request.url).searchParams.get('doctorId'))
    return HttpResponse.json(doctor === 1 ? [own] : [colleague])
  }))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(await within(panel).findByText(/\+3\s000 сом к вашему дню/)).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /Нурлан К\./ }))
  const other = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(await within(other).findByText(/8\s000 сом · наличные/)).toBeInTheDocument()
  expect(within(other).queryByText(/к вашему дню/)).not.toBeInTheDocument()
})

test('«Мой заработок» с арендой кресла: месяц — на руки после аренды, сегодня — без неё', async () => {
  window.location.hash = '/cash'
  // Частный врач: 100% выручки, аренда 30 000 в месяц
  backend(doctorOnly, {
    ...NOVEMBER, percent: 100, baseSom: 0, todaySom: 8000, todayRevenueSom: 8000, monthRevenueSom: 120000, monthSom: 90000,
    rentSom: 30000, goalSom: undefined, goalLeftSom: undefined, perDayNeededSom: undefined,
  })
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Мой заработок'))
  const block = await screen.findByRole('region', { name: 'Мой заработок' })
  expect(within(block).getByLabelText('Сегодня')).toHaveTextContent(/8\s000 сом/)
  expect(within(block).getByText('За ноябрь, на руки после аренды')).toBeInTheDocument()
  expect(within(block).getByLabelText('За месяц')).toHaveTextContent(/90\s000 сом/)
  expect(within(block).getByLabelText('Аренда')).toHaveTextContent(/Аренда 30\s000 сом за месяц вычтена/)
  expect(block).toHaveTextContent(/100% от 120\s000 сом − аренда кресла 30\s000 сом/)
})

test('«Мой заработок»: аренда больше заработка — минус и «вы должны клинике»', async () => {
  window.location.hash = '/cash'
  backend(doctorOnly, {
    ...NOVEMBER, percent: 100, baseSom: 0, todaySom: 2000, todayRevenueSom: 2000, monthRevenueSom: 18000, monthSom: -12000,
    rentSom: 30000, goalSom: undefined, goalLeftSom: undefined, perDayNeededSom: undefined,
  })
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Мой заработок'))
  const block = await screen.findByRole('region', { name: 'Мой заработок' })
  expect(within(block).getByLabelText('За месяц')).toHaveTextContent(/−12\s000 сом/)
  expect(within(block).getByLabelText('Аренда')).toHaveTextContent(/вы должны клинике 12\s000 сом/)
})
