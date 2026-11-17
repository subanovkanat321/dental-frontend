import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

// ⭐ ВИП в карточке пациента (V223 бэкенда): ставят руководитель и регистратура. Пациенты вымышленные
type Patient = Schemas['PatientView']

function backend(patient: Patient, who: Schemas['BookingViewsMe'] = me) {
  let current = patient
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/patients/recent', () => HttpResponse.json([current])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/family', () => new HttpResponse(null, { status: 204 })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/:id', () => HttpResponse.json({ patient: current, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.put('*/api/patients/:id/vip', async ({ request }) => {
      const body = (await request.json()) as Schemas['PatientVipControllerVipRequest']
      sent.push(body)
      current = { ...current, vip: Boolean(body.vip) }
      return HttpResponse.json(current)
    }),
  )
  return sent
}

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
})

test('руководитель ставит и снимает ⭐ ВИП: звезда у имени в шапке', async () => {
  const sent = backend({ id: 7, fullName: 'Вымышленный Нурлан', phone: '996700223001', telegram: false })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Вымышленный Нурлан' }))
  const card = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(within(card).queryByRole('img', { name: 'ВИП — особое внимание' })).not.toBeInTheDocument()
  await userEvent.click(within(card).getByRole('tab', { name: 'Прочее' }))
  await userEvent.click(within(card).getByRole('checkbox', { name: /ВИП — особое внимание/ }))
  expect(await within(card).findByRole('img', { name: 'ВИП — особое внимание' })).toBeInTheDocument()
  expect(within(card).getByRole('checkbox', { name: /ВИП/ })).toBeChecked()
  await userEvent.click(within(card).getByRole('checkbox', { name: /ВИП/ }))
  expect(await within(card).findByRole('checkbox', { name: /ВИП/ })).not.toBeChecked()
  expect(sent).toEqual([{ vip: true }, { vip: false }])
})

test('врач видит отметку, но не меняет её', async () => {
  backend({ id: 8, fullName: 'Вымышленная Жамиля', phone: '996700223002', telegram: false, vip: true }, { ...me, admin: false, reception: false })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Вымышленная Жамиля' }))
  const card = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(within(card).getByRole('img', { name: 'ВИП — особое внимание' })).toBeInTheDocument()
  await userEvent.click(within(card).getByRole('tab', { name: 'Прочее' }))
  expect(within(card).getByText('⭐ ВИП — особое внимание')).toBeInTheDocument()
  expect(within(card).queryByRole('checkbox', { name: /ВИП/ })).not.toBeInTheDocument()
})
