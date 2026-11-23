import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp, openPay } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Appointment = Schemas['AppointmentView']

/** Приём на сервере: оплата запоминается; со скидкой сервер считает стоимость сам — как PaymentQuery. */
function backend(a: Appointment, policy: Schemas['DiscountPoliciesPolicy'], who: Schemas['BookingViewsMe'] = me) {
  let current = a
  const sent: Record<string, unknown>[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/clinic/discounts', () => HttpResponse.json(policy)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === current.doctorId ? [current] : [])),
    http.get('*/api/appointments/:id/payments', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.post('*/api/appointments/:id/payment', async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>
      sent.push(b)
      const d = b.discount as { percent?: number; som?: number; reason: Schemas['PaymentDiscount']['reason']; comment?: string } | undefined
      const price = b.priceSom as number
      const som = d ? (d.percent != null ? Math.round((price * d.percent) / 100) : d.som!) : 0
      const charge = d ? price - som : (b.chargeSom as number | undefined)
      current = {
        ...current, paidSom: b.amountSom as number, paymentMethod: 'CASH', chargeSom: charge,
        debtSom: charge != null ? charge - (b.amountSom as number) : 0,
        discount: d ? { som, percent: d.percent, reason: d.reason, comment: d.comment, priceSom: price } : undefined,
      }
      return HttpResponse.json(current)
    }),
  )
  return sent
}

const ADMIN_POLICY = { who: 'ADMIN', maxPercent: 10, canGive: true, myMaxPercent: 100 } satisfies Schemas['DiscountPoliciesPolicy']

async function card() {
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('скидка кнопкой «10 %»: сумму считает сама', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', servicePriceSom: 18000, version: 1 }), ADMIN_POLICY)
  renderApp()
  const panel = await card()
  const form = await openPay(panel)
  await userEvent.click(within(form).getByRole('button', { name: '＋ Скидка' }))
  const discount = within(form).getByRole('group', { name: 'Скидка' })
  await userEvent.click(within(within(discount).getByRole('group', { name: 'Скидка в процентах' })).getByRole('button', { name: '10 %' }))
  expect(within(discount).getByLabelText('Скидка, %')).toHaveValue(10)
  expect(within(discount).getByLabelText('Итог со скидкой')).toHaveTextContent(/Скидка 10 % — 1\s800 сом · К оплате 16\s200 сом/)
  await userEvent.click(within(discount).getByRole('button', { name: 'Постоянный пациент' }))
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
  await waitForSlow(() => expect(sent).toEqual([{ amountSom: 16200, method: 'CASH', priceSom: 18000, discount: { percent: 10, reason: 'REGULAR' } }]))
})

test('скидка 10 %: итог «К оплате» в форме, на сервер — цена и скидка без стоимости, в карточке — скидка и причина', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', servicePriceSom: 6000, version: 1 }), ADMIN_POLICY)
  renderApp()
  const panel = await card()
  const form = await openPay(panel)
  await userEvent.click(within(form).getByRole('button', { name: '＋ Скидка' }))
  const discount = within(form).getByRole('group', { name: 'Скидка' })
  await userEvent.type(within(discount).getByLabelText('Скидка, %'), '10')
  await userEvent.click(within(discount).getByRole('button', { name: 'Постоянный пациент' }))
  expect(within(discount).getByLabelText('Итог со скидкой')).toHaveTextContent(/Скидка 10 % — 600 сом · К оплате 5\s400 сом/)
  expect(within(form).getByRole('button', { name: /Всё сразу · 5\s400 сом/ })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату · 5\s400 сом/ }))

  expect(await within(panel).findByLabelText('Скидка')).toHaveTextContent(/Скидка 10 % — 600 сом · Постоянный пациент/)
  // Оплачено полностью — без «5 400 из 5 400»
  expect(within(panel).queryByText(/из 5\s400/)).not.toBeInTheDocument()
  expect(sent).toEqual([{ amountSom: 5400, method: 'CASH', priceSom: 6000, discount: { percent: 10, reason: 'REGULAR' } }])
})

test('скидка суммой и «Другое»: без комментария — подсказка, запрос не уходит; часть сейчас — долг от суммы со скидкой', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', servicePriceSom: 5000, version: 1 }), ADMIN_POLICY)
  renderApp()
  const panel = await card()
  const form = await openPay(panel)
  await userEvent.click(within(form).getByRole('button', { name: '＋ Скидка' }))
  const discount = within(form).getByRole('group', { name: 'Скидка' })
  await userEvent.click(within(discount).getByRole('button', { name: 'сом' }))
  await userEvent.type(within(discount).getByLabelText('Скидка, сом'), '500')
  await userEvent.click(within(discount).getByRole('button', { name: 'Другое' }))
  await userEvent.click(within(form).getByRole('button', { name: 'Часть, остальное потом' }))
  await userEvent.type(within(form).getByLabelText('Заплатил сейчас, сом'), '2000')
  // Сумма в сомах — рядом её процент: 500 из 5 000 — 10 %
  expect(within(discount).getByLabelText('Итог со скидкой')).toHaveTextContent(/Скидка 500 сом \(10 %\) · К оплате 4\s500 сом/)
  expect(within(form).getByText(/Остальное потом:/)).toHaveTextContent(/2\s500 сом/)
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
  expect(within(form).getByRole('alert')).toHaveTextContent('Напишите, за что скидка')
  expect(sent).toHaveLength(0)

  await userEvent.type(within(discount).getByLabelText('Комментарий к скидке'), 'Гарантия')
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
  expect(await within(panel).findByText(/Долг 2\s500 сом/)).toBeInTheDocument()
  expect(sent).toEqual([{ amountSom: 2000, method: 'CASH', priceSom: 5000, discount: { som: 500, reason: 'OTHER', comment: 'Гарантия' } }])
})

test('регистратура: предел 10 % — больше нельзя; скидку давать не разрешили — кнопки нет', async () => {
  const reception = { ...me, admin: false, reception: true, doctorId: undefined }
  const a = appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', servicePriceSom: 5000, version: 1 })
  const sent = backend(a, { who: 'RECEPTION', maxPercent: 10, canGive: true, myMaxPercent: 10 }, reception)
  const { unmount } = renderApp()
  let panel = await card()
  let form = await openPay(panel)
  await userEvent.click(within(form).getByRole('button', { name: '＋ Скидка' }))
  const discount = within(form).getByRole('group', { name: 'Скидка' })
  expect(within(discount).getByText('Ваш предел — до 10 % от цены')).toBeInTheDocument()
  // Кнопки процентов — только в пределах: 5 и 10, без 15 и 20
  const quick = within(discount).getByRole('group', { name: 'Скидка в процентах' })
  expect(within(quick).getAllByRole('button').map((b) => b.textContent)).toEqual(['5 %', '10 %'])
  await userEvent.type(within(discount).getByLabelText('Скидка, %'), '15')
  await userEvent.click(within(discount).getByRole('button', { name: 'Акция' }))
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
  expect(within(form).getByRole('alert')).toHaveTextContent('Ваш предел скидки — до 10 % от цены')
  expect(sent).toHaveLength(0)
  unmount()

  backend(a, { who: 'ADMIN', maxPercent: 10, canGive: false }, reception)
  renderApp()
  panel = await card()
  form = await openPay(panel)
  expect(within(form).queryByRole('button', { name: '＋ Скидка' })).not.toBeInTheDocument()
})
