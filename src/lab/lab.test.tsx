import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { readDeepLink } from '../lib/deepLink'
import { addDays, todayIn } from '../lib/time'
import { appointment, findSub, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { groupOrders, labKindOf, shortName, technicianText } from './text'

type Order = Schemas['LabOrderView']

afterEach(() => {
  window.location.hash = ''
})

// «Сейчас» в тестах — 2026-11-11 12:00 по Бишкеку (test/now.ts). Пациенты, врачи и лаборатории вымышленные
const lab: Schemas['LabView'] = { id: 5, name: 'Дент-Лаб', phone: '996555111222', archived: false }
const base = {
  patientId: 10, patientName: 'Бакыт Тестов', doctorId: 1, doctorName: 'Айгерим Садыкова', labId: 5, labName: 'Дент-Лаб', labPhone: '996555111222',
  kind: 'CROWN', teeth: '36', work: 'Коронка 36', sentOn: '2026-11-04', dueOn: '2026-11-14', status: 'SENT', reworkCount: 0, overdue: false,
  priceSom: 4500, paid: false, canMoney: true, canDelete: true, createdAt: '2026-11-04T05:00:00Z',
} as const satisfies Partial<Order>
const late: Order = { ...base, id: 1, dueOn: '2026-11-09', overdue: true }
const soon: Order = { ...base, id: 2, kind: 'BRIDGE', teeth: '34, 35, 36', work: 'Мост 34, 35, 36', patientId: 11, patientName: 'Нурлан Тестов' }
const ready: Order = { ...base, id: 3, status: 'READY', work: 'Винир 11', kind: 'VENEER', teeth: '11', fittingAppointmentId: 77, fittingAt: '2026-11-12T04:00:00Z', fittingStatus: 'SCHEDULED' }
const fitted: Order = { ...base, id: 4, status: 'FITTED', work: 'Капа', kind: 'SPLINT', teeth: undefined, paid: true }

function backend(start: Order[]) {
  let orders = [...start]
  const calls: { path: string; body?: unknown }[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/labs', () => HttpResponse.json([lab])),
    http.get('*/api/lab-orders/debts', () => HttpResponse.json({ totalSom: 9000, labs: [{ labId: 5, name: 'Дент-Лаб', som: 9000, orders: 2 }] } satisfies Schemas['LabControllerDebts'])),
    http.get('*/api/lab-orders/visits', () => HttpResponse.json([] satisfies Schemas['LabControllerVisit'][])),
    http.get('*/api/lab-orders', ({ request }) => {
      const q = new URL(request.url).searchParams
      const fittedOnly = q.get('fitted')
      return HttpResponse.json(orders.filter((o) => (fittedOnly == null || (o.status === 'FITTED') === (fittedOnly === 'true'))
        && (!q.get('patientId') || o.patientId === Number(q.get('patientId')))))
    }),
    http.post('*/api/lab-orders/:id/status', async ({ params, request }) => {
      const body = (await request.json()) as Schemas['LabControllerStatusChange']
      calls.push({ path: `status ${params.id}`, body })
      orders = orders.map((o) => (o.id === Number(params.id) ? { ...o, status: body.status, overdue: false } : o))
      return HttpResponse.json(orders.find((o) => o.id === Number(params.id)))
    }),
    http.post('*/api/lab-orders/:id/pay', async ({ params, request }) => {
      calls.push({ path: `pay ${params.id}`, body: await request.json() })
      orders = orders.map((o) => (o.id === Number(params.id) ? { ...o, paid: true } : o))
      return HttpResponse.json(orders.find((o) => o.id === Number(params.id)))
    }),
    http.post('*/api/lab-orders', async ({ request }) => {
      const body = (await request.json()) as Schemas['LabOrderDraft']
      calls.push({ path: 'create', body })
      const o: Order = { ...base, id: 50, patientId: body.patientId, teeth: body.teeth, dueOn: body.dueOn, fittingAppointmentId: body.fittingAppointmentId }
      orders = [...orders, o]
      return HttpResponse.json(o, { status: 201 })
    }),
  )
  return calls
}

test('группы, имя технику коротко, вид работы из плана, ссылка бота', () => {
  const groups = groupOrders([ready, late, soon])
  expect(groups.waiting.map((o) => o.id)).toEqual([1, 2])
  expect(groups.ready.map((o) => o.id)).toEqual([3])
  expect(shortName('Бакыт Тестов')).toBe('Бакыт Т.')
  expect(technicianText(ready)).toBe('Здравствуйте! Работа для пациента Бакыт Т., винир 11 — готова? Примерка завтра в 10:00.')
  expect(labKindOf('Коронка металлокерамика')).toBe('CROWN')
  expect(labKindOf('Капа для отбеливания')).toBe('SPLINT')
  expect(labKindOf('Лечение каналов')).toBeNull()
  expect(readDeepLink('?screen=lab&order=7')).toEqual({ page: 'stock', tab: 'lab', labOrderId: 7 })
})

test('«Склад → Лаборатория»: «Ждём» с просроченной красным, «Готово», свёрнутое «Установлено», долги; «Пришла»', async () => {
  window.location.hash = '/stock'
  const calls = backend([late, soon, ready, fitted])
  renderApp()
  await userEvent.click(await findSub('Лаборатория'))
  const waitingGroup = await screen.findByRole('region', { name: 'Ждём' })
  expect(waitingGroup).toHaveTextContent('Коронка 36 — Бакыт Тестов')
  expect(within(waitingGroup).getByText('просрочено 2 дн.')).toHaveClass('overdue')
  expect(waitingGroup).toHaveTextContent('Мост 34, 35, 36')
  const readyGroup = screen.getByRole('region', { name: 'Готово — ждёт установки' })
  expect(readyGroup).toHaveTextContent('примерка завтра 10:00')
  expect(screen.getByRole('button', { name: 'Установлено' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Капа')).toBeNull()
  expect(await screen.findByText(/Должны лабораториям/)).toHaveTextContent('Должны лабораториям: 9 000 сом')

  await userEvent.click(within(waitingGroup).getByRole('button', { name: 'Пришла: Коронка 36' }))
  await waitForSlow(() => expect(calls).toContainEqual({ path: 'status 1', body: { status: 'READY' } }))
  expect(await screen.findByRole('region', { name: 'Готово — ждёт установки' })).toHaveTextContent('Коронка 36')
})

test('оплата технику: «⋯ → Оплатить технику…», галочка «Записать в расходы»', async () => {
  window.location.hash = '/stock/lab'
  const calls = backend([ready])
  renderApp()
  const group = await screen.findByRole('region', { name: 'Готово — ждёт установки' })
  await userEvent.click(within(group).getByRole('button', { name: 'Ещё: Винир 11' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Оплатить технику…' }))
  const dialog = await screen.findByRole('dialog', { name: 'Оплатить технику' })
  expect(dialog).toHaveTextContent('4 500 сом')
  expect(within(dialog).getByRole('checkbox', { name: /Записать в «Расходы»/ })).toBeChecked()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Оплачено' }))
  await waitForSlow(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls).toContainEqual({ path: 'pay 3', body: { expense: true } })
  expect(await within(group).findByText(/оплачено/)).toBeInTheDocument()
})

test('карточка приёма: «＋ В лабораторию» — пациент, врач и примерка (этот приём впереди) уже выбраны', async () => {
  const visit = appointment(10, 1, '15:00', 'Бакыт Тестов')
  const calls = backend([])
  server.use(
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [visit] : [])),
    http.get('*/api/lab-orders/visits', () => HttpResponse.json([{ appointmentId: 10, startAt: visit.startAt, doctorId: 1, doctorName: 'Айгерим Садыкова' }])),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт Тестов/ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.click(within(panel).getByRole('button', { name: '＋ В лабораторию' }))
  const dialog = await screen.findByRole('dialog', { name: 'Заказ в лабораторию' })
  expect(dialog).toHaveTextContent('Пациент: Бакыт Тестов')
  await userEvent.type(within(dialog).getByLabelText('Зубы'), '36')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Создать заказ' }))
  await waitForSlow(() => expect(screen.queryByRole('dialog')).toBeNull())
  // Цену не шлём, если не вписали; срок — неделя от сегодня; лаборатория одна — она
  expect(calls).toContainEqual({ path: 'create', body: {
    patientId: 10, doctorId: 1, labId: 5, kind: 'CROWN', teeth: '36', sentOn: todayIn(), dueOn: addDays(todayIn(), 7), fittingAppointmentId: 10,
  } })
})

test('карточка приёма: на примерку работа ещё не пришла — предупреждение и WhatsApp технику с именем пациента', async () => {
  const visit = appointment(10, 1, '15:00', 'Бакыт Тестов')
  const calls = backend([{ ...base, id: 9, patientId: 10, fittingAppointmentId: 10, fittingAt: visit.startAt, fittingStatus: 'SCHEDULED' }])
  server.use(http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [visit] : [])))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт Тестов/ }))
  const block = await screen.findByRole('region', { name: 'Лаборатория на этот приём' })
  expect(block).toHaveTextContent('🦷 Коронка 36 — Отправлено')
  expect(within(block).getByRole('alert')).toHaveTextContent('Работа ещё не пришла из «Дент-Лаб». Позвоните технику.')
  const wa = within(block).getByRole('link', { name: '💬 WhatsApp технику' })
  expect(decodeURIComponent(wa.getAttribute('href')!)).toContain('Работа для пациента Бакыт Т., коронка 36 — готова? Примерка сегодня в 15:00.')
  await userEvent.click(within(block).getByRole('button', { name: 'Пришла' }))
  await waitForSlow(() => expect(calls).toContainEqual({ path: 'status 9', body: { status: 'READY' } }))
  expect(await within(block).findByText(/Готово/)).toBeInTheDocument()
  expect(within(block).queryByRole('alert')).toBeNull()
})
