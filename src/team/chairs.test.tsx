import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

/** Общее кресло (V185) в «Настройки → Персонал». Врачи и клиника — вымышленные. */
beforeEach(() => {
  window.location.hash = '/settings/doctors'
  server.use(http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })))
})
afterEach(() => {
  window.location.hash = ''
})

const doctors: Schemas['DoctorAdminView'][] = [
  { id: 1, fullName: 'Айгерим Садыкова', about: 'терапевт', active: true, telegramId: 111, role: 'ADMIN', phoneOnly: false },
  { id: 2, fullName: 'Дастан Т.', about: '', active: true, phoneOnly: false },
]

function backend(chairs: Schemas['ChairOverview'][], who: Schemas['BookingViewsMe'] = me) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
    http.get('*/api/chairs', () => HttpResponse.json(chairs)),
  )
}

async function openDoctor(name: string) {
  const table = await screen.findByRole('table', { name: 'Персонал' })
  await userEvent.click(within(table).getByRole('button', { name }))
  return screen.findByRole('complementary', { name: 'Врач' })
}

test('руководитель: «＋ Новое кресло» — кресло заводится и сразу назначается врачу', async () => {
  const chairs: Schemas['ChairOverview'][] = []
  const sent: Record<string, unknown> = {}
  backend(chairs)
  server.use(
    http.post('*/api/chairs', async ({ request }) => {
      sent.create = await request.json()
      return HttpResponse.json({ id: 5, name: 'Кресло 1', doctorIds: [] } satisfies Schemas['ChairsChair'], { status: 201 })
    }),
    http.put('*/api/doctors/:id/chair', async ({ request, params }) => {
      sent.assign = { doctor: Number(params.id), ...(await request.json() as object) }
      chairs.splice(0, chairs.length, { id: 5, name: 'Кресло 1', doctorIds: [1, 2], overlaps: [] })
      return HttpResponse.json(chairs)
    }),
  )
  renderApp()
  const panel = await openDoctor('Дастан Т.')
  const chair = within(panel).getByRole('region', { name: 'Кресло' })
  await choose(within(chair).getByRole('combobox', { name: 'Кресло врача' }), '＋ Новое кресло')
  const form = within(chair).getByRole('form', { name: 'Новое кресло' })
  await userEvent.type(within(form).getByRole('textbox', { name: 'Название' }), 'Кресло 1')
  await userEvent.click(within(form).getByRole('button', { name: 'Добавить' }))

  expect(await within(chair).findByText('🪑 Кресло 1 — делит кресло с: Айгерим Садыкова')).toBeInTheDocument()
  expect(sent.create).toEqual({ name: 'Кресло 1' })
  expect(sent.assign).toEqual({ doctor: 2, chairId: 5 })
  expect(within(chair).getByRole('combobox', { name: 'Кресло врача' })).toHaveTextContent('Кресло 1')
  // В списке персонала — значок кресла у обоих врачей
  const table = screen.getByRole('table', { name: 'Персонал' })
  expect(await within(table).findByLabelText('Кресло 1, делит кресло с: Айгерим Садыкова')).toBeInTheDocument()
  expect(within(table).getByLabelText('Кресло 1, делит кресло с: Дастан Т.')).toBeInTheDocument()
})

test('назначить кресло, когда приёмы уже пересекаются, — 409 со списком (время и врачи), руководитель переносит', async () => {
  backend([{ id: 5, name: 'Кресло 1', doctorIds: [1], overlaps: [] }])
  server.use(http.put('*/api/doctors/:id/chair', () => HttpResponse.json({
    title: 'Conflict', status: 409, code: 'chair-conflicts',
    detail: 'У врачей с этим креслом пересекаются приёмы — сначала перенесите их, потом назначьте кресло',
    conflicts: [{ startAt: '2099-06-01T04:15:00Z', endAt: '2099-06-01T04:45:00Z', doctorName: 'Дастан Т.',
      otherStartAt: '2099-06-01T04:00:00Z', otherEndAt: '2099-06-01T04:30:00Z', otherDoctorName: 'Айгерим Садыкова' }],
  }, { status: 409 })))
  renderApp()
  const panel = await openDoctor('Дастан Т.')
  const chair = within(panel).getByRole('region', { name: 'Кресло' })
  await choose(within(chair).getByRole('combobox', { name: 'Кресло врача' }), 'Кресло 1')

  const alert = await within(chair).findByRole('alert')
  expect(alert).toHaveTextContent('сначала перенесите их')
  expect(within(alert).getByRole('listitem')).toHaveTextContent('Дастан Т. 10:15–10:45 и Айгерим Садыкова 10:00–10:30')
})

test('часы врачей одного кресла пересекаются — подсказка под часами, не запрет', async () => {
  backend([{ id: 5, name: 'Кресло 1', doctorIds: [1, 2], overlaps: [
    { doctorId: 1, otherDoctorId: 2, weekday: 'TUESDAY', start: '10:00:00', end: '14:00:00' },
  ] }])
  renderApp()
  const panel = await openDoctor('Дастан Т.')
  expect(await within(panel).findByRole('note', { name: 'Часы пересекаются' }))
    .toHaveTextContent('Часы пересекаются с Айгерим Садыкова по вт 10:00–14:00 — записи всё равно не пересекутся, но лучше развести.')
})

test('не руководитель видит кресло врача, но не меняет', async () => {
  backend([{ id: 5, name: 'Кресло 1', doctorIds: [1, 2], overlaps: [] }], { ...me, admin: false, reception: true, doctorId: undefined })
  renderApp()
  const table = await screen.findByRole('table', { name: 'Персонал' })
  await userEvent.click(within(table).getByRole('button', { name: 'Дастан Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Врач' })
  const chair = within(panel).getByRole('region', { name: 'Кресло' })
  expect(await within(chair).findByText('🪑 Кресло 1 — делит кресло с: Айгерим Садыкова')).toBeInTheDocument()
  expect(within(chair).queryByRole('combobox')).not.toBeInTheDocument()
})
