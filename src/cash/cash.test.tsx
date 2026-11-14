import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { periodText, previousRange } from '../lib/compare'
import { addDays, periodOf, todayIn } from '../lib/time'
import { appointment, me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

beforeEach(() => {
  window.location.hash = '/cash'
})
afterEach(() => {
  window.location.hash = ''
})

const debt = (id: number, patient: string, extra: Partial<Schemas['PaymentQueryDebt']> = {}) => ({
  appointmentId: id, patientId: id, patient, doctorId: 1, doctor: 'Айгерим Садыкова', startAt: `${todayIn()}T04:00:00Z`, chargeSom: 0, paidSom: 0, debtSom: 0, ...extra,
}) satisfies Schemas['PaymentQueryDebt']

test('периоды: неделя — с понедельника, месяц — с 1-го', () => {
  expect(periodOf('week', '2026-10-31')).toEqual({ from: '2026-10-26', to: '2026-10-31' }) // суббота
  expect(periodOf('week', '2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-10-26' }) // понедельник
  expect(periodOf('month', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
})

test('админ: выручка за месяц, по способам; выбрать врача — его касса; долги таблицей', async () => {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/revenue', ({ request }) => {
      const q = new URL(request.url).searchParams
      asked.push(`${q.get('from')}..${q.get('to')} ${q.get('doctorId') ?? 'все'}`)
      return HttpResponse.json({
        totalSom: q.get('doctorId') ? 7000 : 25000, paidCount: 6, unpaidCount: 1, freeCount: 2, prepaidCount: 1, byMethod: { CASH: 15000, TRANSFER: 10000 },
        days: [{ date: '2026-10-01', totalSom: 5000 }, { date: '2026-10-02', totalSom: 20000 }],
        cash: { totalSom: q.get('doctorId') ? 8000 : 31000, paymentsCount: 8, depositsSom: 1000, byMethod: { CASH: 16000, CARD: 15000 }, days: [], openingDebtsSom: 0 },
      } satisfies Schemas['RevenueView'])
    }),
    http.get('*/api/appointments/debts', () => HttpResponse.json([debt(7, 'Бакыт М.', { debtSom: 2000, dueOn: '2020-01-01' })])),
  )
  renderApp()
  expect(await screen.findByLabelText('Выручка за период')).toHaveTextContent(/25\s000 сом/)
  expect(screen.getByText(/Наличные: 15\s000 сом/)).toBeInTheDocument()
  // Рядом — касса: деньги, полученные за период, с пояснением и по способам
  expect(screen.getByLabelText('Касса за период')).toHaveTextContent(/31\s000 сом/)
  expect(screen.getByText('Касса — деньги, полученные за период')).toBeInTheDocument()
  expect(screen.getByText('По приёмам — стоимость состоявшихся приёмов периода')).toBeInTheDocument()
  expect(screen.getByText(/Поступлений: 8 · Наличные: 16\s000 сом · Карта: 15\s000 сом · из них предоплаты: 1\s000 сом/)).toBeInTheDocument()
  expect(screen.getByText(/без оплаты: 1/)).toBeInTheDocument()
  // Отметки 0 сом — отдельно: бесплатно и оплачено заранее
  expect(screen.getByText(/Оплачено приёмов: 6/)).toHaveTextContent(/бесплатно: 2 · оплачено заранее: 1/)
  const month = periodOf('month')
  expect(asked).toContain(`${month.from}..${month.to} все`)
  // Под переключателем видно, какие даты входят в «Месяц»
  expect(screen.getByLabelText('Даты периода')).toHaveTextContent(periodText('month', month, todayIn()))

  await choose(screen.getByLabelText('Чья касса'), 'Дастан Т.')
  expect(await screen.findByLabelText('Выручка за период')).toHaveTextContent(/7\s000 сом/)
  expect(screen.getByLabelText('Касса за период')).toHaveTextContent(/8\s000 сом/)
  expect(asked).toContain(`${month.from}..${month.to} 2`)
  // Сравнение — с теми же числами прошлого месяца; ответ тот же, значит «как было»
  const prev = previousRange('month', month)
  expect(asked).toContain(`${prev.from}..${prev.to} 2`)
  expect(await screen.findByLabelText('Сравнение выручки')).toHaveTextContent('как было к тем же дням прошлого месяца')

  await userEvent.click(screen.getByRole('button', { name: 'День' }))
  await screen.findByLabelText('Выручка за период')
  expect(asked).toContain(`${todayIn()}..${todayIn()} 2`)
  // Любой день: «Вчера» — выручка за вчера и сравнение с тем же днём прошлой недели
  await userEvent.click(screen.getByRole('button', { name: 'Вчера' }))
  const yesterday = addDays(todayIn(), -1)
  await waitForSlow(() => expect(asked).toContain(`${yesterday}..${yesterday} 2`))
  expect(asked).toContain(`${addDays(yesterday, -7)}..${addDays(yesterday, -7)} 2`)

  const debts = screen.getByRole('table', { name: 'Долги пациентов' })
  expect(debts).toHaveTextContent('Бакыт М.')
  expect(debts).toHaveTextContent(/2\s000 сом/)
  // «К оплате» — только где есть регистратура
  expect(screen.queryByRole('heading', { name: /К оплате на кассе/ })).not.toBeInTheDocument()
})

