import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Appointment = Schemas['AppointmentView']

function backend(a: Appointment) {
  let current = a
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [current] : [])),
    http.get('*/api/clinic/deposit', () => HttpResponse.json({ mode: 'NEW', amountSom: 1000 } satisfies Schemas['DepositsSettings'])),
    http.get('*/api/appointments/:id/deposit/receipt', () => new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })),
    http.post('*/api/appointments/:id/deposit', async ({ request }) => {
      const body = await request.json() as Schemas['DepositControllerAction']
      sent.push(body)
      current = body.action === 'REQUEST' ? { ...current, depositStatus: 'AWAITING', depositSom: body.amountSom }
        : body.action === 'RECEIVED' ? { ...current, depositStatus: 'RECEIVED' }
          : { ...current, depositStatus: undefined, depositSom: undefined }
      return HttpResponse.json(current)
    }),
  )
  return sent
}

test('предоплата: попросить (сумма из настроек), отметить «Получена» переводом', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.'))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  // Предоплату ещё не просили — пункт под «Ещё»
  await user.click(within(panel).getByRole('button', { name: /^Ещё.*предоплата/ }))
  await user.click(within(panel).getByRole('button', { name: 'Попросить предоплату' }))
  const box = within(panel).getByRole('group', { name: 'Предоплата' })
  expect(await within(box).findByDisplayValue('1000')).toBeInTheDocument()
  await user.click(within(box).getByRole('button', { name: 'Попросить предоплату' }))
  expect(await within(panel).findByText(/ждём предоплату/)).toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Получена' }))
  expect(await within(panel).findByText(/После приёма она станет первым платежом/)).toBeInTheDocument()
  expect(sent).toEqual([{ action: 'REQUEST', amountSom: 1000 }, { action: 'RECEIVED', method: 'TRANSFER' }])
})

test('пациент сообщил об оплате — виден чек', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.', { depositStatus: 'REPORTED', depositSom: 500 }))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(within(panel).getByText(/пациент оплатил — проверьте/)).toBeInTheDocument()
  expect(await within(panel).findByRole('img', { name: 'Чек пациента' })).toBeInTheDocument()
})
