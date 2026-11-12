import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

const clinic = { brandName: 'Новая', listed: false, settingUp: true, ownHours: false, independentDoctors: false, separateSupplies: false, recallMonths: 6 } satisfies Schemas['ClinicView']

test('новая клиника: чек-лист настройки над расписанием и «Показать пациентам»', async () => {
  const sent: { body?: Schemas['ClinicControllerRequest'] } = {}
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, clinic: sent.body ? { ...clinic, listed: true, settingUp: false } : clinic })),
    http.get('*/api/clinic', () => HttpResponse.json(clinic)),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 1, name: 'Осмотр', durationMinutes: 30, active: true },
    ] satisfies Schemas['ServiceTypeView'][])),
    http.put('*/api/clinic', async ({ request }) => {
      sent.body = await request.json() as Schemas['ClinicControllerRequest']
      return HttpResponse.json({ ...clinic, listed: true, settingUp: false } satisfies Schemas['ClinicView'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const card = await screen.findByRole('region', { name: 'Настройка клиники' })
  expect(card).toHaveTextContent('Клиника пока не видна пациентам')
  const steps = within(card).getAllByRole('listitem')
  expect(steps[0]).toHaveTextContent(/✗Часы работы — Сейчас — часы по умолчанию/)
  expect(steps[1]).toHaveTextContent(/✗Услуги с ценами/)
  expect(steps[2]).toHaveTextContent(/✓Врачи/)
  // Врачи есть — показать можно, но предупреждаем про часы и цены по умолчанию
  expect(within(card).getByText(/часы или цены ещё по умолчанию/)).toBeInTheDocument()
  await user.click(within(card).getByRole('button', { name: 'Показать пациентам' }))
  await waitForSlow(() => expect(sent.body?.listed).toBe(true))
  expect(sent.body?.brandName).toBe('Новая')
  await waitForSlow(() => expect(screen.queryByRole('region', { name: 'Настройка клиники' })).not.toBeInTheDocument())
})

test('без работающего врача «Показать пациентам» выключена; не админу и открытой клинике чек-листа нет', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, clinic, doctors: [{ id: 1, fullName: 'Айгерим', active: false }] })),
    http.get('*/api/clinic', () => HttpResponse.json(clinic)),
  )
  const first = renderApp()
  const card = await screen.findByRole('region', { name: 'Настройка клиники' })
  expect(within(card).getByRole('button', { name: 'Показать пациентам' })).toBeDisabled()
  expect(card).toHaveTextContent('сначала добавьте врача')
  first.unmount()

  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, clinic })))
  renderApp()
  await screen.findByRole('group', { name: 'Требует внимания' })
  expect(screen.queryByRole('region', { name: 'Настройка клиники' })).not.toBeInTheDocument()
})

test('часы новой клиники уже стоят (пн–сб) — чек-лист показывает какие, чтобы проверили', async () => {
  const set = { ...clinic, ownHours: true, workStart: '09:00:00', workEnd: '18:00:00',
    workDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] } satisfies Schemas['ClinicView']
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, clinic: set })),
    http.get('*/api/clinic', () => HttpResponse.json(set)),
    http.get('*/api/service-types', () => HttpResponse.json([])),
  )
  renderApp()
  const card = await screen.findByRole('region', { name: 'Настройка клиники' })
  await waitForSlow(() => expect(within(card).getAllByRole('listitem')[0]).toHaveTextContent('✓Часы работы — Пн–Сб, 09:00–18:00 — поменяйте, если работаете иначе'))
})