test('регистратура: «К оплате на кассе» — нажать, принять оплату в карточке, строка уходит', async () => {
  let waiting = [debt(30, 'Айгуль Т.', { chargeSom: 4000 })]
  let paid: unknown
  const billed = appointment(30, 1, '09:00', 'Айгуль Т.', { status: 'DONE', chargeSom: 4000, version: 2 })
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined, hasReception: true })),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json(waiting)),
    http.get('*/api/appointments/30', () => HttpResponse.json(billed)),
    http.post('*/api/appointments/30/payment', async ({ request }) => {
      paid = await request.json()
      waiting = []
      return HttpResponse.json({ ...billed, paidSom: 4000, paymentMethod: 'CASH', version: 3 })
    }),
  )
  renderApp()
  const table = await screen.findByRole('table', { name: 'К оплате на кассе' })
  expect(table).toHaveTextContent(/4\s000 сом/)
  // Регистратура не видит выручку и долги врачей
  expect(screen.queryByRole('heading', { name: 'Выручка' })).not.toBeInTheDocument()

  await userEvent.click(within(table).getByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  expect(within(panel).getByLabelText('Сумма, сом')).toHaveValue(4000)
  await userEvent.click(within(panel).getByRole('button', { name: /^Принять оплату/ }))

  expect(await screen.findByText('Никто не ждёт оплаты')).toBeInTheDocument()
  expect(paid).toEqual({ amountSom: 4000, method: 'CASH' })
})

test('«Врачи работают независимо»: владелец (админ без своего приёма) видит всю кассу; админ-врач — только свою', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined, platform: false, clinic: { ...me.clinic, independentDoctors: true } })),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
  )
  renderApp()
  expect(await screen.findByRole('combobox', { name: 'Чья касса' })).toHaveTextContent('Вся клиника')
})

test('«Должники»: по пациентам — кто сколько должен, с какого числа, просрочено; приём — в карточку', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([
      { appointmentId: 1, startAt: '2026-10-01T04:00:00Z', patientId: 5, patient: 'Айгуль С.', doctor: 'Айгерим', service: 'Пломба', chargeSom: 5000, paidSom: 2000, debtSom: 3000, dueOn: '2026-10-10', doctorId: 0 },
      { appointmentId: 2, startAt: '2026-10-20T04:00:00Z', patientId: 5, patient: 'Айгуль С.', doctor: 'Айгерим', chargeSom: 2000, paidSom: 0, debtSom: 2000, doctorId: 0 },
      { appointmentId: 3, startAt: '2026-10-25T04:00:00Z', patientId: 6, patient: 'Бакыт М.', doctor: 'Айгерим', chargeSom: 8000, paidSom: 0, debtSom: 8000, dueOn: '2099-01-01', doctorId: 0 },
    ] satisfies Schemas['PaymentQueryDebt'][])),
  )
  renderApp()
  await userEvent.click(await findSub('Должники'))
  const tiles = await screen.findByRole('list', { name: 'Итог' })
  expect(tiles).toHaveTextContent(/Должны всего13\s000 сом/)
  expect(tiles).toHaveTextContent(/Пациентов2/)
  expect(tiles).toHaveTextContent(/Просрочили оплату1 · 5\s000 сом/)
  expect(tiles).not.toHaveTextContent('Старые долги')
  const box = screen.getByRole('region', { name: 'Должники' })
  const items = within(box).getAllByRole('listitem')
  expect(items[0]).toHaveTextContent(/Бакыт М\./)
  expect(items[0]).toHaveTextContent(/8\s000 сом/)
  expect(items[1]).toHaveTextContent('2 визита в долг')
  expect(items[1]).toHaveTextContent('Просрочил')
  expect(items[1]).toHaveTextContent('обещал до')

  // По давности — с самого давнего неоплаченного визита; «Просрочили» — только просроченные
  await userEvent.click(screen.getByRole('combobox', { name: 'Порядок' }))
  await userEvent.click(await screen.findByRole('option', { name: 'По давности' }))
  expect(within(box).getAllByRole('listitem')[0]).toHaveTextContent('Айгуль С.')
  await userEvent.click(screen.getByRole('button', { name: 'Просрочили · 1' }))
  expect(within(box).getAllByRole('listitem')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Все' }))
  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск должника' }), 'бакыт')
  expect(within(box).getAllByRole('listitem')).toHaveLength(1)
  expect(within(box).getByRole('listitem')).toHaveTextContent('Бакыт М.')
})

