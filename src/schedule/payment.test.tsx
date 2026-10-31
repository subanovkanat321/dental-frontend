import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Appointment = Schemas['AppointmentView']

/** Один приём на сервере; любое действие с оплатой запоминается и возвращает приём с правками. */
function backend(a: Appointment, after: (path: string, body: Record<string, unknown>) => Partial<Appointment>,
  extra: { payments?: Schemas['PaymentQueryEntry'][]; who?: Schemas['BookingViewsMe'] } = {}) {
  let current = a
  const sent: { path: string; body: unknown }[] = []
  const reply = async (path: string, request: Request) => {
    const body = (await request.json()) as Record<string, unknown>
    sent.push({ path, body })
    current = { ...current, ...after(path, body), version: current.version! + 1 }
    return HttpResponse.json(current)
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(extra.who ?? me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === current.doctorId ? [current] : [])),
    http.get('*/api/appointments/:id/payments', () => HttpResponse.json(extra.payments ?? [])),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 1, name: 'Пломба', active: true, priceSom: 3000 },
      { id: 2, name: 'Чистка', active: true, priceSom: 2000 },
      { id: 3, name: 'Старое', active: false, priceSom: 100 },
    ])),
    http.post('*/api/appointments/:id/payment', ({ request }) => reply('payment', request)),
    http.post('*/api/appointments/:id/payment/:kind', ({ request, params }) => reply(String(params.kind), request)),
  )
  return sent
}

async function card() {
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('оплата частями: цены услуг складываются, «Не всё сразу» — стоимость и срок, второй способ', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 }),
    (_, b) => ({ paidSom: b.amountSom as number, chargeSom: b.chargeSom as number, debtSom: (b.chargeSom as number) - (b.amountSom as number), dueOn: b.dueOn as string }))
  renderApp()
  const panel = await card()
  const form = within(panel).getByRole('form', { name: 'Оплата' })
  await userEvent.click(await within(form).findByRole('button', { name: /Пломба/ }))
  await userEvent.click(within(form).getByRole('button', { name: /Чистка/ }))
  expect(within(form).getByLabelText('Сумма, сом')).toHaveValue(5000)
  expect(within(form).queryByRole('button', { name: /Старое/ })).not.toBeInTheDocument()

  await userEvent.click(within(form).getByLabelText(/Не всё сразу/))
  expect(within(form).getByLabelText('Стоимость приёма, сом')).toHaveValue(5000)
  await userEvent.clear(within(form).getByLabelText('Сумма, сом'))
  await userEvent.type(within(form).getByLabelText('Сумма, сом'), '1000')
  await userEvent.type(within(form).getByLabelText(/Доплатит до/), '2099-01-15')
  await userEvent.click(within(form).getByRole('button', { name: '＋ Ещё способ оплаты' }))
  await userEvent.type(within(form).getByLabelText('Ещё оплачено, сом (2)'), '1500')
  await userEvent.click(within(form).getByRole('button', { name: 'Сохранить оплату' }))

  expect(await within(panel).findByText(/Долг 2\s500 сом · доплатит до/)).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'payment', body: {
    amountSom: 2500, method: 'CASH', chargeSom: 5000, dueOn: '2099-01-15',
    parts: [{ amountSom: 1000, method: 'CASH' }, { amountSom: 1500, method: 'TRANSFER' }],
  } }])
  expect(within(panel).getByRole('button', { name: 'Принять доплату' })).toBeInTheDocument()
})

test('стоимость не больше оплаченного — подсказка, запрос не уходит', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', servicePriceSom: 2000, version: 1 }), () => ({}))
  renderApp()
  const form = within(await card()).getByRole('form', { name: 'Оплата' })
  await userEvent.click(within(form).getByLabelText(/Не всё сразу/))
  await userEvent.click(within(form).getByRole('button', { name: 'Сохранить оплату' }))
  expect(within(form).getByRole('alert')).toHaveTextContent('Стоимость должна быть больше')
  expect(sent).toEqual([])
})

test('оплачено частями: история способов, «Изменить» открывает форму с частями', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', paidSom: 5000, paymentMethod: 'CASH', version: 2 }), () => ({}), {
    payments: [{ id: 1, amountSom: 3000, method: 'CASH' }, { id: 2, amountSom: 2000, method: 'TRANSFER' }],
  })
  renderApp()
  const panel = await card()
  expect(await within(panel).findByText(/^наличные 3\s000 сом \+ перевод 2\s000 сом$/)).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Изменить' }))
  const form = await within(panel).findByRole('form', { name: 'Оплата' })
  expect(within(form).getByLabelText('Сумма, сом')).toHaveValue(3000)
  expect(within(form).getByLabelText('Ещё оплачено, сом (2)')).toHaveValue(2000)
  await userEvent.click(within(form).getByRole('button', { name: 'Отмена' }))
  expect(within(panel).queryByRole('form', { name: 'Оплата' })).not.toBeInTheDocument()
})

test('после предоплаты — указать стоимость, остаток становится долгом', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', {
    status: 'DONE', paidSom: 1000, paymentMethod: 'TRANSFER', depositStatus: 'RECEIVED', depositSom: 1000, servicePriceSom: 4000, version: 1,
  }), (_, b) => ({ chargeSom: b.chargeSom as number, debtSom: (b.chargeSom as number) - 1000 }))
  renderApp()
  const panel = await card()
  await userEvent.click(await within(panel).findByRole('button', { name: 'Указать стоимость и принять остаток' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Дальше — остаток' }))
  expect(await within(panel).findByText(/1\s000 сом из 4\s000 сом/)).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'charge', body: { chargeSom: 4000 } }])
  expect(within(panel).getByText(/^Долг 3\s000 сом$/)).toBeInTheDocument()
})

test('долг закрыт — «Оплачено полностью»; врач правит сумму на кассу', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', paidSom: 4000, chargeSom: 4000, debtSom: 0, version: 1 }), () => ({}))
  renderApp()
  expect(await within(await card()).findByText(/Оплачено полностью/)).toBeInTheDocument()
})

test('на кассе: врач меняет сумму счёта', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', chargeSom: 4000, version: 1 }),
    (_, b) => ({ chargeSom: b.chargeSom as number }), { who: { ...me, admin: false, hasReception: true } })
  renderApp()
  const panel = await card()
  await userEvent.click(await within(panel).findByRole('button', { name: 'Изменить сумму' }))
  const form = within(panel).getByRole('form', { name: 'Сумма на кассу' })
  await userEvent.clear(within(form).getByLabelText('Сумма, сом'))
  await userEvent.type(within(form).getByLabelText('Сумма, сом'), '4500')
  await userEvent.click(within(form).getByRole('button', { name: /На кассу/ }))
  expect(await within(panel).findByText(/К оплате на кассе: 4\s500 сом/)).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'bill', body: { chargeSom: 4500 } }])
})
