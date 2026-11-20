import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

// ⭐ ВИП в карточке пациента (V223 бэкенда): одна дорога — метка «ВИП» в шапке (её ставят в списке меток, tags.test).
// Галочки «⭐ ВИП» в «Прочем» больше нет (UX-аудит 2026-11-20). Пациенты вымышленные
type Patient = Schemas['PatientView']

function backend(patient: Patient) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([patient])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/family', () => new HttpResponse(null, { status: 204 })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/:id', () => HttpResponse.json({ patient, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
  )
}

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
})

test('ВИП — звезда у имени в шапке; в «Прочем» галочки ВИП нет', async () => {
  backend({ id: 7, fullName: 'Вымышленный Нурлан', phone: '996700223001', telegram: false, vip: true })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Вымышленный Нурлан/ }))
  const card = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(within(card).getByRole('img', { name: 'ВИП — особое внимание' })).toBeInTheDocument()
  await userEvent.click(within(card).getByRole('tab', { name: 'Прочее' }))
  expect(within(card).queryByRole('checkbox', { name: /ВИП/ })).not.toBeInTheDocument()
  expect(within(card).queryByRole('region', { name: 'Особое внимание' })).not.toBeInTheDocument()
})