test('«Должники»: никого — коротко «Должников нет 🎉»', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([] satisfies Schemas['PaymentQueryDebt'][])),
  )
  renderApp()
  await userEvent.click(await findSub('Должники'))
  expect(await screen.findByText('Должников нет 🎉')).toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'Итог' })).not.toBeInTheDocument()
})

test('«Должники»: долг из прежней программы — отдельным блоком и плиткой, «Принять оплату» → как отдали', async () => {
  let debts: Schemas['OpeningDebtsView'][] = [{ id: 7, patientId: 9, patient: 'Пример Старый', amountSom: 2500, createdAt: '2026-11-10T06:00:00Z' }]
  const paid: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([] satisfies Schemas['PaymentQueryDebt'][])),
    http.get('*/api/opening-debts', () => HttpResponse.json(debts)),
    http.post('*/api/opening-debts/:id/paid', async ({ request, params }) => {
      paid.push({ id: params.id, ...(await request.json() as object) })
      debts = []
      return new HttpResponse(null, { status: 204 })
    }),
  )
  renderApp()
  await userEvent.click(await findSub('Должники'))
  const box = await screen.findByRole('region', { name: 'Старые долги из прежней программы' })
  expect(box).toHaveTextContent(/Пример Старый/)
  expect(box).toHaveTextContent(/2\s500 сом/)
  expect(screen.getByRole('list', { name: 'Итог' })).toHaveTextContent(/Старые долги из прежней программы2\s500 сом/)
  await userEvent.click(within(box).getByRole('button', { name: 'Принять оплату' }))
  await userEvent.click(within(box).getByRole('button', { name: 'Переводом' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Старые долги из прежней программы' })).not.toBeInTheDocument())
  expect(await screen.findByText('Должников нет 🎉')).toBeInTheDocument()
  expect(paid).toEqual([{ id: '7', method: 'TRANSFER' }])
})

test('«Должники»: семья — одной строкой, «Семьи вместе» можно выключить', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/families', () => HttpResponse.json([{ id: 9, name: 'Семья Садыкова', members: [{ id: 5, fullName: 'Айгуль С.' }, { id: 6, fullName: 'Эрлан С.' }] }])),
    http.get('*/api/appointments/debts', () => HttpResponse.json([
      { appointmentId: 1, startAt: '2026-10-01T04:00:00Z', patientId: 5, patient: 'Айгуль С.', debtSom: 3000, doctorId: 0, chargeSom: 0, paidSom: 0 },
      { appointmentId: 2, startAt: '2026-10-02T04:00:00Z', patientId: 6, patient: 'Эрлан С.', debtSom: 2000, doctorId: 0, chargeSom: 0, paidSom: 0 },
    ] satisfies Schemas['PaymentQueryDebt'][])),
  )
  renderApp()
  await userEvent.click(await findSub('Должники'))
  const box = await screen.findByRole('region', { name: 'Должники' })
  expect(await within(box).findByText('👨‍👩‍👧 Семья Садыкова')).toBeInTheDocument()
  expect(within(box).getAllByRole('listitem')).toHaveLength(1)
  // «Семьи вместе» — в строке шапки «Кассы» (PageHead), не в карточке
  await userEvent.click(screen.getByRole('checkbox', { name: 'Семьи вместе' }))
  expect(within(box).getAllByRole('listitem')).toHaveLength(2)
})
