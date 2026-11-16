import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { SETUP_HINT_CLOSED } from './setupSteps'

/** «Что настроить»: строка над расписанием и список в «О клинике». Клиники и врачи — вымышленные. */
const fresh = { brandName: 'Новая', listed: false, settingUp: false, ownHours: true, workStart: '09:00:00', workEnd: '18:00:00',
  workDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
  independentDoctors: false, separateSupplies: false, recallMonths: 6 } satisfies Schemas['ClinicView']

const onlyMe = [{ id: 1, fullName: 'Айгерим', active: true, telegramLinked: true }] satisfies Schemas['BookingViewsMe']['doctors']

function backend(clinic: Schemas['ClinicView'], doctors: Schemas['BookingViewsMe']['doctors'] = onlyMe) {
  const sent: { body?: Schemas['ClinicControllerRequest'] } = {}
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctors, clinic: sent.body ? { ...clinic, listed: true, settingUp: false } : clinic })),
    http.get('*/api/clinic', () => HttpResponse.json(clinic)),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 1, name: 'Осмотр', durationMinutes: 30, active: true },
    ] satisfies Schemas['ServiceTypeView'][])),
    http.put('*/api/clinic', async ({ request }) => {
      sent.body = await request.json() as Schemas['ClinicControllerRequest']
      return HttpResponse.json({ ...clinic, listed: true, settingUp: false } satisfies Schemas['ClinicView'])
    }),
  )
  return sent
}

afterEach(() => localStorage.removeItem(SETUP_HINT_CLOSED))

test('зарегистрировался сам: расписание сразу, над ним — строка «Что настроить · 1 из 4», без «Показать пациентам»', async () => {
  backend(fresh)
  const user = userEvent.setup()
  renderApp()
  const hint = await screen.findByRole('region', { name: 'Что настроить' })
  await waitForSlow(() => expect(hint).toHaveTextContent('Что настроить · 1 из 4'))
  // Большого блока и кнопки над расписанием нет — расписание видно
  expect(screen.queryByRole('region', { name: 'Настройка клиники' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Показать пациентам' })).not.toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Требует внимания' })).toBeInTheDocument()
  // Раскрыли: часы ✓, цены ✗, коллеги — по желанию, приложение ✗ (не установлено)
  await user.click(within(hint).getByText(/Что настроить/))
  const steps = within(hint).getAllByRole('listitem')
  expect(steps[0]).toHaveTextContent('✓Часы работы — Пн–Сб, 09:00–18:00')
  expect(steps[1]).toHaveTextContent('✗Услуги с ценами')
  expect(steps[2]).toHaveTextContent('+Пригласите коллег (если есть) — Врачи, регистратура, ассистенты')
  expect(within(steps[2]!).getByLabelText('по желанию')).toBeInTheDocument()
  expect(steps[3]).toHaveTextContent('✗Установите приложение')
  await user.click(within(hint).getByRole('button', { name: 'Установите приложение' }))
  await waitForSlow(() => expect(window.location.hash).toBe('#/me/install'))
  window.location.hash = '/schedule'
})

test('✕ скрывает строку и помнит это на устройстве', async () => {
  backend(fresh)
  const user = userEvent.setup()
  const first = renderApp()
  const hint = await screen.findByRole('region', { name: 'Что настроить' })
  await user.click(within(hint).getByRole('button', { name: 'Скрыть «Что настроить»' }))
  expect(screen.queryByRole('region', { name: 'Что настроить' })).not.toBeInTheDocument()
  expect(localStorage.getItem(SETUP_HINT_CLOSED)).toBe('1')
  first.unmount()
  renderApp()
  await screen.findByRole('group', { name: 'Требует внимания' })
  expect(screen.queryByRole('region', { name: 'Что настроить' })).not.toBeInTheDocument()
})

test('клиника с платформы ещё не показана пациентам: над расписанием — пункт, кнопка — в «О клинике»', async () => {
  const sent = backend({ ...fresh, settingUp: true }, [...onlyMe, { id: 2, fullName: 'Дастан', active: true, telegramLinked: true }])
  const user = userEvent.setup()
  renderApp()
  const hint = await screen.findByRole('region', { name: 'Что настроить' })
  expect(hint).toHaveTextContent('клиника не видна пациентам')
  expect(screen.queryByRole('button', { name: 'Показать пациентам' })).not.toBeInTheDocument()
  await user.click(within(hint).getByText(/Что настроить/))
  await user.click(within(hint).getByRole('button', { name: '«О клинике» → «Показать пациентам»' }))
  const card = await screen.findByRole('region', { name: 'Настройка клиники' })
  expect(card).toHaveTextContent('Клиника пока не видна пациентам')
  expect(within(card).getAllByRole('listitem')[2]).toHaveTextContent('✓Пригласите коллег (если есть) — Врачей: 2')
  const show = within(card).getByRole('button', { name: 'Показать пациентам' })
  await waitForSlow(() => expect(show).toBeEnabled())
  await user.click(show)
  await waitForSlow(() => expect(sent.body?.listed).toBe(true))
  expect(sent.body?.brandName).toBe('Новая')
  window.location.hash = '/schedule'
})

test('без работающего врача — пункт «Врачи», «Показать пациентам» выключена; не админу — ничего', async () => {
  backend({ ...fresh, settingUp: true }, [{ id: 1, fullName: 'Айгерим', active: false, telegramLinked: true }])
  window.location.hash = '/settings/about'
  const first = renderApp()
  const card = await screen.findByRole('region', { name: 'Настройка клиники' })
  expect(card).toHaveTextContent('✗Врачи — Добавьте хотя бы одного врача')
  expect(within(card).getByRole('button', { name: 'Показать пациентам' })).toBeDisabled()
  expect(card).toHaveTextContent('сначала добавьте врача')
  first.unmount()
  window.location.hash = '/schedule'

  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, clinic: fresh })))
  renderApp()
  await screen.findByRole('group', { name: 'Требует внимания' })
  expect(screen.queryByRole('region', { name: 'Что настроить' })).not.toBeInTheDocument()
})
