import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Вымышленная семья: мама Айгуль и сын Эрлан. */
const family: Schemas['FamiliesFamily'] = { id: 9, name: 'Семья Садыкова', members: [{ id: 2, fullName: 'Айгуль Т.' }, { id: 4, fullName: 'Эрлан Т.' }] }

function backend(extra: Parameters<typeof server.use> = []) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/:id', ({ params }) => HttpResponse.json({
      patient: { id: Number(params.id), fullName: params.id === '2' ? 'Айгуль Т.' : 'Эрлан Т.', phone: '996700333444' },
      done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
    ...extra,
  )
}

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
})

test('семья: добавить родственника поиском — появляется состав', async () => {
  let joined: unknown = null
  backend([
    http.get('*/api/patients/2/family', () => (joined ? HttpResponse.json(family) : new HttpResponse(null, { status: 204 }))),
    http.post('*/api/patients/search', () => HttpResponse.json([{ id: 4, fullName: 'Эрлан Т.', phone: '996700333445' }])),
    http.post('*/api/patients/2/family', async ({ request }) => {
      joined = await request.json()
      return HttpResponse.json(family)
    }),
  ])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const box = await screen.findByRole('region', { name: 'Семья' })
  await userEvent.click(within(box).getByRole('button', { name: '＋ Добавить родственника' }))
  await userEvent.type(within(box).getByRole('searchbox', { name: 'Найти родственника' }), 'Эрлан')
  await userEvent.click(await within(box).findByRole('button', { name: 'Эрлан Т.' }))
  expect(joined).toEqual({ relativeId: 4 })
  expect(await within(box).findByRole('heading', { name: 'Семья Садыкова' })).toBeInTheDocument()
  // Нажать на родственника — его карточка
  await userEvent.click(within(box).getByRole('button', { name: 'Эрлан Т.' }))
  expect(await screen.findByRole('heading', { name: 'Эрлан Т.' })).toBeInTheDocument()
})

test('семья: общий долг и «Оплатить за семью» одной суммой', async () => {
  let sent: unknown = null
  backend([
    http.get('*/api/patients/2/family', () => HttpResponse.json(family)),
    http.get('*/api/families/9/debts', () => HttpResponse.json([
      { appointmentId: 1, patientId: 4, patient: 'Эрлан Т.', debtSom: 3000, startAt: '2026-09-01T04:00:00Z', doctorId: 1 },
      { appointmentId: 2, patientId: 2, patient: 'Айгуль Т.', debtSom: 5000, startAt: '2026-10-01T04:00:00Z', doctorId: 1 },
    ] satisfies Schemas['PaymentQueryDebt'][])),
    http.post('*/api/families/9/pay', async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ applied: [{ appointmentId: 1, patient: 'Эрлан Т.', amountSom: 3000 }, { appointmentId: 2, patient: 'Айгуль Т.', amountSom: 1000 }], leftDebtSom: 4000 })
    }),
  ])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const box = await screen.findByRole('region', { name: 'Семья' })
  expect(await within(box).findByText(/Долг семьи/)).toHaveTextContent(/Долг семьи: 8\s000 сом · приёмов: 2/)
  await userEvent.click(within(box).getByRole('button', { name: 'Оплатить за семью' }))
  const form = within(box).getByRole('form', { name: 'Оплата за семью' })
  await userEvent.clear(within(form).getByLabelText('Сумма, сом'))
  await userEvent.type(within(form).getByLabelText('Сумма, сом'), '4000')
  await userEvent.click(within(form).getByRole('button', { name: 'Карта' }))
  await userEvent.click(within(form).getByRole('button', { name: /Принять 4\s000 сом/ }))
  expect(await within(box).findByRole('status')).toHaveTextContent(/Эрлан Т\. — 3\s000 сом.*Айгуль Т\. — 1\s000 сом.*Осталось долга: 4\s000 сом/)
  expect(sent).toEqual({ amountSom: 4000, method: 'CARD' })
})
